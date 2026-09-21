import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { UserRole } from '../users/enums/user-role.enum';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoiceResponseDto } from './dto/invoice-response.dto';
import { InvoicesService } from './invoices.service';

@ApiTags('invoices')
@ApiBearerAuth()
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @ApiOperation({ summary: 'SME creates an invoice, pending the named buyer\'s confirmation' })
  @ApiOkResponse({ type: InvoiceResponseDto })
  @Roles(UserRole.SME)
  @Post()
  create(@Body() dto: CreateInvoiceDto, @CurrentUser() user: AuthenticatedUser): Promise<InvoiceResponseDto> {
    return this.invoicesService.create(dto, user.id);
  }

  @ApiOperation({ summary: 'Buyer confirms an invoice, making it eligible for financier bidding' })
  @ApiParam({ name: 'id', description: 'Invoice id' })
  @ApiOkResponse({ type: InvoiceResponseDto })
  @Roles(UserRole.BUYER)
  @HttpCode(HttpStatus.OK)
  @Post(':id/confirm')
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<InvoiceResponseDto> {
    return this.invoicesService.confirm(id, user);
  }

  @ApiOperation({ summary: 'Get an invoice by id (visibility depends on the caller\'s role and relation to it)' })
  @ApiParam({ name: 'id', description: 'Invoice id' })
  @ApiOkResponse({ type: InvoiceResponseDto })
  // No @Roles(): sellers, buyers, financiers, and admins all reach this,
  // with per-invoice visibility enforced in the service.
  @Get(':id')
  getById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<InvoiceResponseDto> {
    return this.invoicesService.getById(id, user);
  }
}
