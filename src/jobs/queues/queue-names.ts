export const QUEUE_NAMES = {
  PAYOUTS: 'payouts',
  SETTLEMENTS: 'settlements',
  SETTLEMENT_SCAN: 'settlement-scan',
} as const;

export const JOB_NAMES = {
  PROCESS_PAYOUT: 'process-payout',
  SETTLE_INVOICE: 'settle-invoice',
  SCAN_DUE_INVOICES: 'scan-due-invoices',
} as const;

export interface ProcessPayoutJobData {
  offerId: string;
}

export interface SettleInvoiceJobData {
  invoiceId: string;
}
