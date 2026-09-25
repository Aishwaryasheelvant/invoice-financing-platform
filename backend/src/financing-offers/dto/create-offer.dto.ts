import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNumber, Matches, Max, Min } from 'class-validator';

const MONEY_PATTERN = /^\d+(\.\d{1,2})?$/;

export class CreateOfferDto {
  @ApiProperty({
    example: 0.9,
    minimum: 0.0001,
    maximum: 1,
    description: 'Fraction of face value advanced to the SME up front, e.g. 0.9 = 90%',
  })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  @Max(1)
  advanceRate: number;

  @ApiProperty({ example: '200.00', description: "The financier's flat fee/profit, in the invoice's currency" })
  @Matches(MONEY_PATTERN, { message: 'feeAmount must be a non-negative amount with up to 2 decimal places' })
  feeAmount: string;

  @ApiProperty({ example: '2026-12-01T00:00:00.000Z' })
  @IsDateString()
  expiresAt: string;
}
