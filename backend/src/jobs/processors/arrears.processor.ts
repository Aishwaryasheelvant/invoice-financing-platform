import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { LedgerService } from '../../ledger/ledger.service';
import { ProcessArrearsJobData, QUEUE_NAMES } from '../queues/queue-names';

/**
 * Handles one overdue/defaulting invoice. The decision about *which*
 * transition applies is made inside LedgerService under a row lock, not
 * here — this processor only supplies the invoice id and the grace period,
 * so a stale read in the scan can never cause a wrong write.
 */
@Processor(QUEUE_NAMES.ARREARS)
export class ArrearsProcessor extends WorkerHost {
  private readonly logger = new Logger(ArrearsProcessor.name);

  constructor(
    private readonly ledgerService: LedgerService,
    private readonly configService: ConfigService,
  ) {
    super();
  }

  async process(job: Job<ProcessArrearsJobData>): Promise<void> {
    const gracePeriodDays = Number(this.configService.get('DEFAULT_GRACE_PERIOD_DAYS', 30));
    this.logger.log(
      `Reviewing arrears for invoice ${job.data.invoiceId} (grace ${gracePeriodDays}d, attempt ${job.attemptsMade + 1})`,
    );
    await this.ledgerService.processArrears(job.data.invoiceId, gracePeriodDays);
  }
}
