export type InvoiceStatus =
  | 'draft'
  | 'pending_buyer_confirmation'
  | 'confirmed'
  | 'open_for_bidding'
  | 'financed'
  | 'settled'
  | 'overdue'
  | 'defaulted'
  | 'cancelled';

/** Mirrors backend InvoiceResponseDto. Money fields stay strings end to end — never parsed to number. */
export interface Invoice {
  id: string;
  sellerId: string;
  buyerId: string;
  invoiceNumber: string;
  faceValue: string;
  currency: string;
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
  confirmedAt: string | null;
  createdAt: string;
  hasDocument: boolean;
  documentOriginalName: string | null;
}

export interface CreateInvoicePayload {
  buyerId: string;
  invoiceNumber: string;
  faceValue: string;
  currency: string;
  issueDate: string;
  dueDate: string;
}
