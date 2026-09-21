import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditLogsRepository } from '../audit/repositories/audit-logs.repository';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { UserRole } from '../users/enums/user-role.enum';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoiceResponseDto } from './dto/invoice-response.dto';
import { Invoice } from './entities/invoice.entity';
import { InvoiceStatus } from './enums/invoice-status.enum';
import { InvoiceStateMachine } from './invoice-state-machine';
import { InvoicesRepository } from './repositories/invoices.repository';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly invoicesRepository: InvoicesRepository,
    private readonly auditLogsRepository: AuditLogsRepository,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateInvoiceDto, sellerId: string): Promise<InvoiceResponseDto> {
    if (new Date(dto.dueDate) <= new Date(dto.issueDate)) {
      throw new BadRequestException('dueDate must be after issueDate');
    }
    if (dto.buyerId === sellerId) {
      throw new BadRequestException('An invoice cannot name its own seller as the buyer');
    }

    // Creation goes straight to PENDING_BUYER_CONFIRMATION: this flow has
    // no separate "save as draft, submit later" step, so DRAFT is never
    // actually used — it exists on the enum for that future case.
    const invoice = await this.invoicesRepository.create({
      sellerId,
      buyerId: dto.buyerId,
      invoiceNumber: dto.invoiceNumber,
      faceValue: dto.faceValue,
      currency: dto.currency.toUpperCase(),
      issueDate: dto.issueDate,
      dueDate: dto.dueDate,
      status: InvoiceStatus.PENDING_BUYER_CONFIRMATION,
    });

    await this.auditLogsRepository.record({
      entityType: 'invoice',
      entityId: invoice.id,
      toStatus: invoice.status,
      actorId: sellerId,
    });

    return InvoiceResponseDto.fromEntity(invoice);
  }

  /**
   * Buyer confirmation. Wrapped in a transaction with a row lock even
   * though a single buyer confirming their own invoice once isn't a
   * high-contention path — it's cheap insurance against a duplicate
   * double-click producing two audit log entries for the same
   * transition, and it keeps every state-changing write in this module
   * going through the same locked pattern used for the higher-stakes
   * offer-acceptance flow.
   */
  async confirm(invoiceId: string, currentUser: AuthenticatedUser): Promise<InvoiceResponseDto> {
    const updated = await this.dataSource.transaction(async (manager) => {
      const invoice = await this.invoicesRepository.findByIdForUpdate(invoiceId, manager);
      if (!invoice) {
        throw new NotFoundException('Invoice not found');
      }
      if (invoice.buyerId !== currentUser.id) {
        throw new ForbiddenException('Only the named buyer can confirm this invoice');
      }
      InvoiceStateMachine.assertCanTransition(invoice.status, InvoiceStatus.CONFIRMED);

      const confirmedAt = new Date();
      await this.invoicesRepository.updateStatus(invoiceId, InvoiceStatus.CONFIRMED, manager, { confirmedAt });
      await this.auditLogsRepository.record(
        {
          entityType: 'invoice',
          entityId: invoiceId,
          fromStatus: invoice.status,
          toStatus: InvoiceStatus.CONFIRMED,
          actorId: currentUser.id,
        },
        manager,
      );

      invoice.status = InvoiceStatus.CONFIRMED;
      invoice.confirmedAt = confirmedAt;
      return invoice;
    });

    return InvoiceResponseDto.fromEntity(updated);
  }

  async getById(invoiceId: string, currentUser: AuthenticatedUser): Promise<InvoiceResponseDto> {
    const invoice = await this.invoicesRepository.findById(invoiceId);
    if (!invoice || !this.isVisibleTo(invoice, currentUser)) {
      throw new NotFoundException('Invoice not found');
    }
    return InvoiceResponseDto.fromEntity(invoice);
  }

  private isVisibleTo(invoice: Invoice, user: AuthenticatedUser): boolean {
    if (user.role === UserRole.ADMIN) return true;
    if (invoice.sellerId === user.id || invoice.buyerId === user.id) return true;
    // Financiers can only browse invoices that are actually biddable.
    if (user.role === UserRole.FINANCIER) return invoice.status === InvoiceStatus.CONFIRMED;
    return false;
  }
}
