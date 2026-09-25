import { ApiProperty } from '@nestjs/swagger';

/**
 * How reliably a buyer has actually paid. This is the signal a financier
 * prices risk against, and the one an SME uses to decide whether to keep
 * extending credit terms to that buyer.
 */
export enum BuyerReliabilityRating {
  /** Nothing has come due yet — absence of evidence, not evidence of reliability. */
  NO_HISTORY = 'no_history',
  HAS_DEFAULTED = 'has_defaulted',
  RELIABLE = 'reliable',
  SLIGHTLY_LATE = 'slightly_late',
  HABITUALLY_LATE = 'habitually_late',
}

export class BuyerReliabilityResponseDto {
  @ApiProperty()
  buyerId: string;

  @ApiProperty()
  companyName: string;

  @ApiProperty({ enum: BuyerReliabilityRating })
  rating: BuyerReliabilityRating;

  @ApiProperty({ description: 'Invoices this buyer has actually paid' })
  settledCount: number;

  @ApiProperty()
  onTimeCount: number;

  @ApiProperty()
  lateCount: number;

  @ApiProperty({ description: 'Mean days past due across settled invoices; paying early counts as 0' })
  avgDaysLate: number;

  @ApiProperty({ description: 'Worst single delay on record, in days' })
  maxDaysLate: number;

  @ApiProperty({ description: 'Invoices of theirs currently past due and unpaid' })
  currentlyOverdueCount: number;

  @ApiProperty({ description: 'Invoices written off to recourse against the SME' })
  defaultedCount: number;

  @ApiProperty({ description: 'Percentage of settled invoices paid on or before the due date' })
  onTimePercentage: number;
}
