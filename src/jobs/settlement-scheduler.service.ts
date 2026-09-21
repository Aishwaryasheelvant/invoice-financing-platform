import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { JOB_NAMES, QUEUE_NAMES } from './queues/queue-names';

/**
 * Registers the recurring settlement scan as a BullMQ repeatable job at
 * startup, rather than using a separate cron library — one scheduling
 * mechanism (BullMQ + Redis) for the whole app instead of two.
 *
 * The fixed jobId is what makes this safe to run on every app boot:
 * BullMQ keys a repeatable job by its id, so re-registering the same
 * pattern under the same id on the next deploy/restart replaces it
 * rather than piling up duplicate schedules.
 */
@Injectable()
export class SettlementSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SettlementSchedulerService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.SETTLEMENT_SCAN) private readonly settlementScanQueue: Queue,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const pattern = this.configService.get<string>('SETTLEMENT_SCAN_CRON', '0 0 * * *');
    await this.settlementScanQueue.add(
      JOB_NAMES.SCAN_DUE_INVOICES,
      {},
      { repeat: { pattern }, jobId: 'daily-settlement-scan' },
    );
    this.logger.log(`Settlement scan scheduled with cron pattern "${pattern}"`);
  }
}
