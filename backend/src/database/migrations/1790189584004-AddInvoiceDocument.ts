import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInvoiceDocument1790189584004 implements MigrationInterface {
  name = 'AddInvoiceDocument1790189584004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Nullable, additive columns for an optional supporting document (a
    // PDF/image the SME attaches for buyer/financier reference) — not
    // parsed or trusted as a data source, just stored alongside the
    // structured invoice fields that remain the source of truth.
    await queryRunner.query(`
      ALTER TABLE "invoices"
      ADD COLUMN "document_original_name" TEXT,
      ADD COLUMN "document_storage_key" TEXT,
      ADD COLUMN "document_mime_type" TEXT,
      ADD COLUMN "document_size_bytes" INTEGER,
      ADD COLUMN "document_uploaded_at" TIMESTAMPTZ
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "invoices"
      DROP COLUMN "document_original_name",
      DROP COLUMN "document_storage_key",
      DROP COLUMN "document_mime_type",
      DROP COLUMN "document_size_bytes",
      DROP COLUMN "document_uploaded_at"
    `);
  }
}
