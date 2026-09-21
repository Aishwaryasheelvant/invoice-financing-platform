import { ApiProperty } from '@nestjs/swagger';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceStatus } from '../enums/invoice-status.enum';

export class InvoiceResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  sellerId: string;

  @ApiProperty()
  buyerId: string;

  @ApiProperty()
  invoiceNumber: string;

  @ApiProperty()
  faceValue: string;

  @ApiProperty()
  currency: string;

  @ApiProperty()
  issueDate: string;

  @ApiProperty()
  dueDate: string;

  @ApiProperty({ enum: InvoiceStatus })
  status: InvoiceStatus;

  @ApiProperty({ nullable: true })
  confirmedAt: Date | null;

  @ApiProperty()
  createdAt: Date;

  static fromEntity(invoice: Invoice): InvoiceResponseDto {
    const dto = new InvoiceResponseDto();
    dto.id = invoice.id;
    dto.sellerId = invoice.sellerId;
    dto.buyerId = invoice.buyerId;
    dto.invoiceNumber = invoice.invoiceNumber;
    dto.faceValue = invoice.faceValue;
    dto.currency = invoice.currency;
    dto.issueDate = invoice.issueDate;
    dto.dueDate = invoice.dueDate;
    dto.status = invoice.status;
    dto.confirmedAt = invoice.confirmedAt;
    dto.createdAt = invoice.createdAt;
    return dto;
  }
}
