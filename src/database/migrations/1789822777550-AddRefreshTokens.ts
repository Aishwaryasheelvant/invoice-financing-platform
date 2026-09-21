import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRefreshTokens1789822777550 implements MigrationInterface {
  name = 'AddRefreshTokens1789822777550';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "refresh_tokens" (
        "id" UUID PRIMARY KEY,
        "user_id" UUID NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
        "token_hash" TEXT NOT NULL,
        "expires_at" TIMESTAMPTZ NOT NULL,
        "revoked_at" TIMESTAMPTZ,
        "replaced_by_id" UUID REFERENCES "refresh_tokens" ("id") ON DELETE SET NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens" ("user_id")`);
    await queryRunner.query(
      `CREATE INDEX "refresh_tokens_user_id_revoked_at_idx" ON "refresh_tokens" ("user_id", "revoked_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);
  }
}
