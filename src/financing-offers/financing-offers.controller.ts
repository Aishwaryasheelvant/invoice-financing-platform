import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { UserRole } from '../users/enums/user-role.enum';
import { CreateOfferDto } from './dto/create-offer.dto';
import { OfferResponseDto } from './dto/offer-response.dto';
import { FinancingOffersService } from './financing-offers.service';

@ApiTags('financing-offers')
@ApiBearerAuth()
@ApiParam({ name: 'invoiceId', description: 'Invoice id' })
@Controller('invoices/:invoiceId/offers')
export class FinancingOffersController {
  constructor(private readonly financingOffersService: FinancingOffersService) {}

  @ApiOperation({ summary: 'Financier submits a bid on a confirmed invoice' })
  @ApiOkResponse({ type: OfferResponseDto })
  @Roles(UserRole.FINANCIER)
  @Post()
  submit(
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Body() dto: CreateOfferDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OfferResponseDto> {
    return this.financingOffersService.submitOffer(invoiceId, dto, user.id);
  }

  @ApiOperation({ summary: "SME lists all bids on their own invoice" })
  @ApiOkResponse({ type: [OfferResponseDto] })
  @Roles(UserRole.SME)
  @Get()
  list(
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OfferResponseDto[]> {
    return this.financingOffersService.listForInvoice(invoiceId, user);
  }

  @ApiOperation({
    summary: 'SME accepts one offer',
    description:
      'Locks the invoice row for the duration of the transaction, so concurrent accept attempts on the ' +
      'same invoice are serialized: exactly one can ever succeed, backed further by a partial unique index.',
  })
  @ApiParam({ name: 'offerId', description: 'Offer id' })
  @ApiOkResponse({ type: OfferResponseDto })
  @Roles(UserRole.SME)
  @HttpCode(HttpStatus.OK)
  @Post(':offerId/accept')
  accept(
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OfferResponseDto> {
    return this.financingOffersService.acceptOffer(invoiceId, offerId, user);
  }
}
