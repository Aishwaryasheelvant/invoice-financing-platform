import { Column, Entity } from 'typeorm';
import { UuidEntity } from '../../common/entities/base.entity';
import { AccountOwnerType } from '../enums/account-owner-type.enum';
import { AccountType } from '../enums/account-type.enum';

/**
 * A ledger account. `ownerId` is polymorphic (a user id for wallets, an
 * invoice id for an escrow pot, null for the single platform revenue
 * account) so it intentionally carries no FK constraint — uniqueness and
 * nullability of ownerId are enforced at the DB via the constraints/indexes
 * created in the initial migration, not here.
 */
@Entity('accounts')
export class Account extends UuidEntity {
  @Column({ name: 'owner_type', type: 'enum', enum: AccountOwnerType, enumName: 'account_owner_type' })
  ownerType: AccountOwnerType;

  @Column({ name: 'owner_id', type: 'uuid', nullable: true })
  ownerId: string | null;

  @Column({ name: 'account_type', type: 'enum', enum: AccountType, enumName: 'account_type' })
  accountType: AccountType;

  @Column({ type: 'char', length: 3 })
  currency: string;
}
