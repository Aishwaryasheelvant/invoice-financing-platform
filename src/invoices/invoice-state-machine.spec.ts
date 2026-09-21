import { ConflictException } from '@nestjs/common';
import { InvoiceStatus } from './enums/invoice-status.enum';
import { InvoiceStateMachine } from './invoice-state-machine';

describe('InvoiceStateMachine', () => {
  const ALL_STATUSES = Object.values(InvoiceStatus);

  const VALID_TRANSITIONS: Array<[InvoiceStatus, InvoiceStatus]> = [
    [InvoiceStatus.DRAFT, InvoiceStatus.PENDING_BUYER_CONFIRMATION],
    [InvoiceStatus.DRAFT, InvoiceStatus.CANCELLED],
    [InvoiceStatus.PENDING_BUYER_CONFIRMATION, InvoiceStatus.CONFIRMED],
    [InvoiceStatus.PENDING_BUYER_CONFIRMATION, InvoiceStatus.CANCELLED],
    [InvoiceStatus.CONFIRMED, InvoiceStatus.FINANCED],
    [InvoiceStatus.CONFIRMED, InvoiceStatus.CANCELLED],
    [InvoiceStatus.FINANCED, InvoiceStatus.SETTLED],
    [InvoiceStatus.FINANCED, InvoiceStatus.OVERDUE],
    [InvoiceStatus.FINANCED, InvoiceStatus.DEFAULTED],
    [InvoiceStatus.OVERDUE, InvoiceStatus.SETTLED],
    [InvoiceStatus.OVERDUE, InvoiceStatus.DEFAULTED],
  ];

  it.each(VALID_TRANSITIONS)('allows %s -> %s', (from, to) => {
    expect(() => InvoiceStateMachine.assertCanTransition(from, to)).not.toThrow();
  });

  const validSet = new Set(VALID_TRANSITIONS.map(([from, to]) => `${from}->${to}`));
  const allPairs: Array<[InvoiceStatus, InvoiceStatus]> = ALL_STATUSES.flatMap((from) =>
    ALL_STATUSES.map((to): [InvoiceStatus, InvoiceStatus] => [from, to]),
  );
  const invalidPairs = allPairs.filter(([from, to]) => !validSet.has(`${from}->${to}`));

  it('rejects every transition not explicitly allowed, including no-ops and skipping states', () => {
    for (const [from, to] of invalidPairs) {
      expect(() => InvoiceStateMachine.assertCanTransition(from, to)).toThrow(ConflictException);
    }
  });

  it('never allows leaving a terminal state', () => {
    for (const terminal of [InvoiceStatus.SETTLED, InvoiceStatus.DEFAULTED, InvoiceStatus.CANCELLED]) {
      for (const to of ALL_STATUSES) {
        expect(() => InvoiceStateMachine.assertCanTransition(terminal, to)).toThrow(ConflictException);
      }
    }
  });

  it('rejects skipping straight from pending confirmation to financed', () => {
    expect(() =>
      InvoiceStateMachine.assertCanTransition(InvoiceStatus.PENDING_BUYER_CONFIRMATION, InvoiceStatus.FINANCED),
    ).toThrow('Cannot move invoice from "pending_buyer_confirmation" to "financed"');
  });
});
