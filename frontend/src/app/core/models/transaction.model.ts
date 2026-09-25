/** Mirrors backend TransactionResponseDto. */
export interface Transaction {
  id: string;
  type:
    | 'financier_payout_to_sme'
    | 'buyer_payment_to_escrow'
    | 'escrow_release_to_financier'
    | 'escrow_release_to_sme'
    | 'platform_fee';
  amount: string;
  currency: string;
  status: string;
  createdAt: string;
}
