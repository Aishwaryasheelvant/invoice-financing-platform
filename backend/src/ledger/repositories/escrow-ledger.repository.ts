import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Money } from '../../common/money';
import { EscrowLedgerEntry } from '../entities/escrow-ledger-entry.entity';
import { LedgerEntryType } from '../enums/ledger-entry-type.enum';

@Injectable()
export class EscrowLedgerRepository {
  constructor(
    @InjectRepository(EscrowLedgerEntry)
    private readonly repository: Repository<EscrowLedgerEntry>,
  ) {}

  private repo(manager?: EntityManager): Repository<EscrowLedgerEntry> {
    return manager ? manager.getRepository(EscrowLedgerEntry) : this.repository;
  }

  /**
   * Current balance for an account, computed by summing its posted
   * entries rather than trusting a cached counter column — the ledger
   * itself is the source of truth. Callers must hold a lock on the
   * account row (see AccountsRepository.findByIdForUpdate) before calling
   * this and posting a new entry, otherwise two concurrent postings could
   * both read the same starting balance.
   */
  async getBalance(accountId: string, manager: EntityManager): Promise<Money> {
    const entries = await this.repo(manager).find({ where: { accountId } });
    return entries.reduce(
      (balance, entry) =>
        entry.entryType === LedgerEntryType.CREDIT
          ? balance.plus(Money.of(entry.amount))
          : balance.minus(Money.of(entry.amount)),
      Money.zero(),
    );
  }

  async insert(
    data: {
      transactionId: string;
      invoiceId: string;
      accountId: string;
      entryType: LedgerEntryType;
      amount: string;
      balanceAfter: string;
    },
    manager: EntityManager,
  ): Promise<EscrowLedgerEntry> {
    const repo = this.repo(manager);
    const entry = repo.create(data);
    return repo.save(entry);
  }
}
