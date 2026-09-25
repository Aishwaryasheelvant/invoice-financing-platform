import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';
import { UuidEntity } from '../../common/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { InvoiceStatus } from '../enums/invoice-status.enum';

@Entity('invoices')
@Index(['sellerId', 'invoiceNumber'], { unique: true })
@Index(['buyerId', 'status'])
@Index(['status', 'dueDate'])
export class Invoice extends UuidEntity {
  @Column({ name: 'seller_id', type: 'uuid' })
  sellerId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'seller_id' })
  seller: User;

  @Column({ name: 'buyer_id', type: 'uuid' })
  buyerId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'buyer_id' })
  buyer: User;

  @Column({ name: 'invoice_number', type: 'text' })
  invoiceNumber: string;

  /**
   * Kept as a string, not number: Postgres NUMERIC is returned by the pg
   * driver as a string precisely to avoid silent float precision loss, and
   * the entity preserves that instead of coercing it back to a JS number.
   */
  @Column({ name: 'face_value', type: 'numeric', precision: 14, scale: 2 })
  faceValue: string;

  @Column({ type: 'char', length: 3 })
  currency: string;

  @Column({ name: 'issue_date', type: 'date' })
  issueDate: string;

  @Column({ name: 'due_date', type: 'date' })
  dueDate: string;

  @Column({
    type: 'enum',
    enum: InvoiceStatus,
    enumName: 'invoice_status',
    default: InvoiceStatus.DRAFT,
  })
  status: InvoiceStatus;

  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt: Date | null;

  /** When the buyer actually paid. Compared against dueDate for reliability stats. */
  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  /** When the debt was written off to recourse (SME repaid the financier's advance). */
  @Column({ name: 'defaulted_at', type: 'timestamptz', nullable: true })
  defaultedAt: Date | null;

  /**
   * An optional supporting document (PDF/image) the SME attaches for the
   * buyer/financier to cross-check against — never parsed, never trusted
   * as a data source. The structured fields above remain authoritative.
   */
  @Column({ name: 'document_original_name', type: 'text', nullable: true })
  documentOriginalName: string | null;

  @Column({ name: 'document_storage_key', type: 'text', nullable: true })
  documentStorageKey: string | null;

  @Column({ name: 'document_mime_type', type: 'text', nullable: true })
  documentMimeType: string | null;

  @Column({ name: 'document_size_bytes', type: 'int', nullable: true })
  documentSizeBytes: number | null;

  @Column({ name: 'document_uploaded_at', type: 'timestamptz', nullable: true })
  documentUploadedAt: Date | null;

  /**
   * Optimistic-locking column for low-contention edits (e.g. a draft
   * invoice's description). Money-moving/state-transition operations use
   * pessimistic row locks (SELECT ... FOR UPDATE) in the service layer
   * instead — see the ledger module.
   */
  @VersionColumn()
  version: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
