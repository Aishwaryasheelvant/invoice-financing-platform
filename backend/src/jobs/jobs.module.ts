import { Module } from '@nestjs/common';
import { InvoicesModule } from '../invoices/invoices.module';
import { LedgerModule } from '../ledger/ledger.module';
import { PayoutsProcessor } from './processors/payouts.processor';
import { SettlementProcessor } from './processors/settlement.processor';
import { SettlementScanProcessor } from './processors/settlement-scan.processor';
import { QueuesModule } from './queues/queues.module';
import { SettlementSchedulerService } from './settlement-scheduler.service';

@Module({
  imports: [QueuesModule, LedgerModule, InvoicesModule],
  providers: [PayoutsProcessor, SettlementProcessor, SettlementScanProcessor, SettlementSchedulerService],
})
export class JobsModule {}
