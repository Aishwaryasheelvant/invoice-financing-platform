import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { closeDataSource, resetDatabase } from './utils/database.util';
import { createTestApp } from './utils/app.util';

describe('Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await closeDataSource();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  it('rejects registration with a weak password', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'weak@example.com', password: 'weak', role: 'sme', companyName: 'Acme' });
    expect(res.status).toBe(400);
  });

  it('rejects registering as admin', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'wannabe-admin@example.com', password: 'GoodPass123', role: 'admin', companyName: 'Acme' });
    expect(res.status).toBe(400);
  });

  it('rejects a request body with an unexpected extra field', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'x@example.com', password: 'GoodPass123', role: 'sme', companyName: 'Acme', isAdmin: true });
    expect(res.status).toBe(400);
  });

  it('registers, then logs in and returns a working access token', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'sme@example.com', password: 'GoodPass123', role: 'sme', companyName: 'Acme' })
      .expect(201);

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'sme@example.com', password: 'GoodPass123' })
      .expect(200);

    expect(login.body.tokens.accessToken).toEqual(expect.any(String));
    expect(login.body.user.status).toBe('active');

    await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
      .expect(200)
      .expect((res) => expect(res.body.email).toBe('sme@example.com'));
  });

  it('rejects a protected route with no token, and with garbage', async () => {
    await request(app.getHttpServer()).get('/users/me').expect(401);
    await request(app.getHttpServer()).get('/users/me').set('Authorization', 'Bearer garbage').expect(401);
  });

  it('returns the same generic error for wrong password and unknown email', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'sme2@example.com', password: 'GoodPass123', role: 'sme', companyName: 'Acme' })
      .expect(201);

    const wrongPassword = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'sme2@example.com', password: 'WrongPass123' });
    const unknownEmail = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'nobody@example.com', password: 'WrongPass123' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
  });

  it('rotates the refresh token and detects reuse of the old one, killing the whole session', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'rotate@example.com', password: 'GoodPass123', role: 'sme', companyName: 'Acme' })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'rotate@example.com', password: 'GoodPass123' })
      .expect(200);
    const originalRefreshToken = login.body.tokens.refreshToken;

    const rotated = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: originalRefreshToken })
      .expect(200);
    const newRefreshToken = rotated.body.refreshToken;
    expect(newRefreshToken).not.toBe(originalRefreshToken);

    // Replaying the already-rotated original token is treated as theft.
    const reuse = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: originalRefreshToken });
    expect(reuse.status).toBe(401);
    expect(reuse.body.message).toMatch(/reuse detected/);

    // The legitimate child token is now also dead — the whole chain was revoked.
    const afterReuse = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: newRefreshToken });
    expect(afterReuse.status).toBe(401);
  });

  it('logout revokes the refresh token and is idempotent against garbage input', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'logout@example.com', password: 'GoodPass123', role: 'sme', companyName: 'Acme' })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'logout@example.com', password: 'GoodPass123' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/auth/logout')
      .send({ refreshToken: login.body.tokens.refreshToken })
      .expect(204);

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: login.body.tokens.refreshToken })
      .expect(401);

    await request(app.getHttpServer()).post('/auth/logout').send({ refreshToken: 'not-a-real-token' }).expect(204);
  });
});
