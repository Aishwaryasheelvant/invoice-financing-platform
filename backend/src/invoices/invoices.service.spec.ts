import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EntityManager, QueryFailedError } from 'typeorm';
import { AuditLogsRepository } from '../audit/repositories/audit-logs.repository';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { UserRole } from '../users/enums/user-role.enum';
import { UsersRepository } from '../users/repositories/users.repository';
import { BuyerReliabilityRating } from './dto/buyer-reliability-response.dto';
import { Invoice } from './entities/invoice.entity';
import { InvoiceStatus } from './enums/invoice-status.enum';
import { InvoicesService } from './invoices.service';
import { InvoicesRepository } from './repositories/invoices.repository';

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'invoice-1',
    sellerId: 'seller-1',
    buyerId: 'buyer-1',
    invoiceNumber: 'INV-1',
    faceValue: '1000.00',
    currency: 'USD',
    issueDate: '2026-01-01',
    dueDate: '2026-02-01',
    status: InvoiceStatus.PENDING_BUYER_CONFIRMATION,
    confirmedAt: null,
    documentOriginalName: null,
    documentStorageKey: null,
    documentMimeType: null,
    documentSizeBytes: null,
    documentUploadedAt: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Invoice;
}

function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return { id: 'buyer-1', email: 'buyer@example.com', role: UserRole.BUYER, ...overrides };
}

describe('InvoicesService', () => {
  let invoicesRepository: jest.Mocked<InvoicesRepository>;
  let usersRepository: jest.Mocked<UsersRepository>;
  let auditLogsRepository: jest.Mocked<AuditLogsRepository>;
  let offerExists: jest.Mock;
  let dataSource: { transaction: jest.Mock; getRepository: jest.Mock };
  let service: InvoicesService;

  beforeEach(() => {
    invoicesRepository = {
      findById: jest.fn(),
      findByIdForUpdate: jest.fn(),
      create: jest.fn(),
      updateStatus: jest.fn(),
      updateDocument: jest.fn(),
      getBuyerPaymentStats: jest.fn(),
      findNeedingArrearsReview: jest.fn(),
    } as unknown as jest.Mocked<InvoicesRepository>;

    // Defaults to "yes, a real buyer" so existing tests that don't care
    // about this check don't have to set it up themselves.
    usersRepository = {
      findById: jest.fn().mockResolvedValue({ id: 'buyer-1', role: UserRole.BUYER }),
    } as unknown as jest.Mocked<UsersRepository>;

    auditLogsRepository = { record: jest.fn() } as unknown as jest.Mocked<AuditLogsRepository>;

    // Backs the "has this financier ever bid on this invoice" check in
    // isVisibleTo() — defaults to false; individual tests override it.
    offerExists = jest.fn().mockResolvedValue(false);

    // Mirrors DataSource.transaction: invokes the callback with a stand-in
    // EntityManager. Good enough for unit-testing the service's own logic
    // (what it checks, what it calls) — it does not simulate real
    // Postgres row locking, which is proven separately against a real DB.
    dataSource = {
      transaction: jest.fn((cb) => cb({} as EntityManager)),
      getRepository: jest.fn(() => ({ exists: offerExists })),
    };

    service = new InvoicesService(invoicesRepository, usersRepository, auditLogsRepository, dataSource as any);
  });

  describe('create', () => {
    it('rejects a due date on or before the issue date', async () => {
      await expect(
        service.create(
          {
            buyerId: 'buyer-1',
            invoiceNumber: 'INV-1',
            faceValue: '1000.00',
            currency: 'USD',
            issueDate: '2026-02-01',
            dueDate: '2026-01-01',
          },
          'seller-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(invoicesRepository.create).not.toHaveBeenCalled();
    });

    it('rejects a buyerId that does not belong to an existing buyer account', async () => {
      usersRepository.findById.mockResolvedValue(null);
      await expect(
        service.create(
          {
            buyerId: 'not-a-real-user',
            invoiceNumber: 'INV-1',
            faceValue: '1000.00',
            currency: 'USD',
            issueDate: '2026-01-01',
            dueDate: '2026-02-01',
          },
          'seller-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(invoicesRepository.create).not.toHaveBeenCalled();
    });

    it('rejects a buyerId that belongs to a non-buyer account', async () => {
      usersRepository.findById.mockResolvedValue({ id: 'buyer-1', role: UserRole.SME } as any);
      await expect(
        service.create(
          {
            buyerId: 'buyer-1',
            invoiceNumber: 'INV-1',
            faceValue: '1000.00',
            currency: 'USD',
            issueDate: '2026-01-01',
            dueDate: '2026-02-01',
          },
          'seller-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects naming the seller as their own buyer', async () => {
      await expect(
        service.create(
          {
            buyerId: 'seller-1',
            invoiceNumber: 'INV-1',
            faceValue: '1000.00',
            currency: 'USD',
            issueDate: '2026-01-01',
            dueDate: '2026-02-01',
          },
          'seller-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates the invoice directly in PENDING_BUYER_CONFIRMATION and records an audit entry', async () => {
      const created = makeInvoice();
      invoicesRepository.create.mockResolvedValue(created);

      const result = await service.create(
        {
          buyerId: 'buyer-1',
          invoiceNumber: 'INV-1',
          faceValue: '1000.00',
          currency: 'usd',
          issueDate: '2026-01-01',
          dueDate: '2026-02-01',
        },
        'seller-1',
      );

      expect(invoicesRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: InvoiceStatus.PENDING_BUYER_CONFIRMATION, currency: 'USD' }),
      );
      expect(auditLogsRepository.record).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: 'invoice', toStatus: InvoiceStatus.PENDING_BUYER_CONFIRMATION }),
      );
      expect(result.id).toBe(created.id);
    });

    it('translates a duplicate (seller_id, invoice_number) constraint violation into a clean 409', async () => {
      const dbError = new QueryFailedError('INSERT INTO invoices ...', [], {
        code: '23505',
        message: 'duplicate key value violates unique constraint "invoices_seller_invoice_number_key"',
      } as unknown as Error);
      invoicesRepository.create.mockRejectedValue(dbError);

      await expect(
        service.create(
          {
            buyerId: 'buyer-1',
            invoiceNumber: 'INV-1',
            faceValue: '1000.00',
            currency: 'USD',
            issueDate: '2026-01-01',
            dueDate: '2026-02-01',
          },
          'seller-1',
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('confirm', () => {
    it('throws NotFoundException when the invoice does not exist', async () => {
      invoicesRepository.findByIdForUpdate.mockResolvedValue(null);
      await expect(service.confirm('missing', makeUser())).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when the caller is not the named buyer', async () => {
      invoicesRepository.findByIdForUpdate.mockResolvedValue(makeInvoice({ buyerId: 'someone-else' }));
      await expect(service.confirm('invoice-1', makeUser({ id: 'buyer-1' }))).rejects.toThrow(ForbiddenException);
      expect(invoicesRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('rejects confirming an invoice that is not awaiting confirmation', async () => {
      invoicesRepository.findByIdForUpdate.mockResolvedValue(
        makeInvoice({ status: InvoiceStatus.CONFIRMED, buyerId: 'buyer-1' }),
      );
      await expect(service.confirm('invoice-1', makeUser())).rejects.toThrow(ConflictException);
      expect(invoicesRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('moves a pending invoice to CONFIRMED and records the audit trail', async () => {
      invoicesRepository.findByIdForUpdate.mockResolvedValue(
        makeInvoice({ status: InvoiceStatus.PENDING_BUYER_CONFIRMATION, buyerId: 'buyer-1' }),
      );

      const result = await service.confirm('invoice-1', makeUser());

      expect(invoicesRepository.updateStatus).toHaveBeenCalledWith(
        'invoice-1',
        InvoiceStatus.CONFIRMED,
        expect.anything(),
        expect.objectContaining({ confirmedAt: expect.any(Date) }),
      );
      expect(auditLogsRepository.record).toHaveBeenCalledWith(
        expect.objectContaining({
          fromStatus: InvoiceStatus.PENDING_BUYER_CONFIRMATION,
          toStatus: InvoiceStatus.CONFIRMED,
        }),
        expect.anything(),
      );
      expect(result.status).toBe(InvoiceStatus.CONFIRMED);
    });
  });

  describe('getById / visibility', () => {
    it('returns 404 to a financier for an invoice not yet open for bidding', async () => {
      invoicesRepository.findById.mockResolvedValue(makeInvoice({ status: InvoiceStatus.PENDING_BUYER_CONFIRMATION }));
      await expect(
        service.getById('invoice-1', makeUser({ id: 'financier-1', role: UserRole.FINANCIER })),
      ).rejects.toThrow(NotFoundException);
    });

    it('lets a financier see a confirmed invoice', async () => {
      invoicesRepository.findById.mockResolvedValue(makeInvoice({ status: InvoiceStatus.CONFIRMED }));
      const result = await service.getById('invoice-1', makeUser({ id: 'financier-1', role: UserRole.FINANCIER }));
      expect(result.status).toBe(InvoiceStatus.CONFIRMED);
    });

    it('returns 404 to an unrelated user regardless of status', async () => {
      invoicesRepository.findById.mockResolvedValue(makeInvoice({ status: InvoiceStatus.CONFIRMED }));
      await expect(
        service.getById('invoice-1', makeUser({ id: 'stranger', role: UserRole.SME })),
      ).rejects.toThrow(NotFoundException);
    });

    it('always lets an admin see the invoice', async () => {
      invoicesRepository.findById.mockResolvedValue(makeInvoice({ status: InvoiceStatus.DRAFT }));
      const result = await service.getById('invoice-1', makeUser({ id: 'admin-1', role: UserRole.ADMIN }));
      expect(result.id).toBe('invoice-1');
    });

    it('still lets a financier who bid on it see the invoice after it moves past CONFIRMED', async () => {
      invoicesRepository.findById.mockResolvedValue(makeInvoice({ status: InvoiceStatus.FINANCED }));
      offerExists.mockResolvedValue(true);
      const result = await service.getById('invoice-1', makeUser({ id: 'financier-1', role: UserRole.FINANCIER }));
      expect(result.status).toBe(InvoiceStatus.FINANCED);
    });

    it('hides a financed invoice from a financier who never bid on it', async () => {
      invoicesRepository.findById.mockResolvedValue(makeInvoice({ status: InvoiceStatus.FINANCED }));
      offerExists.mockResolvedValue(false);
      await expect(
        service.getById('invoice-1', makeUser({ id: 'financier-1', role: UserRole.FINANCIER })),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getBuyerReliability', () => {
    const noHistory = {
      settledCount: 0,
      onTimeCount: 0,
      lateCount: 0,
      avgDaysLate: 0,
      maxDaysLate: 0,
      currentlyOverdueCount: 0,
      defaultedCount: 0,
    };

    beforeEach(() => {
      usersRepository.findById.mockResolvedValue({
        id: 'buyer-1',
        role: UserRole.BUYER,
        companyName: 'Buyer Co',
      } as any);
    });

    it('rejects an id that is not an existing buyer', async () => {
      usersRepository.findById.mockResolvedValue(null);
      await expect(service.getBuyerReliability('nope')).rejects.toThrow(NotFoundException);
    });

    it('reports no_history when nothing has been paid yet', async () => {
      invoicesRepository.getBuyerPaymentStats.mockResolvedValue({ ...noHistory });
      const result = await service.getBuyerReliability('buyer-1');
      expect(result.rating).toBe(BuyerReliabilityRating.NO_HISTORY);
      expect(result.onTimePercentage).toBe(0);
    });

    it('rates a consistently prompt payer as reliable', async () => {
      invoicesRepository.getBuyerPaymentStats.mockResolvedValue({
        ...noHistory,
        settledCount: 5,
        onTimeCount: 5,
        avgDaysLate: 0,
      });
      const result = await service.getBuyerReliability('buyer-1');
      expect(result.rating).toBe(BuyerReliabilityRating.RELIABLE);
      expect(result.onTimePercentage).toBe(100);
    });

    it('rates a mildly late payer as slightly_late', async () => {
      invoicesRepository.getBuyerPaymentStats.mockResolvedValue({
        ...noHistory,
        settledCount: 4,
        onTimeCount: 1,
        lateCount: 3,
        avgDaysLate: 6,
      });
      const result = await service.getBuyerReliability('buyer-1');
      expect(result.rating).toBe(BuyerReliabilityRating.SLIGHTLY_LATE);
      expect(result.onTimePercentage).toBe(25);
    });

    it('rates a chronically late payer as habitually_late', async () => {
      invoicesRepository.getBuyerPaymentStats.mockResolvedValue({
        ...noHistory,
        settledCount: 3,
        lateCount: 3,
        avgDaysLate: 24,
      });
      const result = await service.getBuyerReliability('buyer-1');
      expect(result.rating).toBe(BuyerReliabilityRating.HABITUALLY_LATE);
    });

    it('lets a prior default outrank otherwise-good payment history', async () => {
      invoicesRepository.getBuyerPaymentStats.mockResolvedValue({
        ...noHistory,
        settledCount: 20,
        onTimeCount: 20,
        avgDaysLate: 0,
        defaultedCount: 1,
      });
      const result = await service.getBuyerReliability('buyer-1');
      expect(result.rating).toBe(BuyerReliabilityRating.HAS_DEFAULTED);
    });
  });

  describe('attachDocument', () => {
    const file = { originalname: 'invoice.pdf', filename: 'stored-name.pdf', mimetype: 'application/pdf', size: 1234 } as Express.Multer.File;

    it('rejects when the caller does not own the invoice', async () => {
      invoicesRepository.findById.mockResolvedValue(makeInvoice({ sellerId: 'someone-else' }));
      await expect(service.attachDocument('invoice-1', 'seller-1', file)).rejects.toThrow(ForbiddenException);
      expect(invoicesRepository.updateDocument).not.toHaveBeenCalled();
    });

    it('stores the document metadata against the invoice', async () => {
      invoicesRepository.findById
        .mockResolvedValueOnce(makeInvoice({ sellerId: 'seller-1' }))
        .mockResolvedValueOnce(makeInvoice({ sellerId: 'seller-1', documentOriginalName: 'invoice.pdf', documentStorageKey: 'stored-name.pdf' }));

      const result = await service.attachDocument('invoice-1', 'seller-1', file);

      expect(invoicesRepository.updateDocument).toHaveBeenCalledWith(
        'invoice-1',
        expect.objectContaining({ documentOriginalName: 'invoice.pdf', documentStorageKey: 'stored-name.pdf' }),
      );
      expect(result.hasDocument).toBe(true);
    });
  });

  describe('getDocumentForDownload', () => {
    it('throws NotFoundException when no document is attached', async () => {
      invoicesRepository.findById.mockResolvedValue(makeInvoice({ sellerId: 'seller-1' }));
      await expect(
        service.getDocumentForDownload('invoice-1', makeUser({ id: 'seller-1', role: UserRole.SME })),
      ).rejects.toThrow(NotFoundException);
    });

    it('enforces the same visibility rule as getById', async () => {
      invoicesRepository.findById.mockResolvedValue(
        makeInvoice({ status: InvoiceStatus.CONFIRMED, documentStorageKey: 'stored-name.pdf' }),
      );
      await expect(
        service.getDocumentForDownload('invoice-1', makeUser({ id: 'stranger', role: UserRole.SME })),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
