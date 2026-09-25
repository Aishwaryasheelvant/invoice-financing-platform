import { ApiProperty } from '@nestjs/swagger';
import { Transaction } from '../entities/transaction.entity';
import { TransactionStatus } from '../enums/transaction-status.enum';
import { TransactionType } from '../enums/transaction-type.enum';

/**
 * Deliberately excludes internal ledger detail (account ids, idempotency
 * keys) — this is a read-only view for the invoice's own parties, not an
 * export of the accounting internals.
 */
export class TransactionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: TransactionType })
  type: TransactionType;

  @ApiProperty()
  amount: string;

  @ApiProperty()
  currency: string;

  @ApiProperty({ enum: TransactionStatus })
  status: TransactionStatus;

  @ApiProperty()
  createdAt: Date;

  static fromEntity(transaction: Transaction): TransactionResponseDto {
    const dto = new TransactionResponseDto();
    dto.id = transaction.id;
    dto.type = transaction.type;
    dto.amount = transaction.amount;
    dto.currency = transaction.currency;
    dto.status = transaction.status;
    dto.createdAt = transaction.createdAt;
    return dto;
  }
}
