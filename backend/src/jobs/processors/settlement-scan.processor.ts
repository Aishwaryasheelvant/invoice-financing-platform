import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { InvoicesRepository } from '../../invoices/repositories/invoices.repository';
import { JOB_NAMES, QUEUE_NAMES, SettleInvoiceJobData } from '../queues/queue-names';

/**
 * The scheduled ("cron") half of settlement. Runs on a repeatable BullMQ
 * job (registered by SettlementSchedulerService) and fans out one
 * per-invoice job per due invoice, rather than settling them all inline
 * here — so one invoice failing to settle doesn't block or retry the
 * others, and each gets its own retry/backoff policy.
 */
@Processor(QUEUE_NAMES.SETTLEMENT_SCAN)
export class SettlementScanProcessor extends WorkerHost {
  private readonly logger = new Logger(SettlementScanProcessor.name);

  constructor(
    private readonly invoicesRepository: InvoicesRepository,
    @InjectQueue(QUEUE_NAMES.SETTLEMENTS) private readonly settlementsQueue: Queue<SettleInvoiceJobData>,
  ) {
    super();
  }

  async process(): Promise<void> {
    const dueInvoices = await this.invoicesRepository.findDueForSettlement(new Date());
    this.logger.log(`Settlement scan found ${dueInvoices.length} invoice(s) due`);

    for (const invoice of dueInvoices) {
      await this.settlementsQueue.add(
        JOB_NAMES.SETTLE_INVOICE,
        { invoiceId: invoice.id },
        // Deterministic id: if the scan somehow runs twice before the
        // first pass's jobs finish, the duplicate enqueue is a no-op
        // instead of scheduling the same settlement twice.
        { jobId: `settle-${invoice.id}` },
      );
    }
  }
}
