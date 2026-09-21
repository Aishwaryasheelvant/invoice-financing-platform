import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditLog } from '../entities/audit-log.entity';

@Injectable()
export class AuditLogsRepository {
  constructor(
    @InjectRepository(AuditLog)
    private readonly repository: Repository<AuditLog>,
  ) {}

  async record(
    data: {
      entityType: string;
      entityId: string;
      fromStatus?: string | null;
      toStatus?: string | null;
      actorId?: string | null;
      metadata?: Record<string, unknown> | null;
    },
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager ? manager.getRepository(AuditLog) : this.repository;
    const log = repo.create({
      entityType: data.entityType,
      entityId: data.entityId,
      fromStatus: data.fromStatus ?? null,
      toStatus: data.toStatus ?? null,
      actorId: data.actorId ?? null,
      metadata: data.metadata ?? null,
    });
    await repo.save(log);
  }
}
