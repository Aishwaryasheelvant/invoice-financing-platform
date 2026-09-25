export enum InvoiceStatus {
  DRAFT = 'draft',
  PENDING_BUYER_CONFIRMATION = 'pending_buyer_confirmation',
  CONFIRMED = 'confirmed',
  OPEN_FOR_BIDDING = 'open_for_bidding',
  FINANCED = 'financed',
  SETTLED = 'settled',
  OVERDUE = 'overdue',
  DEFAULTED = 'defaulted',
  CANCELLED = 'cancelled',
}
