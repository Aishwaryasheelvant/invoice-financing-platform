export const QUEUE_NAMES = {
  PAYOUTS: 'payouts',
  /**
   * Chasing invoices that haven't been paid on time. Named for arrears
   * rather than settlement because settlement is no longer scheduled work
   * — it's triggered by the buyer actually paying. What the scheduler
   * handles now is the *absence* of payment.
   */
  ARREARS: 'arrears',
  ARREARS_SCAN: 'arrears-scan',
} as const;

export const JOB_NAMES = {
  PROCESS_PAYOUT: 'process-payout',
  PROCESS_ARREARS: 'process-arrears',
  SCAN_ARREARS: 'scan-arrears',
} as const;

export interface ProcessPayoutJobData {
  offerId: string;
}

export interface ProcessArrearsJobData {
  invoiceId: string;
}
