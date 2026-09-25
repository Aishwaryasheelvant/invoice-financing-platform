import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, LessThan, Repository } from 'typeorm';
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
    extra?: { confirmedAt?: Date; paidAt?: Date; defaultedAt?: Date },
  ): Promise<void> {
    await manager.update(Invoice, { id }, { status, ...extra });
  }

  /**
   * Invoices the arrears scan needs to look at: financed but unpaid past
   * their due date (candidates to mark OVERDUE), plus already-overdue ones
   * (candidates to default once the grace period has elapsed). The scan
   * doesn't decide here — it fans each one out to a job that re-reads
   * under a lock.
   */
  findNeedingArrearsReview(asOf: Date): Promise<Invoice[]> {
    return this.repository.find({
      where: [
        { status: InvoiceStatus.FINANCED, dueDate: LessThan(asOf.toISOString().slice(0, 10)) },
        { status: InvoiceStatus.OVERDUE },
      ],
      order: { dueDate: 'ASC' },
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

  /**
   * Payment-behaviour aggregate for one buyer, computed in the database
   * rather than by loading invoices into memory — this is a reporting
   * query that grows with the buyer's history, not a per-row operation.
   *
   * `paid_at::date - due_date` is Postgres integer day arithmetic; GREATEST
   * with 0 means paying early counts the same as paying on time rather
   * than offsetting genuine lateness elsewhere in the average.
   */
  async getBuyerPaymentStats(buyerId: string): Promise<{
    settledCount: number;
    onTimeCount: number;
    lateCount: number;
    avgDaysLate: number;
    maxDaysLate: number;
    currentlyOverdueCount: number;
    defaultedCount: number;
  }> {
    const [row] = await this.repository.query(
      `
      SELECT
        COUNT(*) FILTER (WHERE status = 'settled' AND paid_at IS NOT NULL)                              AS settled_count,
        COUNT(*) FILTER (WHERE status = 'settled' AND paid_at IS NOT NULL AND paid_at::date <= due_date) AS on_time_count,
        COUNT(*) FILTER (WHERE status = 'settled' AND paid_at IS NOT NULL AND paid_at::date >  due_date) AS late_count,
        COALESCE(AVG(GREATEST(paid_at::date - due_date, 0))
                 FILTER (WHERE status = 'settled' AND paid_at IS NOT NULL), 0)                           AS avg_days_late,
        COALESCE(MAX(GREATEST(paid_at::date - due_date, 0))
                 FILTER (WHERE status = 'settled' AND paid_at IS NOT NULL), 0)                           AS max_days_late,
        COUNT(*) FILTER (WHERE status = 'overdue')                                                       AS currently_overdue_count,
        COUNT(*) FILTER (WHERE status = 'defaulted')                                                     AS defaulted_count
      FROM invoices
      WHERE buyer_id = $1
      `,
      [buyerId],
    );

    return {
      settledCount: Number(row.settled_count),
      onTimeCount: Number(row.on_time_count),
      lateCount: Number(row.late_count),
      avgDaysLate: Number(Number(row.avg_days_late).toFixed(1)),
      maxDaysLate: Number(row.max_days_late),
      currentlyOverdueCount: Number(row.currently_overdue_count),
      defaultedCount: Number(row.defaulted_count),
    };
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
