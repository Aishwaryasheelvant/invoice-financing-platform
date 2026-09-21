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
}
