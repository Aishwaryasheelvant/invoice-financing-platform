import { INestApplicationContext, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AuthService } from '../auth/auth.service';
import { FinancingOffersService } from '../financing-offers/financing-offers.service';
import { InvoicesService } from '../invoices/invoices.service';
import { InvoicesRepository } from '../invoices/repositories/invoices.repository';
import { LedgerService } from '../ledger/ledger.service';
import { UsersRepository } from '../users/repositories/users.repository';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { UserRole } from '../users/enums/user-role.enum';
import { InvoiceStatus } from '../invoices/enums/invoice-status.enum';
import { RegistrableRole } from '../auth/enums/registrable-role.enum';

/**
 * Populates a local database with a worked example of the whole lifecycle,
 * so the app has something to show immediately instead of requiring ten
 * minutes of clicking through registration and role-switching first.
 *
 * Runs through the real services (NestJS standalone context — the DI
 * container without the HTTP server), not raw INSERTs: passwords get
 * hashed properly, the state machine is respected, the ledger is written
 * by the same code paths the API uses. Seeded data is therefore data the
 * application could genuinely have produced.
 *
 * Non-destructive: if the demo users already exist it stops rather than
 * touching anything. Pass --reset to wipe and rebuild.
 */

const DEMO_PASSWORD = 'DemoPass123';
const DEMO_USERS = {
  sme: { email: 'sme@demo.local', companyName: 'Northwind Supplies' },
  buyer: { email: 'buyer@demo.local', companyName: 'Gran Retail Group' },
  buyerLate: { email: 'buyer-late@demo.local', companyName: 'Slowpay Industries' },
  financier: { email: 'financier@demo.local', companyName: 'Harbour Capital' },
} as const;

const logger = new Logger('Seed');

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/** The shape services expect from the auth layer, assembled from a persisted user. */
function asAuthenticated(user: { id: string; email: string; role: UserRole }): AuthenticatedUser {
  return { id: user.id, email: user.email, role: user.role };
}

async function seed(app: INestApplicationContext, reset: boolean): Promise<void> {
  const authService = app.get(AuthService);
  const usersRepository = app.get(UsersRepository);
  const invoicesService = app.get(InvoicesService);
  const invoicesRepository = app.get(InvoicesRepository);
  const offersService = app.get(FinancingOffersService);
  const ledgerService = app.get(LedgerService);
  const dataSource = app.get(await import('typeorm').then((m) => m.DataSource));

  const existing = await usersRepository.findByEmail(DEMO_USERS.sme.email);
  if (existing && !reset) {
    logger.warn('Demo data already present — nothing to do.');
    logger.warn('Re-run with `npm run seed -- --reset` to wipe and rebuild it.');
    return;
  }

  if (reset) {
    logger.warn('--reset given: wiping ALL application data');
    await dataSource.query(
      `TRUNCATE TABLE "escrow_ledger", "transactions", "financing_offers", "invoices",
       "accounts", "audit_logs", "refresh_tokens", "users" RESTART IDENTITY CASCADE`,
    );
  }

  // --- Accounts -----------------------------------------------------------
  await authService.register({ ...DEMO_USERS.sme, password: DEMO_PASSWORD, role: RegistrableRole.SME });
  await authService.register({ ...DEMO_USERS.buyer, password: DEMO_PASSWORD, role: RegistrableRole.BUYER });
  await authService.register({ ...DEMO_USERS.buyerLate, password: DEMO_PASSWORD, role: RegistrableRole.BUYER });
  await authService.register({ ...DEMO_USERS.financier, password: DEMO_PASSWORD, role: RegistrableRole.FINANCIER });

  const sme = (await usersRepository.findByEmail(DEMO_USERS.sme.email))!;
  const buyer = (await usersRepository.findByEmail(DEMO_USERS.buyer.email))!;
  const buyerLate = (await usersRepository.findByEmail(DEMO_USERS.buyerLate.email))!;
  const financier = (await usersRepository.findByEmail(DEMO_USERS.financier.email))!;
  logger.log('Created 4 demo accounts');

  const smeAuth = asAuthenticated(sme);
  const buyerAuth = asAuthenticated(buyer);
  const buyerLateAuth = asAuthenticated(buyerLate);

  async function createInvoice(opts: {
    buyerId: string;
    number: string;
    faceValue: string;
    issueDate: string;
    dueDate: string;
  }) {
    return invoicesService.create(
      {
        buyerId: opts.buyerId,
        invoiceNumber: opts.number,
        faceValue: opts.faceValue,
        currency: 'USD',
        issueDate: opts.issueDate,
        dueDate: opts.dueDate,
      },
      sme.id,
    );
  }

  async function bid(invoiceId: string, advanceRate: number, feeAmount: string) {
    return offersService.submitOffer(
      invoiceId,
      { advanceRate, feeAmount, expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString() },
      financier.id,
    );
  }

  // --- A: awaiting the buyer's confirmation -------------------------------
  await createInvoice({
    buyerId: buyer.id,
    number: 'INV-2001',
    faceValue: '12500.00',
    issueDate: daysFromNow(-5),
    dueDate: daysFromNow(40),
  });
  logger.log('INV-2001: awaiting buyer confirmation');

  // --- B: confirmed, two competing bids waiting on a decision ------------
  const openForBids = await createInvoice({
    buyerId: buyer.id,
    number: 'INV-2002',
    faceValue: '8000.00',
    issueDate: daysFromNow(-10),
    dueDate: daysFromNow(35),
  });
  await invoicesService.confirm(openForBids.id, buyerAuth);
  await bid(openForBids.id, 0.9, '240.00');
  await bid(openForBids.id, 0.92, '300.00');
  logger.log('INV-2002: confirmed, 2 bids pending a decision');

  // --- C: financed, awaiting payment on the due date ----------------------
  const financed = await createInvoice({
    buyerId: buyer.id,
    number: 'INV-2003',
    faceValue: '20000.00',
    issueDate: daysFromNow(-20),
    dueDate: daysFromNow(15),
  });
  await invoicesService.confirm(financed.id, buyerAuth);
  const financedOffer = await bid(financed.id, 0.88, '500.00');
  await offersService.acceptOffer(financed.id, financedOffer.id, smeAuth);
  await ledgerService.recordFinancierPayout(financedOffer.id); // normally the payout queue
  logger.log('INV-2003: financed, advance paid, awaiting the buyer');

  // --- D: fully settled, paid on time ------------------------------------
  const settled = await createInvoice({
    buyerId: buyer.id,
    number: 'INV-2004',
    faceValue: '5000.00',
    issueDate: daysFromNow(-60),
    dueDate: daysFromNow(-10),
  });
  await invoicesService.confirm(settled.id, buyerAuth);
  const settledOffer = await bid(settled.id, 0.9, '150.00');
  await offersService.acceptOffer(settled.id, settledOffer.id, smeAuth);
  await ledgerService.recordFinancierPayout(settledOffer.id);
  await ledgerService.payInvoiceAsBuyer(settled.id, buyerAuth);
  // Backdate the payment so it reads as on-time relative to its due date,
  // giving the reliable buyer a track record rather than a same-day blip.
  await dataSource.query(`UPDATE invoices SET paid_at = due_date::timestamptz - interval '2 days' WHERE id = $1`, [
    settled.id,
  ]);
  logger.log('INV-2004: settled, paid on time');

  // --- E: settled but paid late, by the unreliable buyer ------------------
  const paidLate = await createInvoice({
    buyerId: buyerLate.id,
    number: 'INV-2005',
    faceValue: '7500.00',
    issueDate: daysFromNow(-90),
    dueDate: daysFromNow(-30),
  });
  await invoicesService.confirm(paidLate.id, buyerLateAuth);
  const lateOffer = await bid(paidLate.id, 0.85, '220.00');
  await offersService.acceptOffer(paidLate.id, lateOffer.id, smeAuth);
  await ledgerService.recordFinancierPayout(lateOffer.id);
  await ledgerService.payInvoiceAsBuyer(paidLate.id, buyerLateAuth);
  await dataSource.query(`UPDATE invoices SET paid_at = due_date::timestamptz + interval '18 days' WHERE id = $1`, [
    paidLate.id,
  ]);
  logger.log('INV-2005: settled 18 days late (Slowpay Industries)');

  // --- F: overdue, unpaid and past due -----------------------------------
  const overdue = await createInvoice({
    buyerId: buyerLate.id,
    number: 'INV-2006',
    faceValue: '9000.00',
    issueDate: daysFromNow(-50),
    dueDate: daysFromNow(-6),
  });
  await invoicesService.confirm(overdue.id, buyerLateAuth);
  const overdueOffer = await bid(overdue.id, 0.9, '270.00');
  await offersService.acceptOffer(overdue.id, overdueOffer.id, smeAuth);
  await ledgerService.recordFinancierPayout(overdueOffer.id);
  await ledgerService.processArrears(overdue.id, 30); // past due, inside grace -> OVERDUE
  logger.log('INV-2006: overdue, still inside the grace period');

  // --- G: defaulted, advance recovered from the SME under recourse --------
  const defaulted = await createInvoice({
    buyerId: buyerLate.id,
    number: 'INV-2007',
    faceValue: '6000.00',
    issueDate: daysFromNow(-200),
    dueDate: daysFromNow(-150),
  });
  await invoicesService.confirm(defaulted.id, buyerLateAuth);
  const defaultedOffer = await bid(defaulted.id, 0.9, '180.00');
  await offersService.acceptOffer(defaulted.id, defaultedOffer.id, smeAuth);
  await ledgerService.recordFinancierPayout(defaultedOffer.id);
  await ledgerService.processArrears(defaulted.id, 30); // -> OVERDUE
  await ledgerService.processArrears(defaulted.id, 30); // past grace -> DEFAULTED + recourse
  logger.log('INV-2007: defaulted, advance clawed back from the SME');

  // --- Summary ------------------------------------------------------------
  const all = await invoicesRepository.findBySellerId(sme.id);
  const byStatus = all.reduce<Record<string, number>>((acc, invoice) => {
    acc[invoice.status] = (acc[invoice.status] ?? 0) + 1;
    return acc;
  }, {});

  logger.log('');
  logger.log('Seed complete.');
  logger.log(`Invoices by status: ${JSON.stringify(byStatus)}`);
  logger.log('');
  logger.log(`Log in with password "${DEMO_PASSWORD}" as any of:`);
  for (const [role, user] of Object.entries(DEMO_USERS)) {
    logger.log(`  ${user.email.padEnd(24)} ${role} — ${user.companyName}`);
  }

  if (byStatus[InvoiceStatus.DEFAULTED] !== 1 || byStatus[InvoiceStatus.OVERDUE] !== 1) {
    throw new Error('Seed finished in an unexpected state — check the log above');
  }
}

async function bootstrap(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    // These credentials are committed to the repo. Running this against a
    // real database would create known-password accounts in production.
    logger.error('Refusing to seed: NODE_ENV=production');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    await seed(app, process.argv.includes('--reset'));
  } finally {
    await app.close();
  }
}

bootstrap().catch((error) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
