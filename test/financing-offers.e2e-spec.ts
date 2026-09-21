import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Queue } from 'bullmq';
import request from 'supertest';
import { JOB_NAMES, QUEUE_NAMES, SettleInvoiceJobData } from '../src/jobs/queues/queue-names';
import { createTestApp, waitUntil } from './utils/app.util';
import { registerAndLogin, TestSession } from './utils/auth.util';
import { closeDataSource, queryRaw, resetDatabase } from './utils/database.util';

describe('Financing offers (e2e)', () => {
  let app: INestApplication;
  let sme: TestSession;
  let buyer: TestSession;
  let financierA: TestSession;
  let financierB: TestSession;
  let invoiceId: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await closeDataSource();
  });

  beforeEach(async () => {
    await resetDatabase();
    sme = await registerAndLogin(app, { email: 'sme@example.com', role: 'sme' });
    buyer = await registerAndLogin(app, { email: 'buyer@example.com', role: 'buyer' });
    financierA = await registerAndLogin(app, { email: 'fin-a@example.com', role: 'financier' });
    financierB = await registerAndLogin(app, { email: 'fin-b@example.com', role: 'financier' });

    const created = await request(app.getHttpServer())
      .post('/invoices')
      .set('Authorization', `Bearer ${sme.accessToken}`)
      .send({
        buyerId: buyer.userId,
        invoiceNumber: 'INV-2001',
        faceValue: '10000.00',
        currency: 'USD',
        issueDate: '2026-01-01',
        dueDate: '2026-02-01',
      })
      .expect(201);
    invoiceId = created.body.id;

    await request(app.getHttpServer())
      .post(`/invoices/${invoiceId}/confirm`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);
  });

  function submitOffer(session: TestSession, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post(`/invoices/${invoiceId}/offers`)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send(body);
  }

  it('rejects an offer whose advance + fee would exceed face value', async () => {
    await submitOffer(financierA, { advanceRate: 1, feeAmount: '1.00', expiresAt: '2099-01-01T00:00:00.000Z' }).expect(400);
  });

  it('rejects the SME viewing offers on an invoice that is not theirs', async () => {
    const otherSme = await registerAndLogin(app, { email: 'other-sme@example.com', role: 'sme' });
    await request(app.getHttpServer())
      .get(`/invoices/${invoiceId}/offers`)
      .set('Authorization', `Bearer ${otherSme.accessToken}`)
      .expect(403);
  });

  it(
    'lets exactly one of two concurrent accept requests for two different offers succeed',
    async () => {
      const offerA = await submitOffer(financierA, {
        advanceRate: 0.9,
        feeAmount: '200.00',
        expiresAt: '2099-01-01T00:00:00.000Z',
      }).expect(201);
      const offerB = await submitOffer(financierB, {
        advanceRate: 0.92,
        feeAmount: '150.00',
        expiresAt: '2099-01-01T00:00:00.000Z',
      }).expect(201);

      // Fired at the same instant against the real running app/DB — this is
      // what actually proves the row lock works, not a mock standing in for it.
      const [resA, resB] = await Promise.all([
        request(app.getHttpServer())
          .post(`/invoices/${invoiceId}/offers/${offerA.body.id}/accept`)
          .set('Authorization', `Bearer ${sme.accessToken}`),
        request(app.getHttpServer())
          .post(`/invoices/${invoiceId}/offers/${offerB.body.id}/accept`)
          .set('Authorization', `Bearer ${sme.accessToken}`),
      ]);

      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([200, 409]);

      const invoice = await request(app.getHttpServer())
        .get(`/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${sme.accessToken}`)
        .expect(200);
      expect(invoice.body.status).toBe('financed');

      const offers = await request(app.getHttpServer())
        .get(`/invoices/${invoiceId}/offers`)
        .set('Authorization', `Bearer ${sme.accessToken}`)
        .expect(200);
      const statusesByOffer = offers.body.map((o: { status: string }) => o.status).sort();
      expect(statusesByOffer).toEqual(['accepted', 'rejected']);

      // The BullMQ payout job for the winning offer only should have run.
      const winningOfferId = resA.status === 200 ? offerA.body.id : offerB.body.id;
      await waitUntil(async () => {
        const rows = await queryRaw(`SELECT amount FROM transactions WHERE idempotency_key = $1`, [
          `payout-${winningOfferId}`,
        ]);
        return rows.length === 1;
      });
    },
    15_000,
  );

  it('settles a financed invoice through the real settlement queue/worker, splitting funds correctly', async () => {
    const offer = await submitOffer(financierA, {
      advanceRate: 0.85,
      feeAmount: '100.00',
      expiresAt: '2099-01-01T00:00:00.000Z',
    }).expect(201);
    await request(app.getHttpServer())
      .post(`/invoices/${invoiceId}/offers/${offer.body.id}/accept`)
      .set('Authorization', `Bearer ${sme.accessToken}`)
      .expect(200);

    // Wait for the payout job (financier -> SME advance) to land first.
    await waitUntil(async () => {
      const rows = await queryRaw(`SELECT 1 FROM transactions WHERE idempotency_key = $1`, [`payout-${offer.body.id}`]);
      return rows.length === 1;
    });

    // Drive settlement directly through the real queue + worker, instead
    // of waiting for the daily cron tick — this still exercises the
    // actual SettlementProcessor and LedgerService.settleInvoice, just
    // without depending on wall-clock cron timing in a test.
    const settlementsQueue = app.get<Queue<SettleInvoiceJobData>>(getQueueToken(QUEUE_NAMES.SETTLEMENTS));
    await settlementsQueue.add(JOB_NAMES.SETTLE_INVOICE, { invoiceId }, { jobId: `settle-${invoiceId}` });

    await waitUntil(async () => {
      const rows = await queryRaw<{ status: string }>(`SELECT status FROM invoices WHERE id = $1`, [invoiceId]);
      return rows[0]?.status === 'settled';
    });

    const legs = await queryRaw<{ type: string; amount: string }>(
      `SELECT type, amount FROM transactions WHERE invoice_id = $1 ORDER BY created_at`,
      [invoiceId],
    );
    const byType = Object.fromEntries(legs.map((l) => [l.type, l.amount]));
    expect(byType.financier_payout_to_sme).toBe('8500.00'); // 10000 * 0.85
    expect(byType.buyer_payment_to_escrow).toBe('10000.00');
    expect(byType.escrow_release_to_financier).toBe('8600.00'); // 8500 advance + 100 fee
    expect(byType.escrow_release_to_sme).toBe('1400.00'); // 10000 - 8600 residual

    const escrowBalance = await queryRaw<{ balance: string }>(
      `SELECT SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE -amount END) AS balance
       FROM escrow_ledger e JOIN accounts a ON a.id = e.account_id
       WHERE a.account_type = 'escrow' AND e.invoice_id = $1`,
      [invoiceId],
    );
    expect(Number(escrowBalance[0].balance)).toBe(0); // escrow must drain to exactly zero
  });
});
