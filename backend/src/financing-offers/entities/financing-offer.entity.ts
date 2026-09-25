import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { UuidEntity } from '../../common/entities/base.entity';
import { Invoice } from '../../invoices/entities/invoice.entity';
import { User } from '../../users/entities/user.entity';
import { OfferStatus } from '../enums/offer-status.enum';

/**
 * Bids are effectively immutable: revising terms means withdrawing this row
 * and creating a new one, rather than updating amounts in place. The
 * invariant "at most one accepted offer per invoice" is enforced by a
 * partial unique index in the initial migration, not just in application
 * code.
 */
@Entity('financing_offers')
@Index(['invoiceId', 'status'])
@Index(['financierId', 'status'])
export class FinancingOffer extends UuidEntity {
  @Column({ name: 'invoice_id', type: 'uuid' })
  invoiceId: string;

  @ManyToOne(() => Invoice, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice;

  @Column({ name: 'financier_id', type: 'uuid' })
  financierId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'financier_id' })
  financier: User;

  @Column({ name: 'advance_rate', type: 'numeric', precision: 5, scale: 4 })
  advanceRate: string;

  @Column({ name: 'advance_amount', type: 'numeric', precision: 14, scale: 2 })
  advanceAmount: string;

  @Column({ name: 'fee_amount', type: 'numeric', precision: 14, scale: 2 })
  feeAmount: string;

  @Column({
    type: 'enum',
    enum: OfferStatus,
    enumName: 'offer_status',
    default: OfferStatus.PENDING,
  })
  status: OfferStatus;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt: Date | null;
}
