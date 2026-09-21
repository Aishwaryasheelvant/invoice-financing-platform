import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClearingAccountType1789825468917 implements MigrationInterface {
  name = 'AddClearingAccountType1789825468917';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "account_type" ADD VALUE IF NOT EXISTS 'clearing'`);
  }

  public async down(): Promise<void> {
    // Postgres has no DROP VALUE for enums. Reverting would require
    // recreating the type and every column that uses it; not needed for
    // an additive, backwards-compatible change like this one.
  }
}
