import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';
import { BuyerReliabilityController } from './buyer-reliability.controller';
import { Invoice } from './entities/invoice.entity';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { InvoicesRepository } from './repositories/invoices.repository';

@Module({
  imports: [TypeOrmModule.forFeature([Invoice]), AuditModule, UsersModule],
  controllers: [InvoicesController, BuyerReliabilityController],
  providers: [InvoicesService, InvoicesRepository],
  exports: [InvoicesRepository],
})
export class InvoicesModule {}
