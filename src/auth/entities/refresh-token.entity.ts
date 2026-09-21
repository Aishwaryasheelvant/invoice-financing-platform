import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';

/**
 * One row per issued refresh token, used for rotation + revocation.
 *
 * `id` (not a generated default here, see PrimaryColumn) is chosen
 * client-side with crypto.randomUUID() *before* the refresh JWT is
 * signed, so it can be embedded as the JWT's `jti` claim and looked up
 * in O(1) on refresh without scanning by token value.
 *
 * `tokenHash` is sha256 of the full signed refresh JWT string, not the
 * raw token itself — a DB leak alone does not hand out usable tokens.
 *
 * Unlike the financial tables, this is a plain mutable table (rows are
 * revoked in place) and rows cascade-delete with their user: refresh
 * tokens are session state, not an audit record.
 */
@Entity('refresh_tokens')
@Index(['userId'])
@Index(['userId', 'revokedAt'])
export class RefreshToken {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'token_hash', type: 'text' })
  tokenHash: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ name: 'replaced_by_id', type: 'uuid', nullable: true })
  replacedById: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
