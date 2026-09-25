import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { FinancingOffersModule } from '../financing-offers/financing-offers.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { Account } from './entities/account.entity';
import { EscrowLedgerEntry } from './entities/escrow-ledger-entry.entity';
import { Transaction } from './entities/transaction.entity';
import { LedgerController } from './ledger.controller';
import { LedgerService } from './ledger.service';
import { AccountsRepository } from './repositories/accounts.repository';
import { EscrowLedgerRepository } from './repositories/escrow-ledger.repository';
import { TransactionsRepository } from './repositories/transactions.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([Account, Transaction, EscrowLedgerEntry]),
    InvoicesModule,
    FinancingOffersModule,
    AuditModule,
  ],
  controllers: [LedgerController],
  providers: [LedgerService, AccountsRepository, TransactionsRepository, EscrowLedgerRepository],
  exports: [LedgerService],
})
export class LedgerModule {}
