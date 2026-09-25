import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { JOB_NAMES, QUEUE_NAMES } from './queues/queue-names';

/**
 * Registers the recurring arrears scan as a BullMQ repeatable job at
 * startup, rather than pulling in a separate cron library — one scheduling
 * mechanism (BullMQ + Redis) for the whole app.
 *
 * The fixed jobId is what makes this safe to run on every boot: BullMQ keys
 * a repeatable job by its id, so re-registering the same pattern replaces
 * it rather than stacking up duplicate schedules across deploys.
 */
@Injectable()
export class ArrearsSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(ArrearsSchedulerService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.ARREARS_SCAN) private readonly arrearsScanQueue: Queue,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const pattern = this.configService.get<string>('ARREARS_SCAN_CRON', '0 0 * * *');
    const gracePeriodDays = this.configService.get<string>('DEFAULT_GRACE_PERIOD_DAYS', '30');
    await this.arrearsScanQueue.add(
      JOB_NAMES.SCAN_ARREARS,
      {},
      { repeat: { pattern }, jobId: 'daily-arrears-scan' },
    );
    this.logger.log(`Arrears scan scheduled "${pattern}" (default grace period ${gracePeriodDays} days)`);
  }
}
