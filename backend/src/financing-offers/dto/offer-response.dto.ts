import { ApiProperty } from '@nestjs/swagger';
import { FinancingOffer } from '../entities/financing-offer.entity';
import { OfferStatus } from '../enums/offer-status.enum';

export class OfferResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  invoiceId: string;

  @ApiProperty()
  financierId: string;

  @ApiProperty()
  advanceRate: string;

  @ApiProperty()
  advanceAmount: string;

  @ApiProperty()
  feeAmount: string;

  @ApiProperty({ enum: OfferStatus })
  status: OfferStatus;

  @ApiProperty()
  expiresAt: Date;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ nullable: true })
  decidedAt: Date | null;

  static fromEntity(offer: FinancingOffer): OfferResponseDto {
    const dto = new OfferResponseDto();
    dto.id = offer.id;
    dto.invoiceId = offer.invoiceId;
    dto.financierId = offer.financierId;
    dto.advanceRate = offer.advanceRate;
    dto.advanceAmount = offer.advanceAmount;
    dto.feeAmount = offer.feeAmount;
    dto.status = offer.status;
    dto.expiresAt = offer.expiresAt;
    dto.createdAt = offer.createdAt;
    dto.decidedAt = offer.decidedAt;
    return dto;
  }
}
