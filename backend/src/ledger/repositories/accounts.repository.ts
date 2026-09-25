import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { Account } from '../entities/account.entity';
import { AccountOwnerType } from '../enums/account-owner-type.enum';
import { AccountType } from '../enums/account-type.enum';

interface AccountKey {
  ownerType: AccountOwnerType;
  ownerId: string | null;
  accountType: AccountType;
  currency: string;
}

@Injectable()
export class AccountsRepository {
  constructor(
    @InjectRepository(Account)
    private readonly repository: Repository<Account>,
  ) {}

  private repo(manager?: EntityManager): Repository<Account> {
    return manager ? manager.getRepository(Account) : this.repository;
  }

  findByIdForUpdate(id: string, manager: EntityManager): Promise<Account | null> {
    return manager.findOne(Account, { where: { id }, lock: { mode: 'pessimistic_write' } });
  }

  /**
   * Lazily creates a wallet/escrow/clearing account on first use.
   * `ON CONFLICT DO NOTHING` + re-select makes this race-safe: two
   * concurrent callers creating the same account for the first time
   * (e.g. a user's very first wallet) can't both succeed at inserting —
   * the partial unique indexes from the initial migration reject the
   * loser, which then just reads the winner's row back.
   */
  private async findOrCreate(key: AccountKey, manager?: EntityManager): Promise<Account> {
    const repo = this.repo(manager);
    // TypeORM's FindOptionsWhere type wants IsNull() rather than a plain
    // `null` literal for a nullable column, even though `null` is the
    // literal value that has to go in the INSERT itself.
    const where = { ...key, ownerId: key.ownerId === null ? IsNull() : key.ownerId };

    const existing = await repo.findOne({ where });
    if (existing) {
      return existing;
    }

    await repo.createQueryBuilder().insert().into(Account).values(key).orIgnore().execute();

    const account = await repo.findOne({ where });
    if (!account) {
      throw new Error(`Failed to find-or-create account for ${JSON.stringify(key)}`);
    }
    return account;
  }

  findOrCreateWallet(userId: string, currency: string, manager?: EntityManager): Promise<Account> {
    return this.findOrCreate(
      { ownerType: AccountOwnerType.USER, ownerId: userId, accountType: AccountType.WALLET, currency },
      manager,
    );
  }

  findOrCreateEscrowAccount(invoiceId: string, currency: string, manager?: EntityManager): Promise<Account> {
    return this.findOrCreate(
      { ownerType: AccountOwnerType.INVOICE_ESCROW, ownerId: invoiceId, accountType: AccountType.ESCROW, currency },
      manager,
    );
  }

  findOrCreateClearingAccount(currency: string, manager?: EntityManager): Promise<Account> {
    return this.findOrCreate(
      { ownerType: AccountOwnerType.PLATFORM, ownerId: null, accountType: AccountType.CLEARING, currency },
      manager,
    );
  }
}
