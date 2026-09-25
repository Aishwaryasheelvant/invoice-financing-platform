import { Module } from '@nestjs/common';
import { InvoicesModule } from '../invoices/invoices.module';
import { LedgerModule } from '../ledger/ledger.module';
import { ArrearsSchedulerService } from './arrears-scheduler.service';
import { ArrearsProcessor } from './processors/arrears.processor';
import { ArrearsScanProcessor } from './processors/arrears-scan.processor';
import { PayoutsProcessor } from './processors/payouts.processor';
import { QueuesModule } from './queues/queues.module';

@Module({
  imports: [QueuesModule, LedgerModule, InvoicesModule],
  providers: [PayoutsProcessor, ArrearsProcessor, ArrearsScanProcessor, ArrearsSchedulerService],
})
export class JobsModule {}
