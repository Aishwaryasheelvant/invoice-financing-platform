import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitSchema1789818540217 implements MigrationInterface {
  name = 'InitSchema1789818540217';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- extensions -----------------------------------------------------
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS citext`);

    // --- enum types (native Postgres enums: reject invalid values at the
    // DB regardless of what the application layer does) ------------------
    await queryRunner.query(`CREATE TYPE "user_role" AS ENUM ('sme','buyer','financier','admin')`);
    await queryRunner.query(
      `CREATE TYPE "user_status" AS ENUM ('pending_verification','active','suspended','deactivated')`,
    );
    await queryRunner.query(
      `CREATE TYPE "invoice_status" AS ENUM ('draft','pending_buyer_confirmation','confirmed','open_for_bidding','financed','settled','overdue','defaulted','cancelled')`,
    );
    await queryRunner.query(
      `CREATE TYPE "offer_status" AS ENUM ('pending','accepted','rejected','withdrawn','expired')`,
    );
    await queryRunner.query(
      `CREATE TYPE "account_owner_type" AS ENUM ('user','invoice_escrow','platform')`,
    );
    await queryRunner.query(`CREATE TYPE "account_type" AS ENUM ('wallet','escrow','revenue')`);
    await queryRunner.query(
      `CREATE TYPE "transaction_type" AS ENUM ('financier_payout_to_sme','buyer_payment_to_escrow','escrow_release_to_financier','escrow_release_to_sme','platform_fee')`,
    );
    await queryRunner.query(
      `CREATE TYPE "transaction_status" AS ENUM ('pending','completed','failed','reversed')`,
    );
    await queryRunner.query(`CREATE TYPE "ledger_entry_type" AS ENUM ('debit','credit')`);

    // --- users ------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "email" CITEXT NOT NULL,
        "password_hash" TEXT NOT NULL,
        "role" user_role NOT NULL,
        "company_name" TEXT NOT NULL,
        "status" user_status NOT NULL DEFAULT 'pending_verification',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "users_email_key" ON "users" ("email")`);

    // --- accounts (polymorphic owner: user wallet, per-invoice escrow pot,
    // or the single platform revenue account) ------------------------------
    await queryRunner.query(`
      CREATE TABLE "accounts" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "owner_type" account_owner_type NOT NULL,
        "owner_id" UUID,
        "account_type" account_type NOT NULL,
        "currency" CHAR(3) NOT NULL,
        CONSTRAINT "accounts_owner_id_presence_check" CHECK (
          ("owner_type" = 'platform' AND "owner_id" IS NULL) OR
          ("owner_type" <> 'platform' AND "owner_id" IS NOT NULL)
        )
      )
    `);
    // Two partial unique indexes instead of one plain unique constraint:
    // Postgres treats NULLs as distinct, so a plain UNIQUE(owner_type,
    // owner_id, account_type, currency) would silently allow duplicate
    // platform accounts (owner_id always NULL there).
    await queryRunner.query(`
      CREATE UNIQUE INDEX "accounts_owned_unique" ON "accounts" ("owner_type", "owner_id", "account_type", "currency")
      WHERE "owner_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "accounts_platform_unique" ON "accounts" ("owner_type", "account_type", "currency")
      WHERE "owner_id" IS NULL
    `);

    // --- invoices -----------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "invoices" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "seller_id" UUID NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
        "buyer_id" UUID NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
        "invoice_number" TEXT NOT NULL,
        "face_value" NUMERIC(14,2) NOT NULL,
        "currency" CHAR(3) NOT NULL,
        "issue_date" DATE NOT NULL,
        "due_date" DATE NOT NULL,
        "status" invoice_status NOT NULL DEFAULT 'draft',
        "confirmed_at" TIMESTAMPTZ,
        "version" INTEGER NOT NULL DEFAULT 1,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "invoices_face_value_positive" CHECK ("face_value" > 0),
        CONSTRAINT "invoices_due_after_issue" CHECK ("due_date" > "issue_date")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "invoices_seller_invoice_number_key" ON "invoices" ("seller_id", "invoice_number")`,
    );
    await queryRunner.query(`CREATE INDEX "invoices_buyer_status_idx" ON "invoices" ("buyer_id", "status")`);
    await queryRunner.query(`CREATE INDEX "invoices_status_due_date_idx" ON "invoices" ("status", "due_date")`);

    // --- financing_offers -----------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "financing_offers" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "invoice_id" UUID NOT NULL REFERENCES "invoices" ("id") ON DELETE RESTRICT,
        "financier_id" UUID NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
        "advance_rate" NUMERIC(5,4) NOT NULL,
        "advance_amount" NUMERIC(14,2) NOT NULL,
        "fee_amount" NUMERIC(14,2) NOT NULL,
        "status" offer_status NOT NULL DEFAULT 'pending',
        "expires_at" TIMESTAMPTZ NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "decided_at" TIMESTAMPTZ,
        CONSTRAINT "financing_offers_advance_rate_range" CHECK ("advance_rate" > 0 AND "advance_rate" <= 1),
        CONSTRAINT "financing_offers_advance_amount_positive" CHECK ("advance_amount" > 0),
        CONSTRAINT "financing_offers_fee_amount_non_negative" CHECK ("fee_amount" >= 0),
        CONSTRAINT "financing_offers_expires_after_created" CHECK ("expires_at" > "created_at")
      )
    `);
    // The core anti-double-financing guarantee: only one *accepted* offer
    // can ever exist per invoice, enforced by the database itself.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "financing_offers_one_accepted_per_invoice" ON "financing_offers" ("invoice_id")
      WHERE "status" = 'accepted'
    `);
    await queryRunner.query(
      `CREATE INDEX "financing_offers_invoice_status_idx" ON "financing_offers" ("invoice_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "financing_offers_financier_status_idx" ON "financing_offers" ("financier_id", "status")`,
    );

    // --- transactions (operation lifecycle; idempotency guard lives here) ---
    await queryRunner.query(`
      CREATE TABLE "transactions" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "invoice_id" UUID NOT NULL REFERENCES "invoices" ("id") ON DELETE RESTRICT,
        "type" transaction_type NOT NULL,
        "amount" NUMERIC(14,2) NOT NULL,
        "currency" CHAR(3) NOT NULL,
        "status" transaction_status NOT NULL DEFAULT 'pending',
        "idempotency_key" TEXT NOT NULL,
        "external_reference" TEXT,
        "initiated_by" UUID REFERENCES "users" ("id") ON DELETE RESTRICT,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "completed_at" TIMESTAMPTZ,
        CONSTRAINT "transactions_amount_positive" CHECK ("amount" > 0)
      )
    `);
    // Retried payment calls (client retries, redelivered payment-gateway
    // webhooks, redelivered BullMQ jobs) all carry the same idempotency
    // key, so a duplicate INSERT fails fast at the DB instead of double-
    // processing money.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "transactions_idempotency_key_key" ON "transactions" ("idempotency_key")`,
    );
    await queryRunner.query(`CREATE INDEX "transactions_invoice_id_idx" ON "transactions" ("invoice_id")`);

    // --- escrow_ledger (append-only double-entry postings) -------------------
    await queryRunner.query(`
      CREATE TABLE "escrow_ledger" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "transaction_id" UUID NOT NULL REFERENCES "transactions" ("id") ON DELETE RESTRICT,
        "invoice_id" UUID NOT NULL REFERENCES "invoices" ("id") ON DELETE RESTRICT,
        "account_id" UUID NOT NULL REFERENCES "accounts" ("id") ON DELETE RESTRICT,
        "entry_type" ledger_entry_type NOT NULL,
        "amount" NUMERIC(14,2) NOT NULL,
        "balance_after" NUMERIC(14,2) NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "escrow_ledger_amount_positive" CHECK ("amount" > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "escrow_ledger_invoice_created_idx" ON "escrow_ledger" ("invoice_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "escrow_ledger_account_created_idx" ON "escrow_ledger" ("account_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "escrow_ledger_transaction_idx" ON "escrow_ledger" ("transaction_id")`,
    );

    // Enforce append-only at the database level: no ORM method, raw query,
    // or future bug can UPDATE or DELETE a posted ledger row. Corrections
    // must be new offsetting entries.
    await queryRunner.query(`
      CREATE FUNCTION prevent_escrow_ledger_mutation() RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'escrow_ledger is append-only: % is not permitted', TG_OP;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "escrow_ledger_no_update"
      BEFORE UPDATE OR DELETE ON "escrow_ledger"
      FOR EACH ROW EXECUTE FUNCTION prevent_escrow_ledger_mutation()
    `);

    // --- audit_logs (generic append-only status-history trail) --------------
    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "entity_type" TEXT NOT NULL,
        "entity_id" UUID NOT NULL,
        "from_status" TEXT,
        "to_status" TEXT,
        "actor_id" UUID REFERENCES "users" ("id") ON DELETE RESTRICT,
        "metadata" JSONB,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" ("entity_type", "entity_id", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "audit_logs"`);

    await queryRunner.query(`DROP TRIGGER "escrow_ledger_no_update" ON "escrow_ledger"`);
    await queryRunner.query(`DROP FUNCTION prevent_escrow_ledger_mutation()`);
    await queryRunner.query(`DROP TABLE "escrow_ledger"`);

    await queryRunner.query(`DROP TABLE "transactions"`);
    await queryRunner.query(`DROP TABLE "financing_offers"`);
    await queryRunner.query(`DROP TABLE "invoices"`);
    await queryRunner.query(`DROP TABLE "accounts"`);
    await queryRunner.query(`DROP TABLE "users"`);

    await queryRunner.query(`DROP TYPE "ledger_entry_type"`);
    await queryRunner.query(`DROP TYPE "transaction_status"`);
    await queryRunner.query(`DROP TYPE "transaction_type"`);
    await queryRunner.query(`DROP TYPE "account_type"`);
    await queryRunner.query(`DROP TYPE "account_owner_type"`);
    await queryRunner.query(`DROP TYPE "offer_status"`);
    await queryRunner.query(`DROP TYPE "invoice_status"`);
    await queryRunner.query(`DROP TYPE "user_status"`);
    await queryRunner.query(`DROP TYPE "user_role"`);

    await queryRunner.query(`DROP EXTENSION IF EXISTS "citext"`);
    await queryRunner.query(`DROP EXTENSION IF EXISTS "pgcrypto"`);
  }
}
