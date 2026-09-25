export type OfferStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn' | 'expired';

/** Mirrors backend OfferResponseDto. */
export interface Offer {
  id: string;
  invoiceId: string;
  financierId: string;
  advanceRate: string;
  advanceAmount: string;
  feeAmount: string;
  status: OfferStatus;
  expiresAt: string;
  createdAt: string;
  decidedAt: string | null;
}

export interface CreateOfferPayload {
  advanceRate: number;
  feeAmount: string;
  expiresAt: string;
}
