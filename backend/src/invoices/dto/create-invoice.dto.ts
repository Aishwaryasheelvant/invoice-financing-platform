import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

// Up to 2 decimal places, matching NUMERIC(14,2) — accepted as a string so
// the API boundary never round-trips money through a JS float.
const MONEY_PATTERN = /^\d+(\.\d{1,2})?$/;

export class CreateInvoiceDto {
  @ApiProperty({ description: 'User id of the buyer who must confirm this invoice' })
  @IsUUID()
  buyerId: string;

  @ApiProperty({ example: 'INV-1001' })
  @MinLength(1)
  @MaxLength(100)
  invoiceNumber: string;

  @ApiProperty({ example: '10000.00', description: 'Up to 2 decimal places, sent as a string' })
  @Matches(MONEY_PATTERN, { message: 'faceValue must be a positive amount with up to 2 decimal places' })
  faceValue: string;

  @ApiProperty({ example: 'USD', minLength: 3, maxLength: 3 })
  @MinLength(3)
  @MaxLength(3)
  currency: string;

  @ApiProperty({ example: '2026-09-01' })
  @IsDateString()
  issueDate: string;

  @ApiProperty({ example: '2026-10-01' })
  @IsDateString()
  dueDate: string;
}
