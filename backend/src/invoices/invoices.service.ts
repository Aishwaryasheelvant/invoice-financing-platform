import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { existsSync, unlink } from 'fs';
import { join } from 'path';
import { DataSource, QueryFailedError } from 'typeorm';
import { AuditLogsRepository } from '../audit/repositories/audit-logs.repository';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { FinancingOffer } from '../financing-offers/entities/financing-offer.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { UsersRepository } from '../users/repositories/users.repository';
import { BuyerReliabilityRating, BuyerReliabilityResponseDto } from './dto/buyer-reliability-response.dto';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoiceResponseDto } from './dto/invoice-response.dto';
import { Invoice } from './entities/invoice.entity';
import { InvoiceStatus } from './enums/invoice-status.enum';
import { InvoiceStateMachine } from './invoice-state-machine';
import { INVOICE_DOCUMENTS_DIR } from './invoice-document.storage';
import { InvoicesRepository } from './repositories/invoices.repository';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly invoicesRepository: InvoicesRepository,
    private readonly usersRepository: UsersRepository,
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

    // buyerId is free text pasted in by the SME — easy to mistype. Checked
    // up front for a clear message, rather than letting a foreign-key
    // violation surface from the insert below.
    const buyer = await this.usersRepository.findById(dto.buyerId);
    if (!buyer || buyer.role !== UserRole.BUYER) {
      throw new BadRequestException('buyerId must be the user ID of an existing account registered as a buyer');
    }

    // Creation goes straight to PENDING_BUYER_CONFIRMATION: this flow has
    // no separate "save as draft, submit later" step, so DRAFT is never
    // actually used — it exists on the enum for that future case.
    let invoice: Invoice;
    try {
      invoice = await this.invoicesRepository.create({
        sellerId,
        buyerId: dto.buyerId,
        invoiceNumber: dto.invoiceNumber,
        faceValue: dto.faceValue,
        currency: dto.currency.toUpperCase(),
        issueDate: dto.issueDate,
        dueDate: dto.dueDate,
        status: InvoiceStatus.PENDING_BUYER_CONFIRMATION,
      });
    } catch (error) {
      // Postgres unique_violation (23505) on (seller_id, invoice_number) —
      // translate the raw DB error into a specific, actionable message
      // instead of letting it surface as an opaque 500.
      if (error instanceof QueryFailedError && (error as unknown as { code?: string }).code === '23505') {
        throw new ConflictException(`You already have an invoice numbered "${dto.invoiceNumber}"`);
      }
      throw error;
    }

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
    if (!invoice || !(await this.isVisibleTo(invoice, currentUser))) {
      throw new NotFoundException('Invoice not found');
    }
    return InvoiceResponseDto.fromEntity(invoice);
  }

  /**
   * What each role sees when browsing, mirroring isVisibleTo(): sellers
   * and buyers see their own invoices in any status; financiers see
   * invoices open for bidding plus any they've ever bid on (so winning
   * one doesn't make it disappear from their list); admins see everything.
   */
  async list(currentUser: AuthenticatedUser): Promise<InvoiceResponseDto[]> {
    let invoices: Invoice[];
    switch (currentUser.role) {
      case UserRole.SME:
        invoices = await this.invoicesRepository.findBySellerId(currentUser.id);
        break;
      case UserRole.BUYER:
        invoices = await this.invoicesRepository.findByBuyerId(currentUser.id);
        break;
      case UserRole.FINANCIER:
        invoices = await this.invoicesRepository.findRelevantToFinancier(currentUser.id);
        break;
      case UserRole.ADMIN:
        invoices = await this.invoicesRepository.findAll();
        break;
    }
    return invoices.map(InvoiceResponseDto.fromEntity);
  }

  /**
   * SME uploads a supporting document (PDF/image) for a buyer/financier to
   * cross-check against. Purely additive to the structured fields — never
   * parsed, never a data source. Re-uploading replaces the previous file
   * (old one is removed from disk so orphans don't pile up).
   */
  async attachDocument(invoiceId: string, currentUserId: string, file: Express.Multer.File): Promise<InvoiceResponseDto> {
    const invoice = await this.invoicesRepository.findById(invoiceId);
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    if (invoice.sellerId !== currentUserId) {
      throw new ForbiddenException('Only the invoice owner can attach a document');
    }

    const previousKey = invoice.documentStorageKey;
    await this.invoicesRepository.updateDocument(invoiceId, {
      documentOriginalName: file.originalname,
      documentStorageKey: file.filename,
      documentMimeType: file.mimetype,
      documentSizeBytes: file.size,
      documentUploadedAt: new Date(),
    });

    if (previousKey) {
      const previousPath = join(INVOICE_DOCUMENTS_DIR, previousKey);
      if (existsSync(previousPath)) {
        unlink(previousPath, () => {}); // best effort; an orphaned old file is harmless
      }
    }

    const updated = await this.invoicesRepository.findById(invoiceId);
    return InvoiceResponseDto.fromEntity(updated!);
  }

  /** Same visibility rule as getById — download access mirrors read access. */
  async getDocumentForDownload(
    invoiceId: string,
    currentUser: AuthenticatedUser,
  ): Promise<{ path: string; originalName: string; mimeType: string }> {
    const invoice = await this.invoicesRepository.findById(invoiceId);
    if (!invoice || !(await this.isVisibleTo(invoice, currentUser))) {
      throw new NotFoundException('Invoice not found');
    }
    if (!invoice.documentStorageKey) {
      throw new NotFoundException('No document attached to this invoice');
    }
    return {
      path: join(INVOICE_DOCUMENTS_DIR, invoice.documentStorageKey),
      originalName: invoice.documentOriginalName ?? 'document',
      mimeType: invoice.documentMimeType ?? 'application/octet-stream',
    };
  }

  /**
   * Thresholds are a deliberate judgement call, not a formula: a couple of
   * days late is normal commercial friction, ten-plus days is a pattern
   * worth pricing for, and a prior default outranks any amount of
   * otherwise-good history.
   */
  async getBuyerReliability(buyerId: string): Promise<BuyerReliabilityResponseDto> {
    const buyer = await this.usersRepository.findById(buyerId);
    if (!buyer || buyer.role !== UserRole.BUYER) {
      throw new NotFoundException('Buyer not found');
    }

    const stats = await this.invoicesRepository.getBuyerPaymentStats(buyerId);

    let rating: BuyerReliabilityRating;
    if (stats.defaultedCount > 0) {
      rating = BuyerReliabilityRating.HAS_DEFAULTED;
    } else if (stats.settledCount === 0) {
      rating = BuyerReliabilityRating.NO_HISTORY;
    } else if (stats.avgDaysLate <= 2) {
      rating = BuyerReliabilityRating.RELIABLE;
    } else if (stats.avgDaysLate <= 10) {
      rating = BuyerReliabilityRating.SLIGHTLY_LATE;
    } else {
      rating = BuyerReliabilityRating.HABITUALLY_LATE;
    }

    return {
      buyerId,
      companyName: buyer.companyName,
      rating,
      ...stats,
      onTimePercentage:
        stats.settledCount === 0 ? 0 : Math.round((stats.onTimeCount / stats.settledCount) * 100),
    };
  }

  private async isVisibleTo(invoice: Invoice, user: AuthenticatedUser): Promise<boolean> {
    if (user.role === UserRole.ADMIN) return true;
    if (invoice.sellerId === user.id || invoice.buyerId === user.id) return true;
    if (user.role === UserRole.FINANCIER) {
      if (invoice.status === InvoiceStatus.CONFIRMED) return true;
      // Still visible if they ever bid on it, even after it moved past CONFIRMED.
      const hasOffer = await this.dataSource
        .getRepository(FinancingOffer)
        .exists({ where: { invoiceId: invoice.id, financierId: user.id } });
      return hasOffer;
    }
    return false;
  }
}
