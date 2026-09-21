import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { UuidEntity } from '../../common/entities/base.entity';
import { Invoice } from '../../invoices/entities/invoice.entity';
import { Account } from './account.entity';
import { Transaction } from './transaction.entity';
import { LedgerEntryType } from '../enums/ledger-entry-type.enum';

/**
 * Append-only double-entry ledger row — the single source of financial
 * truth. There is deliberately no `updatedAt`/`deletedAt` here and no
 * repository update/delete method should ever target this table: the
 * initial migration installs a DB trigger that rejects UPDATE and DELETE
 * on `escrow_ledger` outright, so corrections must be new offsetting
 * entries, never edits, even if application code has a bug.
 *
 * Invariant enforced by LedgerService (not by the DB): for any given
 * transactionId, SUM(amount WHERE entry_type='debit') must equal
 * SUM(amount WHERE entry_type='credit').
 */
@Entity('escrow_ledger')
@Index(['invoiceId', 'createdAt'])
@Index(['accountId', 'createdAt'])
export class EscrowLedgerEntry extends UuidEntity {
  @Column({ name: 'transaction_id', type: 'uuid' })
  transactionId: string;

  @ManyToOne(() => Transaction, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'transaction_id' })
  transaction: Transaction;

  @Column({ name: 'invoice_id', type: 'uuid' })
  invoiceId: string;

  @ManyToOne(() => Invoice, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId: string;

  @ManyToOne(() => Account, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @Column({ name: 'entry_type', type: 'enum', enum: LedgerEntryType, enumName: 'ledger_entry_type' })
  entryType: LedgerEntryType;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  amount: string;

  @Column({ name: 'balance_after', type: 'numeric', precision: 14, scale: 2 })
  balanceAfter: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
