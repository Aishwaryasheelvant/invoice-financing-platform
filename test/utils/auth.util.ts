import { INestApplication } from '@nestjs/common';
import request from 'supertest';

export interface TestSession {
  userId: string;
  accessToken: string;
  refreshToken: string;
}

export async function registerAndLogin(
  app: INestApplication,
  opts: { email: string; role: 'sme' | 'buyer' | 'financier'; password?: string; companyName?: string },
): Promise<TestSession> {
  const password = opts.password ?? 'GoodPass123';
  const companyName = opts.companyName ?? `${opts.role}-co`;

  await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email: opts.email, password, role: opts.role, companyName })
    .expect(201);

  const loginRes = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email: opts.email, password })
    .expect(200);

  return {
    userId: loginRes.body.user.id,
    accessToken: loginRes.body.tokens.accessToken,
    refreshToken: loginRes.body.tokens.refreshToken,
  };
}
