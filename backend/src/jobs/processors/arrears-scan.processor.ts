import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { InvoicesRepository } from '../../invoices/repositories/invoices.repository';
import { JOB_NAMES, ProcessArrearsJobData, QUEUE_NAMES } from '../queues/queue-names';

/**
 * The scheduled half of arrears handling. Finds invoices that are financed
 * but unpaid past their due date, plus ones already overdue (which may now
 * be past the grace period), and fans each out to its own job — so one
 * invoice failing to process doesn't stall or retry the rest, and each gets
 * its own retry/backoff.
 *
 * Note this no longer settles anything: settlement happens when the buyer
 * actually pays. This job exists to handle the case where they don't.
 */
@Processor(QUEUE_NAMES.ARREARS_SCAN)
export class ArrearsScanProcessor extends WorkerHost {
  private readonly logger = new Logger(ArrearsScanProcessor.name);

  constructor(
    private readonly invoicesRepository: InvoicesRepository,
    @InjectQueue(QUEUE_NAMES.ARREARS) private readonly arrearsQueue: Queue<ProcessArrearsJobData>,
  ) {
    super();
  }

  async process(): Promise<void> {
    const invoices = await this.invoicesRepository.findNeedingArrearsReview(new Date());
    this.logger.log(`Arrears scan found ${invoices.length} invoice(s) to review`);

    for (const invoice of invoices) {
      await this.arrearsQueue.add(
        JOB_NAMES.PROCESS_ARREARS,
        { invoiceId: invoice.id },
        // Scoped to the invoice's current status: an invoice legitimately
        // needs reviewing twice over its life (once to go overdue, once to
        // default), but never twice for the same transition.
        { jobId: `arrears-${invoice.id}-${invoice.status}` },
      );
    }
  }
}
