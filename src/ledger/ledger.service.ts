import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuditLogsRepository } from '../audit/repositories/audit-logs.repository';
import { Money } from '../common/money';
import { InvoiceStatus } from '../invoices/enums/invoice-status.enum';
import { InvoicesRepository } from '../invoices/repositories/invoices.repository';
import { FinancingOffersRepository } from '../financing-offers/repositories/financing-offers.repository';
import { OfferStatus } from '../financing-offers/enums/offer-status.enum';
import { AccountsRepository } from './repositories/accounts.repository';
import { EscrowLedgerRepository } from './repositories/escrow-ledger.repository';
import { TransactionsRepository } from './repositories/transactions.repository';
import { LedgerEntryType } from './enums/ledger-entry-type.enum';
import { TransactionType } from './enums/transaction-type.enum';
import { Transaction } from './entities/transaction.entity';

/**
 * The only module in the app that writes to accounts / transactions /
 * escrow_ledger. Everything here runs inside a DB transaction, and every
 * money movement is idempotent by construction (a deterministic
 * idempotency key derived from the business event, not a random one) so
 * that BullMQ's at-least-once delivery — a retried or duplicated job —
 * can never double-credit or double-debit an account.
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly accountsRepository: AccountsRepository,
    private readonly transactionsRepository: TransactionsRepository,
    private readonly escrowLedgerRepository: EscrowLedgerRepository,
    private readonly invoicesRepository: InvoicesRepository,
    private readonly financingOffersRepository: FinancingOffersRepository,
    private readonly auditLogsRepository: AuditLogsRepository,
  ) {}

  /**
   * Locks every given account row, always in the same (sorted-by-id)
   * order, regardless of which order the caller happened to list them
   * in. Two operations that both need to touch, say, an escrow account
   * and a wallet account can never deadlock against each other this way
   * — they always approach the pair from the same direction.
   */
  private async lockAccounts(accountIds: string[], manager: EntityManager): Promise<void> {
    const orderedUniqueIds = Array.from(new Set(accountIds)).sort();
    for (const id of orderedUniqueIds) {
      const account = await this.accountsRepository.findByIdForUpdate(id, manager);
      if (!account) {
        throw new Error(`Ledger account ${id} not found`);
      }
    }
  }

  /** Appends one posting; assumes the account is already locked by the caller (see lockAccounts). */
  private async postEntry(
    transactionId: string,
    invoiceId: string,
    accountId: string,
    entryType: LedgerEntryType,
    amount: string,
    manager: EntityManager,
  ): Promise<void> {
    const currentBalance = await this.escrowLedgerRepository.getBalance(accountId, manager);
    const amountMoney = Money.of(amount);
    const newBalance = entryType === LedgerEntryType.CREDIT ? currentBalance.plus(amountMoney) : currentBalance.minus(amountMoney);
    await this.escrowLedgerRepository.insert(
      { transactionId, invoiceId, accountId, entryType, amount, balanceAfter: newBalance.toFixed() },
      manager,
    );
  }

  /**
   * Financier -> SME advance, triggered by the payout BullMQ job right
   * after an offer is accepted. Idempotency key is derived from the
   * offer id, not generated per call: if the job is retried (failure) or
   * redelivered (BullMQ is at-least-once), this returns the original
   * transaction instead of moving the money twice.
   */
  async recordFinancierPayout(offerId: string): Promise<Transaction> {
    const idempotencyKey = `payout-${offerId}`;

    const alreadyProcessed = await this.transactionsRepository.findByIdempotencyKey(idempotencyKey);
    if (alreadyProcessed) {
      this.logger.log(`Payout for offer ${offerId} already processed (idempotent replay)`);
      return alreadyProcessed;
    }

    return this.dataSource.transaction(async (manager) => {
      // Re-check inside the transaction: two workers could both pass the
      // fast-path check above before either has committed a row for this key.
      const existing = await this.transactionsRepository.findByIdempotencyKey(idempotencyKey, manager);
      if (existing) {
        return existing;
      }

      const offer = await this.financingOffersRepository.findById(offerId, manager);
      if (!offer || offer.status !== OfferStatus.ACCEPTED) {
        throw new Error(`Cannot pay out offer ${offerId}: not found or not accepted`);
      }
      const invoice = await this.invoicesRepository.findById(offer.invoiceId, manager);
      if (!invoice) {
        throw new Error(`Invoice ${offer.invoiceId} not found for offer ${offerId}`);
      }

      const amount = Money.of(offer.advanceAmount).toFixed();
      const financierWallet = await this.accountsRepository.findOrCreateWallet(offer.financierId, invoice.currency, manager);
      const smeWallet = await this.accountsRepository.findOrCreateWallet(invoice.sellerId, invoice.currency, manager);
      await this.lockAccounts([financierWallet.id, smeWallet.id], manager);

      const transaction = await this.transactionsRepository.insert(
        {
          invoiceId: invoice.id,
          type: TransactionType.FINANCIER_PAYOUT_TO_SME,
          amount,
          currency: invoice.currency,
          idempotencyKey,
          initiatedBy: offer.financierId,
        },
        manager,
      );

      await this.postEntry(transaction.id, invoice.id, financierWallet.id, LedgerEntryType.DEBIT, amount, manager);
      await this.postEntry(transaction.id, invoice.id, smeWallet.id, LedgerEntryType.CREDIT, amount, manager);

      return transaction;
    });
  }

  /**
   * Due-date settlement: simulates the buyer's payment landing in escrow
   * (no payment gateway is wired up yet — see AccountType.CLEARING),
   * then splits it between the financier (their advance + fee) and the
   * SME (the residual). Guarded by locking the invoice row and
   * re-checking its status, exactly like acceptOffer: if this is somehow
   * invoked twice for the same invoice (the scan runs twice, a job is
   * redelivered), the second call sees the invoice already SETTLED and
   * does nothing.
   */
  async settleInvoice(invoiceId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const invoice = await this.invoicesRepository.findByIdForUpdate(invoiceId, manager);
      if (!invoice) {
        throw new Error(`Invoice ${invoiceId} not found`);
      }
      if (invoice.status !== InvoiceStatus.FINANCED) {
        this.logger.log(`Invoice ${invoiceId} is ${invoice.status}, not FINANCED — skipping (idempotent no-op)`);
        return;
      }

      const acceptedOffer = await this.financingOffersRepository.findAcceptedForInvoice(invoiceId, manager);
      if (!acceptedOffer) {
        throw new Error(`Invoice ${invoiceId} is FINANCED but has no accepted offer — data integrity issue`);
      }

      const faceValue = Money.of(invoice.faceValue);
      const financierAmount = Money.of(acceptedOffer.advanceAmount).plus(Money.of(acceptedOffer.feeAmount));
      const smeAmount = faceValue.minus(financierAmount);

      const clearing = await this.accountsRepository.findOrCreateClearingAccount(invoice.currency, manager);
      const escrow = await this.accountsRepository.findOrCreateEscrowAccount(invoiceId, invoice.currency, manager);
      const financierWallet = await this.accountsRepository.findOrCreateWallet(
        acceptedOffer.financierId,
        invoice.currency,
        manager,
      );
      const smeWallet = await this.accountsRepository.findOrCreateWallet(invoice.sellerId, invoice.currency, manager);
      await this.lockAccounts([clearing.id, escrow.id, financierWallet.id, smeWallet.id], manager);

      const baseKey = `settlement-${invoiceId}`;

      // Leg 1: buyer's payment arrives into escrow.
      const paymentTx = await this.transactionsRepository.insert(
        {
          invoiceId,
          type: TransactionType.BUYER_PAYMENT_TO_ESCROW,
          amount: faceValue.toFixed(),
          currency: invoice.currency,
          idempotencyKey: `${baseKey}-buyer-payment`,
        },
        manager,
      );
      await this.postEntry(paymentTx.id, invoiceId, clearing.id, LedgerEntryType.DEBIT, faceValue.toFixed(), manager);
      await this.postEntry(paymentTx.id, invoiceId, escrow.id, LedgerEntryType.CREDIT, faceValue.toFixed(), manager);

      // Leg 2: escrow repays the financier (their advance + their fee).
      const financierTx = await this.transactionsRepository.insert(
        {
          invoiceId,
          type: TransactionType.ESCROW_RELEASE_TO_FINANCIER,
          amount: financierAmount.toFixed(),
          currency: invoice.currency,
          idempotencyKey: `${baseKey}-financier-release`,
        },
        manager,
      );
      await this.postEntry(financierTx.id, invoiceId, escrow.id, LedgerEntryType.DEBIT, financierAmount.toFixed(), manager);
      await this.postEntry(
        financierTx.id,
        invoiceId,
        financierWallet.id,
        LedgerEntryType.CREDIT,
        financierAmount.toFixed(),
        manager,
      );

      // Leg 3: escrow releases whatever's left to the SME.
      if (smeAmount.isPositive()) {
        const smeTx = await this.transactionsRepository.insert(
          {
            invoiceId,
            type: TransactionType.ESCROW_RELEASE_TO_SME,
            amount: smeAmount.toFixed(),
            currency: invoice.currency,
            idempotencyKey: `${baseKey}-sme-release`,
          },
          manager,
        );
        await this.postEntry(smeTx.id, invoiceId, escrow.id, LedgerEntryType.DEBIT, smeAmount.toFixed(), manager);
        await this.postEntry(smeTx.id, invoiceId, smeWallet.id, LedgerEntryType.CREDIT, smeAmount.toFixed(), manager);
      }

      await this.invoicesRepository.updateStatus(invoiceId, InvoiceStatus.SETTLED, manager);
      await this.auditLogsRepository.record(
        {
          entityType: 'invoice',
          entityId: invoiceId,
          fromStatus: InvoiceStatus.FINANCED,
          toStatus: InvoiceStatus.SETTLED,
          metadata: { financierAmount: financierAmount.toFixed(), smeAmount: smeAmount.toFixed() },
        },
        manager,
      );
    });
  }
}
