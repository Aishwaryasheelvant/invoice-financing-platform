import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { LedgerService } from '../../ledger/ledger.service';
import { ProcessPayoutJobData, QUEUE_NAMES } from '../queues/queue-names';

@Processor(QUEUE_NAMES.PAYOUTS)
export class PayoutsProcessor extends WorkerHost {
  private readonly logger = new Logger(PayoutsProcessor.name);

  constructor(private readonly ledgerService: LedgerService) {
    super();
  }

  /**
   * Only carries the offer id — every amount is re-read from the DB
   * inside LedgerService rather than trusted from the job payload, so a
   * stale or tampered job body can't move the wrong amount of money.
   * recordFinancierPayout() is itself idempotent, so BullMQ retrying
   * this job after a transient failure (or redelivering it — BullMQ is
   * at-least-once) can never double-pay.
   */
  async process(job: Job<ProcessPayoutJobData>): Promise<void> {
    this.logger.log(`Processing payout for offer ${job.data.offerId} (attempt ${job.attemptsMade + 1})`);
    await this.ledgerService.recordFinancierPayout(job.data.offerId);
  }
}
