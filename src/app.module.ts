import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './audit/entities/audit-log.entity';
import { AuthModule } from './auth/auth.module';
import { RefreshToken } from './auth/entities/refresh-token.entity';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { FinancingOffer } from './financing-offers/entities/financing-offer.entity';
import { FinancingOffersModule } from './financing-offers/financing-offers.module';
import { Invoice } from './invoices/entities/invoice.entity';
import { InvoicesModule } from './invoices/invoices.module';
import { JobsModule } from './jobs/jobs.module';
import { Account } from './ledger/entities/account.entity';
import { EscrowLedgerEntry } from './ledger/entities/escrow-ledger-entry.entity';
import { Transaction } from './ledger/entities/transaction.entity';
import { LedgerModule } from './ledger/ledger.module';
import { User } from './users/entities/user.entity';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST', 'localhost'),
        port: config.get<number>('DB_PORT', 5432),
        username: config.get<string>('DB_USERNAME', 'postgres'),
        password: config.get<string>('DB_PASSWORD', 'postgres'),
        database: config.get<string>('DB_DATABASE', 'invoice_financing'),
        entities: [User, Invoice, FinancingOffer, Account, Transaction, EscrowLedgerEntry, AuditLog, RefreshToken],
        // Schema is managed exclusively through migrations (see src/database).
        synchronize: false,
        migrationsRun: false,
      }),
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          // Global default; individual routes (e.g. auth/login) tighten
          // this further with their own @Throttle() override.
          ttl: config.get<number>('THROTTLE_TTL_MS', 60_000),
          limit: config.get<number>('THROTTLE_LIMIT', 100),
          // Escape hatch for the e2e test suite only: it legitimately
          // fires many rapid requests from a single IP, which real
          // brute-force protection can't tell apart from an attack.
          // Never set in dev/production.
          skipIf: () => config.get('THROTTLE_DISABLED') === 'true',
        },
      ],
    }),
    UsersModule,
    AuthModule,
    InvoicesModule,
    FinancingOffersModule,
    LedgerModule,
    JobsModule,
  ],
  providers: [
    // Order matters: rate-limit first (cheapest check, and it should
    // reject floods before they touch auth/DB work), then JwtAuthGuard
    // populates req.user, then RolesGuard reads it.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
