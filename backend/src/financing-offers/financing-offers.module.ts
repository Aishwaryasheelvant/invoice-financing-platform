import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { QueuesModule } from '../jobs/queues/queues.module';
import { FinancingOffer } from './entities/financing-offer.entity';
import { FinancingOffersController } from './financing-offers.controller';
import { FinancingOffersService } from './financing-offers.service';
import { FinancingOffersRepository } from './repositories/financing-offers.repository';

@Module({
  imports: [TypeOrmModule.forFeature([FinancingOffer]), InvoicesModule, AuditModule, QueuesModule],
  controllers: [FinancingOffersController],
  providers: [FinancingOffersService, FinancingOffersRepository],
  exports: [FinancingOffersRepository],
})
export class FinancingOffersModule {}
