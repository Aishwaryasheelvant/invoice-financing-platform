import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from './queue-names';

/**
 * Declares every queue in one place and re-exports BullModule so both
 * producers (FinancingOffersService enqueuing a payout) and consumers
 * (the processors in JobsModule) can import just this module instead of
 * repeating registerQueue() calls with the queue names spelled out again.
 */
@Module({
  imports: [
    BullModule.registerQueue(
      {
        name: QUEUE_NAMES.PAYOUTS,
        defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 2000 } },
      },
      {
        name: QUEUE_NAMES.SETTLEMENTS,
        defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 2000 } },
      },
      { name: QUEUE_NAMES.SETTLEMENT_SCAN },
    ),
  ],
  exports: [BullModule],
})
export class QueuesModule {}
