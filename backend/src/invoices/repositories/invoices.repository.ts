import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, LessThanOrEqual, Repository } from 'typeorm';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceStatus } from '../enums/invoice-status.enum';

@Injectable()
export class InvoicesRepository {
  constructor(
    @InjectRepository(Invoice)
    private readonly repository: Repository<Invoice>,
  ) {}

  private repo(manager?: EntityManager): Repository<Invoice> {
    return manager ? manager.getRepository(Invoice) : this.repository;
  }

  findById(id: string, manager?: EntityManager): Promise<Invoice | null> {
    return this.repo(manager).findOne({ where: { id } });
  }

  /** Required before any status transition or offer-acceptance decision — see InvoiceStateMachine. */
  findByIdForUpdate(id: string, manager: EntityManager): Promise<Invoice | null> {
    return manager.findOne(Invoice, { where: { id }, lock: { mode: 'pessimistic_write' } });
  }

  async create(data: {
    sellerId: string;
    buyerId: string;
    invoiceNumber: string;
    faceValue: string;
    currency: string;
    issueDate: string;
    dueDate: string;
    status: InvoiceStatus;
  }): Promise<Invoice> {
    const invoice = this.repository.create(data);
    return this.repository.save(invoice);
  }

  async updateStatus(
    id: string,
    status: InvoiceStatus,
    manager: EntityManager,
    extra?: { confirmedAt?: Date },
  ): Promise<void> {
    await manager.update(Invoice, { id }, { status, ...extra });
  }

  /** Invoices whose financing is due to be settled: financed and past (or at) their due date. */
  findDueForSettlement(asOf: Date): Promise<Invoice[]> {
    return this.repository.find({
      where: { status: InvoiceStatus.FINANCED, dueDate: LessThanOrEqual(asOf.toISOString().slice(0, 10)) },
    });
  }

  findBySellerId(sellerId: string): Promise<Invoice[]> {
    return this.repository.find({ where: { sellerId }, order: { createdAt: 'DESC' } });
  }

  findByBuyerId(buyerId: string): Promise<Invoice[]> {
    return this.repository.find({ where: { buyerId }, order: { createdAt: 'DESC' } });
  }

  /** What financiers browse to find invoices worth bidding on. */
  findByStatus(status: InvoiceStatus): Promise<Invoice[]> {
    return this.repository.find({ where: { status }, order: { createdAt: 'DESC' } });
  }

  /**
   * What a financier sees: invoices currently open for bidding, plus any
   * invoice they've ever placed a bid on (won, lost, or still pending) —
   * so winning an invoice doesn't make it disappear from their list once
   * it moves past CONFIRMED. EXISTS rather than a JOIN specifically to
   * avoid row duplication if a financier has placed more than one offer
   * on the same invoice.
   */
  findRelevantToFinancier(financierId: string): Promise<Invoice[]> {
    return this.repository
      .createQueryBuilder('invoice')
      .where('invoice.status = :confirmed', { confirmed: InvoiceStatus.CONFIRMED })
      .orWhere(
        'EXISTS (SELECT 1 FROM financing_offers o WHERE o.invoice_id = invoice.id AND o.financier_id = :financierId)',
        { financierId },
      )
      .orderBy('invoice.created_at', 'DESC')
      .getMany();
  }

  findAll(): Promise<Invoice[]> {
    return this.repository.find({ order: { createdAt: 'DESC' } });
  }

  async updateDocument(
    id: string,
    document: {
      documentOriginalName: string;
      documentStorageKey: string;
      documentMimeType: string;
      documentSizeBytes: number;
      documentUploadedAt: Date;
    },
  ): Promise<void> {
    await this.repository.update({ id }, document);
  }
}
