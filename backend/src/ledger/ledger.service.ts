import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuditLogsRepository } from '../audit/repositories/audit-logs.repository';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { Money } from '../common/money';
import { InvoiceResponseDto } from '../invoices/dto/invoice-response.dto';
import { InvoiceStatus } from '../invoices/enums/invoice-status.enum';
import { InvoiceStateMachine } from '../invoices/invoice-state-machine';
import { InvoicesRepository } from '../invoices/repositories/invoices.repository';
import { FinancingOffersRepository } from '../financing-offers/repositories/financing-offers.repository';
import { OfferStatus } from '../financing-offers/enums/offer-status.enum';
import { UserRole } from '../users/enums/user-role.enum';
import { TransactionResponseDto } from './dto/transaction-response.dto';
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
   * Settlement, triggered by the buyer actually paying: records their
   * payment landing in escrow (no payment gateway is wired up yet — see
   * AccountType.CLEARING), then splits it between the financier (their
   * advance + fee) and the SME (the residual).
   *
   * Accepts OVERDUE as well as FINANCED — a late payment still settles the
   * invoice, it just means the buyer's reliability stats take the hit.
   * Guarded by locking the invoice row and re-checking status, so a
   * duplicate or redelivered trigger sees it already SETTLED and no-ops.
   */
  async settleInvoice(invoiceId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const invoice = await this.invoicesRepository.findByIdForUpdate(invoiceId, manager);
      if (!invoice) {
        throw new Error(`Invoice ${invoiceId} not found`);
      }
      if (invoice.status !== InvoiceStatus.FINANCED && invoice.status !== InvoiceStatus.OVERDUE) {
        this.logger.log(`Invoice ${invoiceId} is ${invoice.status}, not payable — skipping (idempotent no-op)`);
        return;
      }

      const acceptedOffer = await this.financingOffersRepository.findAcceptedForInvoice(invoiceId, manager);
      if (!acceptedOffer) {
        throw new Error(`Invoice ${invoiceId} is ${invoice.status} but has no accepted offer — data integrity issue`);
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

      const paidAt = new Date();
      InvoiceStateMachine.assertCanTransition(invoice.status, InvoiceStatus.SETTLED);
      await this.invoicesRepository.updateStatus(invoiceId, InvoiceStatus.SETTLED, manager, { paidAt });
      await this.auditLogsRepository.record(
        {
          entityType: 'invoice',
          entityId: invoiceId,
          fromStatus: invoice.status,
          toStatus: InvoiceStatus.SETTLED,
          metadata: {
            financierAmount: financierAmount.toFixed(),
            smeAmount: smeAmount.toFixed(),
            paidLate: invoice.status === InvoiceStatus.OVERDUE,
          },
        },
        manager,
      );
    });
  }

  /**
   * The buyer-facing entry point to settlement: checks they're actually the
   * named buyer on this invoice, then runs the same settlement used
   * everywhere else.
   *
   * Done synchronously rather than through a queue, unlike the payout:
   * settlement here is pure local DB work, and the buyer should see the
   * result immediately. Once a real payment gateway is involved this would
   * split in two — collect the payment, then settle on the gateway's
   * webhook — at which point it becomes async like the payout.
   */
  async payInvoiceAsBuyer(invoiceId: string, currentUser: AuthenticatedUser): Promise<InvoiceResponseDto> {
    const invoice = await this.invoicesRepository.findById(invoiceId);
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    if (invoice.buyerId !== currentUser.id) {
      throw new ForbiddenException('Only the named buyer can pay this invoice');
    }
    if (invoice.status !== InvoiceStatus.FINANCED && invoice.status !== InvoiceStatus.OVERDUE) {
      throw new ConflictException(`Invoice is ${invoice.status} and cannot be paid`);
    }

    await this.settleInvoice(invoiceId);

    const settled = await this.invoicesRepository.findById(invoiceId);
    return InvoiceResponseDto.fromEntity(settled!);
  }

  /**
   * The arrears path, driven by the scheduled scan. One locked transaction
   * decides which transition (if any) applies, rather than the scan
   * deciding from a stale read:
   *
   *  - FINANCED and past due          -> OVERDUE (buyer is simply late)
   *  - OVERDUE and past grace period  -> DEFAULTED, plus recourse
   *
   * Recourse means the SME repays the financier's **advance** — the
   * financier gets their capital back but forfeits the fee, since the deal
   * never completed. The loss can't just evaporate: double-entry forces it
   * to land somewhere, and under a recourse agreement that somewhere is
   * the SME's wallet.
   */
  async processArrears(invoiceId: string, gracePeriodDays: number): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const invoice = await this.invoicesRepository.findByIdForUpdate(invoiceId, manager);
      if (!invoice) {
        throw new Error(`Invoice ${invoiceId} not found`);
      }

      const dueDate = new Date(`${invoice.dueDate}T00:00:00.000Z`);
      const now = new Date();

      if (invoice.status === InvoiceStatus.FINANCED) {
        if (now <= dueDate) {
          return; // not actually late; nothing to do
        }
        InvoiceStateMachine.assertCanTransition(invoice.status, InvoiceStatus.OVERDUE);
        await this.invoicesRepository.updateStatus(invoiceId, InvoiceStatus.OVERDUE, manager);
        await this.auditLogsRepository.record(
          {
            entityType: 'invoice',
            entityId: invoiceId,
            fromStatus: InvoiceStatus.FINANCED,
            toStatus: InvoiceStatus.OVERDUE,
            metadata: { dueDate: invoice.dueDate },
          },
          manager,
        );
        this.logger.warn(`Invoice ${invoiceId} is past due (${invoice.dueDate}) and unpaid — marked OVERDUE`);
        return;
      }

      if (invoice.status !== InvoiceStatus.OVERDUE) {
        return; // already settled, defaulted, or otherwise not in arrears
      }

      const defaultAfter = new Date(dueDate.getTime() + gracePeriodDays * 24 * 60 * 60 * 1000);
      if (now <= defaultAfter) {
        return; // still inside the grace period
      }

      const acceptedOffer = await this.financingOffersRepository.findAcceptedForInvoice(invoiceId, manager);
      if (!acceptedOffer) {
        throw new Error(`Invoice ${invoiceId} is OVERDUE but has no accepted offer — data integrity issue`);
      }

      const advance = Money.of(acceptedOffer.advanceAmount);
      const smeWallet = await this.accountsRepository.findOrCreateWallet(invoice.sellerId, invoice.currency, manager);
      const financierWallet = await this.accountsRepository.findOrCreateWallet(
        acceptedOffer.financierId,
        invoice.currency,
        manager,
      );
      await this.lockAccounts([smeWallet.id, financierWallet.id], manager);

      const transaction = await this.transactionsRepository.insert(
        {
          invoiceId,
          type: TransactionType.SME_RECOURSE_TO_FINANCIER,
          amount: advance.toFixed(),
          currency: invoice.currency,
          idempotencyKey: `recourse-${invoiceId}`,
        },
        manager,
      );
      await this.postEntry(transaction.id, invoiceId, smeWallet.id, LedgerEntryType.DEBIT, advance.toFixed(), manager);
      await this.postEntry(
        transaction.id,
        invoiceId,
        financierWallet.id,
        LedgerEntryType.CREDIT,
        advance.toFixed(),
        manager,
      );

      InvoiceStateMachine.assertCanTransition(invoice.status, InvoiceStatus.DEFAULTED);
      await this.invoicesRepository.updateStatus(invoiceId, InvoiceStatus.DEFAULTED, manager, {
        defaultedAt: new Date(),
      });
      await this.auditLogsRepository.record(
        {
          entityType: 'invoice',
          entityId: invoiceId,
          fromStatus: InvoiceStatus.OVERDUE,
          toStatus: InvoiceStatus.DEFAULTED,
          metadata: {
            recourseAmount: advance.toFixed(),
            recoveredFrom: invoice.sellerId,
            paidTo: acceptedOffer.financierId,
            gracePeriodDays,
          },
        },
        manager,
      );
      this.logger.warn(
        `Invoice ${invoiceId} defaulted — recovered ${invoice.currency} ${advance.toFixed()} from the SME under recourse`,
      );
    });
  }

  /**
   * Read-only, and deliberately narrow: the seller and buyer see the full
   * transaction history for their own invoice, the financier who won it
   * (if any) sees it too, and nobody else does — this is payout/payment
   * history, not something to expose to every other financier who bid.
   */
  async getTransactionsForInvoice(invoiceId: string, currentUser: AuthenticatedUser): Promise<TransactionResponseDto[]> {
    const invoice = await this.invoicesRepository.findById(invoiceId);
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    const isOwner = invoice.sellerId === currentUser.id || invoice.buyerId === currentUser.id;
    let isAcceptedFinancier = false;
    if (!isOwner && currentUser.role === UserRole.FINANCIER) {
      const acceptedOffer = await this.financingOffersRepository.findAcceptedForInvoice(invoiceId);
      isAcceptedFinancier = acceptedOffer?.financierId === currentUser.id;
    }

    if (!isOwner && !isAcceptedFinancier && currentUser.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Not allowed to view transactions for this invoice');
    }

    const transactions = await this.transactionsRepository.findByInvoiceId(invoiceId);
    return transactions.map(TransactionResponseDto.fromEntity);
  }
}
