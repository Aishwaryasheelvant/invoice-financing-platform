export type BuyerReliabilityRating =
  | 'no_history'
  | 'has_defaulted'
  | 'reliable'
  | 'slightly_late'
  | 'habitually_late';

/** Mirrors backend BuyerReliabilityResponseDto. */
export interface BuyerReliability {
  buyerId: string;
  companyName: string;
  rating: BuyerReliabilityRating;
  settledCount: number;
  onTimeCount: number;
  lateCount: number;
  avgDaysLate: number;
  maxDaysLate: number;
  currentlyOverdueCount: number;
  defaultedCount: number;
  onTimePercentage: number;
}

/** Human-readable labels, kept next to the type they describe. */
export const RELIABILITY_LABELS: Record<BuyerReliabilityRating, string> = {
  no_history: 'No payment history yet',
  reliable: 'Pays on time',
  slightly_late: 'Slightly late',
  habitually_late: 'Habitually late',
  has_defaulted: 'Has defaulted before',
};
