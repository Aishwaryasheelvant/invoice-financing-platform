import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { RefreshToken } from '../entities/refresh-token.entity';

@Injectable()
export class RefreshTokensRepository {
  constructor(
    @InjectRepository(RefreshToken)
    private readonly repository: Repository<RefreshToken>,
  ) {}

  /**
   * Every method accepts an optional transaction-scoped EntityManager so
   * callers can compose reads/writes into one atomic unit (e.g. lock +
   * validate + rotate a token) — falls back to the ordinary injected
   * repository (auto-committing per statement) when omitted.
   */
  private repo(manager?: EntityManager): Repository<RefreshToken> {
    return manager ? manager.getRepository(RefreshToken) : this.repository;
  }

  findById(id: string, manager?: EntityManager): Promise<RefreshToken | null> {
    return this.repo(manager).findOne({ where: { id } });
  }

  /** Locks the row for update within the given transaction — required before rotating it. */
  findByIdForUpdate(id: string, manager: EntityManager): Promise<RefreshToken | null> {
    return manager.findOne(RefreshToken, { where: { id }, lock: { mode: 'pessimistic_write' } });
  }

  async insert(
    data: { id: string; userId: string; tokenHash: string; expiresAt: Date },
    manager?: EntityManager,
  ): Promise<RefreshToken> {
    const repo = this.repo(manager);
    const token = repo.create({ ...data, revokedAt: null, replacedById: null });
    return repo.save(token);
  }

  /** Rotation: atomically mark the old token revoked and point it at its replacement. */
  async revokeAndReplace(id: string, replacedById: string, manager?: EntityManager): Promise<void> {
    await this.repo(manager).update({ id }, { revokedAt: new Date(), replacedById });
  }

  async revoke(id: string, manager?: EntityManager): Promise<void> {
    await this.repo(manager).update({ id }, { revokedAt: new Date() });
  }

  /** Security response to detected refresh-token reuse: kill every session for the user. */
  async revokeAllForUser(userId: string, manager?: EntityManager): Promise<void> {
    await this.repo(manager).update({ userId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }
}
