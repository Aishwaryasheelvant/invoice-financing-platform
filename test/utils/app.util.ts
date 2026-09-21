import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { LoggingInterceptor } from '../../src/common/interceptors/logging.interceptor';

/**
 * Boots the *real* AppModule — same DB, same Redis/BullMQ wiring, same
 * global pipes/filters as production main.ts — rather than a trimmed-down
 * test module. These are integration tests: the point is to exercise the
 * actual dependency graph, migrations, and locking behavior against a
 * real Postgres, not a stand-in for it.
 *
 * Rate limiting is disabled via THROTTLE_DISABLED=true in .env.test (see
 * app.module.ts's skipIf), not overridden here: ThrottlerGuard is
 * registered as a global APP_GUARD provider, which Nest's testing module
 * can't target with overrideGuard() (that only intercepts @UseGuards()
 * usage, not globally-applied guards).
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  await app.init();
  return app;
}

/** Polls `check` until it returns truthy or the timeout elapses — for asserting on async (BullMQ job) side effects. */
export async function waitUntil(check: () => Promise<boolean>, timeoutMs = 10_000, intervalMs = 200): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`waitUntil: condition not met within ${timeoutMs}ms`);
}
