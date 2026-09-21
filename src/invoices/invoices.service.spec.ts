import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AuditLogsRepository } from '../audit/repositories/audit-logs.repository';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { UserRole } from '../users/enums/user-role.enum';
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
  let auditLogsRepository: jest.Mocked<AuditLogsRepository>;
  let dataSource: { transaction: jest.Mock };
  let service: InvoicesService;

  beforeEach(() => {
    invoicesRepository = {
      findById: jest.fn(),
      findByIdForUpdate: jest.fn(),
      create: jest.fn(),
      updateStatus: jest.fn(),
      findDueForSettlement: jest.fn(),
    } as unknown as jest.Mocked<InvoicesRepository>;

    auditLogsRepository = { record: jest.fn() } as unknown as jest.Mocked<AuditLogsRepository>;

    // Mirrors DataSource.transaction: invokes the callback with a stand-in
    // EntityManager. Good enough for unit-testing the service's own logic
    // (what it checks, what it calls) — it does not simulate real
    // Postgres row locking, which is proven separately against a real DB.
    dataSource = { transaction: jest.fn((cb) => cb({} as EntityManager)) };

    service = new InvoicesService(invoicesRepository, auditLogsRepository, dataSource as any);
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
  });
});
