export enum TransactionType {
  FINANCIER_PAYOUT_TO_SME = 'financier_payout_to_sme',
  BUYER_PAYMENT_TO_ESCROW = 'buyer_payment_to_escrow',
  ESCROW_RELEASE_TO_FINANCIER = 'escrow_release_to_financier',
  ESCROW_RELEASE_TO_SME = 'escrow_release_to_sme',
  PLATFORM_FEE = 'platform_fee',
  /**
   * Recourse: the buyer defaulted, so the SME repays the financier's
   * advance. Only the advance is clawed back — the financier gets their
   * capital back but forfeits the fee, since the deal didn't complete.
   */
  SME_RECOURSE_TO_FINANCIER = 'sme_recourse_to_financier',
}
