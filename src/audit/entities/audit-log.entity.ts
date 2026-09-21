import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { UuidEntity } from '../../common/entities/base.entity';
import { User } from '../../users/entities/user.entity';

/**
 * Generic append-only audit trail (e.g. invoice status transitions, offer
 * acceptance) shared across entity types, instead of one history table per
 * entity.
 */
@Entity('audit_logs')
@Index(['entityType', 'entityId', 'createdAt'])
export class AuditLog extends UuidEntity {
  @Column({ name: 'entity_type', type: 'text' })
  entityType: string;

  @Column({ name: 'entity_id', type: 'uuid' })
  entityId: string;

  @Column({ name: 'from_status', type: 'text', nullable: true })
  fromStatus: string | null;

  @Column({ name: 'to_status', type: 'text', nullable: true })
  toStatus: string | null;

  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'actor_id' })
  actor: User | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
