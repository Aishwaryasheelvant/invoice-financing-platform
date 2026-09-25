import { ConflictException } from '@nestjs/common';
import { InvoiceStatus } from './enums/invoice-status.enum';

/**
 * Every allowed status transition, explicitly enumerated. Anything not
 * listed here — including all the "obviously wrong" ones like jumping
 * straight from PENDING_BUYER_CONFIRMATION to SETTLED, or moving out of
 * a terminal state — is rejected. OPEN_FOR_BIDDING is defined on the
 * Invoice entity/migration but unused by this flow: CONFIRMED already
 * doubles as "biddable"; it's reserved for a future explicit
 * pause/resume-bidding feature.
 */
const ALLOWED_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  [InvoiceStatus.DRAFT]: [InvoiceStatus.PENDING_BUYER_CONFIRMATION, InvoiceStatus.CANCELLED],
  [InvoiceStatus.PENDING_BUYER_CONFIRMATION]: [InvoiceStatus.CONFIRMED, InvoiceStatus.CANCELLED],
  [InvoiceStatus.CONFIRMED]: [InvoiceStatus.FINANCED, InvoiceStatus.CANCELLED],
  [InvoiceStatus.OPEN_FOR_BIDDING]: [],
  [InvoiceStatus.FINANCED]: [InvoiceStatus.SETTLED, InvoiceStatus.OVERDUE, InvoiceStatus.DEFAULTED],
  [InvoiceStatus.OVERDUE]: [InvoiceStatus.SETTLED, InvoiceStatus.DEFAULTED],
  [InvoiceStatus.SETTLED]: [],
  [InvoiceStatus.DEFAULTED]: [],
  [InvoiceStatus.CANCELLED]: [],
};

export class InvoiceStateMachine {
  static assertCanTransition(from: InvoiceStatus, to: InvoiceStatus): void {
    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
      throw new ConflictException(`Cannot move invoice from "${from}" to "${to}"`);
    }
  }
}
