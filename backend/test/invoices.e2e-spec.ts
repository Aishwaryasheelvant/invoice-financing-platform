import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { closeDataSource, resetDatabase } from './utils/database.util';
import { createTestApp } from './utils/app.util';
import { registerAndLogin, TestSession } from './utils/auth.util';

describe('Invoices (e2e)', () => {
  let app: INestApplication;
  let sme: TestSession;
  let buyer: TestSession;
  let otherBuyer: TestSession;
  let financier: TestSession;

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
    otherBuyer = await registerAndLogin(app, { email: 'buyer2@example.com', role: 'buyer' });
    financier = await registerAndLogin(app, { email: 'financier@example.com', role: 'financier' });
  });

  function createInvoicePayload(overrides: Record<string, unknown> = {}) {
    return {
      buyerId: buyer.userId,
      invoiceNumber: 'INV-1001',
      faceValue: '10000.00',
      currency: 'USD',
      issueDate: '2026-01-01',
      dueDate: '2026-02-01',
      ...overrides,
    };
  }

  it('rejects invoice creation by a non-SME role', async () => {
    await request(app.getHttpServer())
      .post('/invoices')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send(createInvoicePayload())
      .expect(403);
  });

  it('rejects a due date on or before the issue date', async () => {
    await request(app.getHttpServer())
      .post('/invoices')
      .set('Authorization', `Bearer ${sme.accessToken}`)
      .send(createInvoicePayload({ issueDate: '2026-02-01', dueDate: '2026-01-01' }))
      .expect(400);
  });

  it('walks an invoice through the full happy-path state machine', async () => {
    const created = await request(app.getHttpServer())
      .post('/invoices')
      .set('Authorization', `Bearer ${sme.accessToken}`)
      .send(createInvoicePayload())
      .expect(201);
    expect(created.body.status).toBe('pending_buyer_confirmation');
    const invoiceId = created.body.id;

    // Not open for bidding yet.
    await request(app.getHttpServer())
      .post(`/invoices/${invoiceId}/offers`)
      .set('Authorization', `Bearer ${financier.accessToken}`)
      .send({ advanceRate: 0.9, feeAmount: '100.00', expiresAt: '2099-01-01T00:00:00.000Z' })
      .expect(409);

    // Wrong buyer can't confirm someone else's invoice.
    await request(app.getHttpServer())
      .post(`/invoices/${invoiceId}/confirm`)
      .set('Authorization', `Bearer ${otherBuyer.accessToken}`)
      .expect(403);

    const confirmed = await request(app.getHttpServer())
      .post(`/invoices/${invoiceId}/confirm`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);
    expect(confirmed.body.status).toBe('confirmed');

    // Confirming twice is an invalid transition.
    await request(app.getHttpServer())
      .post(`/invoices/${invoiceId}/confirm`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(409);
  });

  describe('visibility', () => {
    it('hides an unconfirmed invoice from financiers but shows it to the seller and buyer', async () => {
      const created = await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${sme.accessToken}`)
        .send(createInvoicePayload())
        .expect(201);
      const invoiceId = created.body.id;

      await request(app.getHttpServer())
        .get(`/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${financier.accessToken}`)
        .expect(404);

      await request(app.getHttpServer())
        .get(`/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${sme.accessToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${buyer.accessToken}`)
        .expect(200);
    });

    it('shows a confirmed invoice to financiers once open for bidding', async () => {
      const created = await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${sme.accessToken}`)
        .send(createInvoicePayload())
        .expect(201);
      await request(app.getHttpServer())
        .post(`/invoices/${created.body.id}/confirm`)
        .set('Authorization', `Bearer ${buyer.accessToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/invoices/${created.body.id}`)
        .set('Authorization', `Bearer ${financier.accessToken}`)
        .expect(200);
    });

    it('hides an invoice from an unrelated user entirely', async () => {
      const created = await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${sme.accessToken}`)
        .send(createInvoicePayload())
        .expect(201);

      const stranger = await registerAndLogin(app, { email: 'stranger@example.com', role: 'sme' });
      await request(app.getHttpServer())
        .get(`/invoices/${created.body.id}`)
        .set('Authorization', `Bearer ${stranger.accessToken}`)
        .expect(404);
    });
  });
});
