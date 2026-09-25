import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { TransactionResponseDto } from './dto/transaction-response.dto';
import { LedgerService } from './ledger.service';

@ApiTags('ledger')
@ApiBearerAuth()
@Controller('invoices/:invoiceId/transactions')
export class LedgerController {
  constructor(private readonly ledgerService: LedgerService) {}

  @ApiOperation({ summary: 'List the money-movement history for an invoice (payout, settlement legs)' })
  @ApiParam({ name: 'invoiceId', description: 'Invoice id' })
  @ApiOkResponse({ type: [TransactionResponseDto] })
  // No @Roles(): visibility is per-invoice (seller, buyer, the winning
  // financier, or admin), enforced in the service — same pattern as
  // InvoicesService.isVisibleTo.
  @Get()
  list(
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TransactionResponseDto[]> {
    return this.ledgerService.getTransactionsForInvoice(invoiceId, user);
  }
}
