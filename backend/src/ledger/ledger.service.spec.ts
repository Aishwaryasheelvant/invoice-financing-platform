import { AuditLogsRepository } from '../audit/repositories/audit-logs.repository';
import { OfferStatus } from '../financing-offers/enums/offer-status.enum';
import { FinancingOffersRepository } from '../financing-offers/repositories/financing-offers.repository';
import { Invoice } from '../invoices/entities/invoice.entity';
import { InvoiceStatus } from '../invoices/enums/invoice-status.enum';
import { InvoicesRepository } from '../invoices/repositories/invoices.repository';
import { Money } from '../common/money';
import { Account } from './entities/account.entity';
import { Transaction } from './entities/transaction.entity';
import { TransactionType } from './enums/transaction-type.enum';
import { LedgerService } from './ledger.service';
import { AccountsRepository } from './repositories/accounts.repository';
import { EscrowLedgerRepository } from './repositories/escrow-ledger.repository';
import { TransactionsRepository } from './repositories/transactions.repository';

function makeAccount(id: string): Account {
  return { id } as Account;
}

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'invoice-1',
    sellerId: 'sme-1',
    buyerId: 'buyer-1',
    invoiceNumber: 'INV-1',
    faceValue: '1000.00',
    currency: 'USD',
    issueDate: '2026-01-01',
    dueDate: '2026-02-01',
    status: InvoiceStatus.FINANCED,
    confirmedAt: new Date(),
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Invoice;
}

describe('LedgerService', () => {
  let dataSource: { transaction: jest.Mock };
  let accountsRepository: jest.Mocked<AccountsRepository>;
  let transactionsRepository: jest.Mocked<TransactionsRepository>;
  let escrowLedgerRepository: jest.Mocked<EscrowLedgerRepository>;
  let invoicesRepository: jest.Mocked<InvoicesRepository>;
  let financingOffersRepository: jest.Mocked<FinancingOffersRepository>;
  let auditLogsRepository: jest.Mocked<AuditLogsRepository>;
  let service: LedgerService;

  beforeEach(() => {
    dataSource = { transaction: jest.fn((cb) => cb({})) };

    accountsRepository = {
      findByIdForUpdate: jest.fn(async (id: string) => makeAccount(id)),
      findOrCreateWallet: jest.fn(async (userId: string) => makeAccount(`wallet-${userId}`)),
      findOrCreateEscrowAccount: jest.fn(async (invoiceId: string) => makeAccount(`escrow-${invoiceId}`)),
      findOrCreateClearingAccount: jest.fn(async () => makeAccount('clearing')),
    } as unknown as jest.Mocked<AccountsRepository>;

    transactionsRepository = {
      findByIdempotencyKey: jest.fn(),
      insert: jest.fn(async (data) => ({ id: `tx-${data.idempotencyKey}`, ...data }) as unknown as Transaction),
    } as unknown as jest.Mocked<TransactionsRepository>;

    escrowLedgerRepository = {
      getBalance: jest.fn(async () => Money.zero()),
      insert: jest.fn(),
    } as unknown as jest.Mocked<EscrowLedgerRepository>;

    invoicesRepository = {
      findById: jest.fn(),
      findByIdForUpdate: jest.fn(),
      updateStatus: jest.fn(),
    } as unknown as jest.Mocked<InvoicesRepository>;

    financingOffersRepository = {
      findById: jest.fn(),
      findAcceptedForInvoice: jest.fn(),
    } as unknown as jest.Mocked<FinancingOffersRepository>;

    auditLogsRepository = { record: jest.fn() } as unknown as jest.Mocked<AuditLogsRepository>;

    service = new LedgerService(
      dataSource as any,
      accountsRepository,
      transactionsRepository,
      escrowLedgerRepository,
      invoicesRepository,
      financingOffersRepository,
      auditLogsRepository,
    );
  });

  describe('recordFinancierPayout', () => {
    it('short-circuits without opening a transaction when already processed (idempotent replay)', async () => {
      const existing = { id: 'tx-existing' } as Transaction;
      transactionsRepository.findByIdempotencyKey.mockResolvedValue(existing);

      const result = await service.recordFinancierPayout('offer-1');

      expect(result).toBe(existing);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('throws if the offer is not accepted (defends against a stale/racing job)', async () => {
      transactionsRepository.findByIdempotencyKey.mockResolvedValue(null);
      financingOffersRepository.findById.mockResolvedValue({ status: OfferStatus.PENDING } as any);

      await expect(service.recordFinancierPayout('offer-1')).rejects.toThrow(/not found or not accepted/);
    });

    it('debits the financier wallet and credits the SME wallet by exactly the advance amount', async () => {
      transactionsRepository.findByIdempotencyKey.mockResolvedValue(null);
      financingOffersRepository.findById.mockResolvedValue({
        id: 'offer-1',
        invoiceId: 'invoice-1',
        financierId: 'financier-1',
        status: OfferStatus.ACCEPTED,
        advanceAmount: '900.00',
        feeAmount: '50.00',
      } as any);
      invoicesRepository.findById.mockResolvedValue(makeInvoice());

      await service.recordFinancierPayout('offer-1');

      expect(transactionsRepository.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          type: TransactionType.FINANCIER_PAYOUT_TO_SME,
          amount: '900.00',
          idempotencyKey: 'payout-offer-1',
        }),
        expect.anything(),
      );
      const postedAmounts = escrowLedgerRepository.insert.mock.calls.map((call) => call[0].amount);
      expect(postedAmounts).toEqual(['900.00', '900.00']);
    });
  });

  describe('settleInvoice', () => {
    it('does nothing if the invoice is not FINANCED (idempotent no-op)', async () => {
      invoicesRepository.findByIdForUpdate.mockResolvedValue(makeInvoice({ status: InvoiceStatus.SETTLED }));

      await service.settleInvoice('invoice-1');

      expect(transactionsRepository.insert).not.toHaveBeenCalled();
      expect(invoicesRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('throws if FINANCED but no accepted offer exists (data-integrity guard)', async () => {
      invoicesRepository.findByIdForUpdate.mockResolvedValue(makeInvoice());
      financingOffersRepository.findAcceptedForInvoice.mockResolvedValue(null);

      await expect(service.settleInvoice('invoice-1')).rejects.toThrow(/no accepted offer/);
    });

    it('splits the full face value between financier (advance+fee) and SME (residual)', async () => {
      invoicesRepository.findByIdForUpdate.mockResolvedValue(makeInvoice({ faceValue: '1000.00' }));
      financingOffersRepository.findAcceptedForInvoice.mockResolvedValue({
        financierId: 'financier-1',
        advanceAmount: '850.00',
        feeAmount: '100.00',
      } as any);

      await service.settleInvoice('invoice-1');

      const inserted = transactionsRepository.insert.mock.calls.map((call) => call[0]);
      expect(inserted).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: TransactionType.BUYER_PAYMENT_TO_ESCROW, amount: '1000.00' }),
          expect.objectContaining({ type: TransactionType.ESCROW_RELEASE_TO_FINANCIER, amount: '950.00' }),
          expect.objectContaining({ type: TransactionType.ESCROW_RELEASE_TO_SME, amount: '50.00' }),
        ]),
      );
      expect(invoicesRepository.updateStatus).toHaveBeenCalledWith(
        'invoice-1',
        InvoiceStatus.SETTLED,
        expect.anything(),
        expect.objectContaining({ paidAt: expect.any(Date) }),
      );
      expect(auditLogsRepository.record).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { financierAmount: '950.00', smeAmount: '50.00', paidLate: false },
        }),
        expect.anything(),
      );
    });

    it('still settles an overdue invoice, recording it as a late payment', async () => {
      invoicesRepository.findByIdForUpdate.mockResolvedValue(
        makeInvoice({ status: InvoiceStatus.OVERDUE, faceValue: '1000.00' }),
      );
      financingOffersRepository.findAcceptedForInvoice.mockResolvedValue({
        financierId: 'financier-1',
        advanceAmount: '850.00',
        feeAmount: '100.00',
      } as any);

      await service.settleInvoice('invoice-1');

      expect(invoicesRepository.updateStatus).toHaveBeenCalledWith(
        'invoice-1',
        InvoiceStatus.SETTLED,
        expect.anything(),
        expect.objectContaining({ paidAt: expect.any(Date) }),
      );
      expect(auditLogsRepository.record).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ paidLate: true }) }),
        expect.anything(),
      );
    });

    it('skips the SME leg entirely when the financier takes the full face value (no zero-amount row)', async () => {
      invoicesRepository.findByIdForUpdate.mockResolvedValue(makeInvoice({ faceValue: '1000.00' }));
      financingOffersRepository.findAcceptedForInvoice.mockResolvedValue({
        financierId: 'financier-1',
        advanceAmount: '900.00',
        feeAmount: '100.00', // advance + fee == face value, nothing left for the SME
      } as any);

      await service.settleInvoice('invoice-1');

      const types = transactionsRepository.insert.mock.calls.map((call) => call[0].type);
      expect(types).not.toContain(TransactionType.ESCROW_RELEASE_TO_SME);
    });
  });

  describe('processArrears', () => {
    /** A due date `daysAgo` in the past, in the YYYY-MM-DD form the column holds. */
    function dueDaysAgo(daysAgo: number): string {
      return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
    }

    it('marks a financed invoice overdue once it is past due', async () => {
      invoicesRepository.findByIdForUpdate.mockResolvedValue(
        makeInvoice({ status: InvoiceStatus.FINANCED, dueDate: dueDaysAgo(3) }),
      );

      await service.processArrears('invoice-1', 30);

      expect(invoicesRepository.updateStatus).toHaveBeenCalledWith(
        'invoice-1',
        InvoiceStatus.OVERDUE,
        expect.anything(),
      );
      // Going overdue is a status change only — no money moves yet.
      expect(transactionsRepository.insert).not.toHaveBeenCalled();
    });

    it('leaves a financed invoice alone while it is not yet due', async () => {
      invoicesRepository.findByIdForUpdate.mockResolvedValue(
        makeInvoice({ status: InvoiceStatus.FINANCED, dueDate: dueDaysAgo(-5) }),
      );

      await service.processArrears('invoice-1', 30);

      expect(invoicesRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('leaves an overdue invoice alone while still inside the grace period', async () => {
      invoicesRepository.findByIdForUpdate.mockResolvedValue(
        makeInvoice({ status: InvoiceStatus.OVERDUE, dueDate: dueDaysAgo(10) }),
      );

      await service.processArrears('invoice-1', 30);

      expect(invoicesRepository.updateStatus).not.toHaveBeenCalled();
      expect(transactionsRepository.insert).not.toHaveBeenCalled();
    });

    it('defaults an overdue invoice past the grace period, clawing the advance back from the SME', async () => {
      invoicesRepository.findByIdForUpdate.mockResolvedValue(
        makeInvoice({ status: InvoiceStatus.OVERDUE, dueDate: dueDaysAgo(45), sellerId: 'sme-1' }),
      );
      financingOffersRepository.findAcceptedForInvoice.mockResolvedValue({
        financierId: 'financier-1',
        advanceAmount: '9000.00',
        feeAmount: '200.00',
      } as any);

      await service.processArrears('invoice-1', 30);

      // Only the advance is recovered — the financier forfeits the fee.
      expect(transactionsRepository.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          type: TransactionType.SME_RECOURSE_TO_FINANCIER,
          amount: '9000.00',
          idempotencyKey: 'recourse-invoice-1',
        }),
        expect.anything(),
      );
      const postings = escrowLedgerRepository.insert.mock.calls.map((call) => ({
        accountId: call[0].accountId,
        entryType: call[0].entryType,
        amount: call[0].amount,
      }));
      expect(postings).toEqual([
        { accountId: 'wallet-sme-1', entryType: 'debit', amount: '9000.00' },
        { accountId: 'wallet-financier-1', entryType: 'credit', amount: '9000.00' },
      ]);
      expect(invoicesRepository.updateStatus).toHaveBeenCalledWith(
        'invoice-1',
        InvoiceStatus.DEFAULTED,
        expect.anything(),
        expect.objectContaining({ defaultedAt: expect.any(Date) }),
      );
    });

    it('does nothing for an invoice that is already settled', async () => {
      invoicesRepository.findByIdForUpdate.mockResolvedValue(
        makeInvoice({ status: InvoiceStatus.SETTLED, dueDate: dueDaysAgo(99) }),
      );

      await service.processArrears('invoice-1', 30);

      expect(invoicesRepository.updateStatus).not.toHaveBeenCalled();
      expect(transactionsRepository.insert).not.toHaveBeenCalled();
    });
  });
});
