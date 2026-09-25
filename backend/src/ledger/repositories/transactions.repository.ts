import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Transaction } from '../entities/transaction.entity';
import { TransactionStatus } from '../enums/transaction-status.enum';
import { TransactionType } from '../enums/transaction-type.enum';

@Injectable()
export class TransactionsRepository {
  constructor(
    @InjectRepository(Transaction)
    private readonly repository: Repository<Transaction>,
  ) {}

  private repo(manager?: EntityManager): Repository<Transaction> {
    return manager ? manager.getRepository(Transaction) : this.repository;
  }

  findByIdempotencyKey(idempotencyKey: string, manager?: EntityManager): Promise<Transaction | null> {
    return this.repo(manager).findOne({ where: { idempotencyKey } });
  }

  findByInvoiceId(invoiceId: string): Promise<Transaction[]> {
    return this.repository.find({ where: { invoiceId }, order: { createdAt: 'ASC' } });
  }

  async insert(
    data: {
      invoiceId: string;
      type: TransactionType;
      amount: string;
      currency: string;
      idempotencyKey: string;
      initiatedBy?: string | null;
    },
    manager?: EntityManager,
  ): Promise<Transaction> {
    const repo = this.repo(manager);
    const transaction = repo.create({
      ...data,
      initiatedBy: data.initiatedBy ?? null,
      status: TransactionStatus.COMPLETED,
      completedAt: new Date(),
    });
    return repo.save(transaction);
  }
}
