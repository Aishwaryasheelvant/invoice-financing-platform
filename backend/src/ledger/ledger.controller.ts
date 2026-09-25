import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { InvoiceResponseDto } from '../invoices/dto/invoice-response.dto';
import { UserRole } from '../users/enums/user-role.enum';
import { TransactionResponseDto } from './dto/transaction-response.dto';
import { LedgerService } from './ledger.service';

/**
 * Money-movement endpoints live here rather than on InvoicesController
 * because the ledger module is the only thing permitted to move money —
 * and because InvoicesModule can't depend on LedgerModule without creating
 * a cycle (Ledger already depends on Invoices).
 */
@ApiTags('ledger')
@ApiBearerAuth()
@Controller('invoices/:invoiceId')
export class LedgerController {
  constructor(private readonly ledgerService: LedgerService) {}

  @ApiOperation({
    summary: 'Buyer pays an invoice, settling it through escrow',
    description:
      'Records the payment into escrow and immediately splits it: the financier is repaid their ' +
      'advance plus fee, the SME receives the residual. Allowed while the invoice is financed or ' +
      'already overdue — a late payment still settles it, it just shows up in the buyer\'s payment record.',
  })
  @ApiParam({ name: 'invoiceId', description: 'Invoice id' })
  @ApiOkResponse({ type: InvoiceResponseDto })
  @Roles(UserRole.BUYER)
  @HttpCode(HttpStatus.OK)
  @Post('pay')
  pay(
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<InvoiceResponseDto> {
    return this.ledgerService.payInvoiceAsBuyer(invoiceId, user);
  }

  @ApiOperation({ summary: 'List the money-movement history for an invoice (payout, settlement, recourse)' })
  @ApiParam({ name: 'invoiceId', description: 'Invoice id' })
  @ApiOkResponse({ type: [TransactionResponseDto] })
  // No @Roles(): visibility is per-invoice (seller, buyer, the winning
  // financier, or admin), enforced in the service — same pattern as
  // InvoicesService.isVisibleTo.
  @Get('transactions')
  listTransactions(
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TransactionResponseDto[]> {
    return this.ledgerService.getTransactionsForInvoice(invoiceId, user);
  }
}
