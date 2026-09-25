import { AppDataSource } from '../../src/database/data-source';

const APP_TABLES = [
  'escrow_ledger',
  'transactions',
  'financing_offers',
  'invoices',
  'accounts',
  'audit_logs',
  'refresh_tokens',
  'users',
];

async function getInitializedDataSource() {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
  return AppDataSource;
}

/** Wipes every app table between tests so each test starts from a clean, known state. */
export async function resetDatabase(): Promise<void> {
  const dataSource = await getInitializedDataSource();
  await dataSource.query(`TRUNCATE TABLE ${APP_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

export async function queryRaw<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const dataSource = await getInitializedDataSource();
  return dataSource.query(sql, params);
}

export async function closeDataSource(): Promise<void> {
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
}
