import 'dotenv/config';
import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { FinancingOffer } from '../financing-offers/entities/financing-offer.entity';
import { Account } from '../ledger/entities/account.entity';
import { Transaction } from '../ledger/entities/transaction.entity';
import { EscrowLedgerEntry } from '../ledger/entities/escrow-ledger-entry.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';

/**
 * Used by the TypeORM CLI (migration:generate/run/revert) and by
 * TypeOrmModule at runtime. `synchronize` is never enabled — schema
 * changes only ever happen through a reviewed migration file.
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USERNAME ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  database: process.env.DB_DATABASE ?? 'invoice_financing',
  synchronize: false,
  entities: [User, Invoice, FinancingOffer, Account, Transaction, EscrowLedgerEntry, AuditLog, RefreshToken],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
});
