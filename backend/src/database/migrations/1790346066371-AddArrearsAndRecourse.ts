import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddArrearsAndRecourse1790346066371 implements MigrationInterface {
  name = 'AddArrearsAndRecourse1790346066371';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // When the buyer actually paid, and when the debt was written off to
    // recourse. Both nullable — an invoice has neither until it happens.
    // `paid_at` vs `due_date` is what buyer-reliability stats are computed
    // from, which is why it's stored rather than inferred from a
    // transaction timestamp: it's queried in aggregate across invoices.
    await queryRunner.query(`
      ALTER TABLE "invoices"
      ADD COLUMN "paid_at" TIMESTAMPTZ,
      ADD COLUMN "defaulted_at" TIMESTAMPTZ
    `);

    // Recourse factoring: when a buyer defaults, the SME repays the
    // financier's advance. That's a distinct money movement from the
    // normal settlement legs, so it gets its own type.
    await queryRunner.query(
      `ALTER TYPE "transaction_type" ADD VALUE IF NOT EXISTS 'sme_recourse_to_financier'`,
    );

    // The arrears scan filters on these two combinations constantly.
    await queryRunner.query(`CREATE INDEX "invoices_paid_at_idx" ON "invoices" ("paid_at")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "invoices_paid_at_idx"`);
    await queryRunner.query(`
      ALTER TABLE "invoices"
      DROP COLUMN "paid_at",
      DROP COLUMN "defaulted_at"
    `);
    // Postgres has no DROP VALUE for enums; the added value is left in
    // place (harmless, additive) rather than recreating the whole type.
  }
}
