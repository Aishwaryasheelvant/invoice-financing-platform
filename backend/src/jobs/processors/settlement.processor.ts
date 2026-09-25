import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { LedgerService } from '../../ledger/ledger.service';
import { QUEUE_NAMES, SettleInvoiceJobData } from '../queues/queue-names';

@Processor(QUEUE_NAMES.SETTLEMENTS)
export class SettlementProcessor extends WorkerHost {
  private readonly logger = new Logger(SettlementProcessor.name);

  constructor(private readonly ledgerService: LedgerService) {
    super();
  }

  async process(job: Job<SettleInvoiceJobData>): Promise<void> {
    this.logger.log(`Settling invoice ${job.data.invoiceId} (attempt ${job.attemptsMade + 1})`);
    await this.ledgerService.settleInvoice(job.data.invoiceId);
  }
}
