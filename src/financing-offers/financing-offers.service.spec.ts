import { BadRequestException, ConflictException } from '@nestjs/common';
import { AuditLogsRepository } from '../audit/repositories/audit-logs.repository';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { Invoice } from '../invoices/entities/invoice.entity';
import { InvoiceStatus } from '../invoices/enums/invoice-status.enum';
import { InvoicesRepository } from '../invoices/repositories/invoices.repository';
import { UserRole } from '../users/enums/user-role.enum';
import { FinancingOffer } from './entities/financing-offer.entity';
import { OfferStatus } from './enums/offer-status.enum';
import { FinancingOffersService } from './financing-offers.service';
import { FinancingOffersRepository } from './repositories/financing-offers.repository';

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
    status: InvoiceStatus.CONFIRMED,
    confirmedAt: new Date(),
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Invoice;
}

function makeOffer(overrides: Partial<FinancingOffer> = {}): FinancingOffer {
  return {
    id: 'offer-1',
    invoiceId: 'invoice-1',
    financierId: 'financier-1',
    advanceRate: '0.9000',
    advanceAmount: '900.00',
    feeAmount: '50.00',
    status: OfferStatus.PENDING,
    expiresAt: new Date(Date.now() + 86_400_000),
    createdAt: new Date(),
    decidedAt: null,
    ...overrides,
  } as FinancingOffer;
}

const sme: AuthenticatedUser = { id: 'sme-1', email: 'sme@example.com', role: UserRole.SME };

describe('FinancingOffersService', () => {
  let financingOffersRepository: jest.Mocked<FinancingOffersRepository>;
  let invoicesRepository: jest.Mocked<InvoicesRepository>;
  let auditLogsRepository: jest.Mocked<AuditLogsRepository>;
  let payoutsQueue: { add: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let service: FinancingOffersService;

  beforeEach(() => {
    financingOffersRepository = {
      findById: jest.fn(),
      findByIdForUpdate: jest.fn(),
      findByInvoiceId: jest.fn(),
      findAcceptedForInvoice: jest.fn(),
      create: jest.fn(),
      markAccepted: jest.fn(),
      rejectOtherPendingOffers: jest.fn(),
    } as unknown as jest.Mocked<FinancingOffersRepository>;

    invoicesRepository = {
      findById: jest.fn(),
      findByIdForUpdate: jest.fn(),
      updateStatus: jest.fn(),
    } as unknown as jest.Mocked<InvoicesRepository>;

    auditLogsRepository = { record: jest.fn() } as unknown as jest.Mocked<AuditLogsRepository>;
    payoutsQueue = { add: jest.fn().mockResolvedValue(undefined) };
    dataSource = { transaction: jest.fn((cb) => cb({})) };

    service = new FinancingOffersService(
      financingOffersRepository,
      invoicesRepository,
      auditLogsRepository,
      dataSource as any,
      payoutsQueue as any,
    );
  });

  describe('submitOffer', () => {
    it('rejects a bid on an invoice that is not confirmed', async () => {
      invoicesRepository.findById.mockResolvedValue(makeInvoice({ status: InvoiceStatus.PENDING_BUYER_CONFIRMATION }));
      await expect(
        service.submitOffer('invoice-1', { advanceRate: 0.9, feeAmount: '50.00', expiresAt: '2099-01-01T00:00:00.000Z' }, 'financier-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a financier bidding on their own invoice as seller or buyer', async () => {
      invoicesRepository.findById.mockResolvedValue(makeInvoice());
      await expect(
        service.submitOffer('invoice-1', { advanceRate: 0.9, feeAmount: '50.00', expiresAt: '2099-01-01T00:00:00.000Z' }, 'sme-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects advance + fee exceeding face value', async () => {
      invoicesRepository.findById.mockResolvedValue(makeInvoice({ faceValue: '1000.00' }));
      await expect(
        service.submitOffer(
          'invoice-1',
          { advanceRate: 1, feeAmount: '1.00', expiresAt: '2099-01-01T00:00:00.000Z' },
          'financier-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('computes advanceAmount from advanceRate * faceValue using decimal-safe math', async () => {
      invoicesRepository.findById.mockResolvedValue(makeInvoice({ faceValue: '1000.00' }));
      financingOffersRepository.create.mockResolvedValue(makeOffer());

      await service.submitOffer(
        'invoice-1',
        { advanceRate: 0.9, feeAmount: '50.00', expiresAt: '2099-01-01T00:00:00.000Z' },
        'financier-1',
      );

      expect(financingOffersRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ advanceAmount: '900.00', feeAmount: '50.00' }),
      );
    });
  });

  describe('acceptOffer', () => {
    it('rejects when the caller does not own the invoice', async () => {
      invoicesRepository.findByIdForUpdate.mockResolvedValue(makeInvoice({ sellerId: 'someone-else' }));
      await expect(service.acceptOffer('invoice-1', 'offer-1', sme)).rejects.toThrow();
    });

    it('rejects accepting an offer that already left PENDING', async () => {
      invoicesRepository.findByIdForUpdate.mockResolvedValue(makeInvoice());
      financingOffersRepository.findByIdForUpdate.mockResolvedValue(makeOffer({ status: OfferStatus.WITHDRAWN }));
      await expect(service.acceptOffer('invoice-1', 'offer-1', sme)).rejects.toThrow(ConflictException);
    });

    it('rejects accepting an expired offer', async () => {
      invoicesRepository.findByIdForUpdate.mockResolvedValue(makeInvoice());
      financingOffersRepository.findByIdForUpdate.mockResolvedValue(
        makeOffer({ expiresAt: new Date(Date.now() - 1000) }),
      );
      await expect(service.acceptOffer('invoice-1', 'offer-1', sme)).rejects.toThrow(ConflictException);
    });

    it('enqueues the payout job only after successfully accepting', async () => {
      invoicesRepository.findByIdForUpdate.mockResolvedValue(makeInvoice());
      financingOffersRepository.findByIdForUpdate.mockResolvedValue(makeOffer());

      const result = await service.acceptOffer('invoice-1', 'offer-1', sme);

      expect(invoicesRepository.updateStatus).toHaveBeenCalledWith('invoice-1', InvoiceStatus.FINANCED, expect.anything());
      expect(financingOffersRepository.rejectOtherPendingOffers).toHaveBeenCalledWith(
        'invoice-1',
        'offer-1',
        expect.anything(),
      );
      expect(payoutsQueue.add).toHaveBeenCalledWith(
        'process-payout',
        { offerId: 'offer-1' },
        { jobId: 'payout-offer-1' },
      );
      expect(result.status).toBe(OfferStatus.ACCEPTED);
    });

    /**
     * The concurrency-critical scenario. This does not (and cannot,
     * without a real Postgres instance) prove that SELECT ... FOR UPDATE
     * itself blocks a second transaction — that was verified separately
     * by firing two real concurrent HTTP requests against a live
     * database. What this test verifies is the piece that unit tests
     * *can* prove: given the mutual exclusion a row lock guarantees
     * (modeled here with a mutex around the fake transaction), the
     * service's re-check-after-acquiring-the-lock logic correctly lets
     * exactly one caller through and rejects the other — instead of, say,
     * both writes going through, or the second caller getting a
     * misleading error.
     */
    it('lets exactly one of two concurrent accept calls on the same invoice succeed', async () => {
      const state = {
        invoice: makeInvoice(),
        offers: {
          'offer-a': makeOffer({ id: 'offer-a', financierId: 'financier-a' }),
          'offer-b': makeOffer({ id: 'offer-b', financierId: 'financier-b' }),
        } as Record<string, FinancingOffer>,
      };

      // A mutex standing in for the invoice row lock: the second
      // transaction's callback cannot start until the first one has
      // fully settled, exactly mirroring what FOR UPDATE guarantees.
      let lockQueue: Promise<unknown> = Promise.resolve();
      dataSource.transaction.mockImplementation((cb: (manager: object) => Promise<unknown>) => {
        const run = lockQueue.then(() => cb({}));
        lockQueue = run.catch(() => undefined);
        return run;
      });

      invoicesRepository.findByIdForUpdate.mockImplementation(async () => ({ ...state.invoice }));
      invoicesRepository.updateStatus.mockImplementation(async (_id, status) => {
        state.invoice.status = status;
      });
      financingOffersRepository.findByIdForUpdate.mockImplementation(async (id: string) => ({ ...state.offers[id] }));
      financingOffersRepository.markAccepted.mockImplementation(async (id: string) => {
        state.offers[id].status = OfferStatus.ACCEPTED;
      });
      financingOffersRepository.rejectOtherPendingOffers.mockImplementation(async (_invoiceId, acceptedId: string) => {
        for (const [id, offer] of Object.entries(state.offers)) {
          if (id !== acceptedId && offer.status === OfferStatus.PENDING) {
            offer.status = OfferStatus.REJECTED;
          }
        }
      });

      const results = await Promise.allSettled([
        service.acceptOffer('invoice-1', 'offer-a', sme),
        service.acceptOffer('invoice-1', 'offer-b', sme),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(ConflictException);

      const finalStatuses = Object.values(state.offers).map((o) => o.status);
      expect(finalStatuses.filter((s) => s === OfferStatus.ACCEPTED)).toHaveLength(1);
      expect(finalStatuses.filter((s) => s === OfferStatus.REJECTED)).toHaveLength(1);
      expect(state.invoice.status).toBe(InvoiceStatus.FINANCED);
      // Only the winner's payout gets enqueued.
      expect(payoutsQueue.add).toHaveBeenCalledTimes(1);
    });
  });
});
