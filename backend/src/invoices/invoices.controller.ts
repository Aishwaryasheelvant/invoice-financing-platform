import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { UserRole } from '../users/enums/user-role.enum';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoiceResponseDto } from './dto/invoice-response.dto';
import { invoiceDocumentMulterOptions } from './invoice-document.storage';
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

  @ApiOperation({
    summary: 'List invoices visible to the caller',
    description:
      'SME/buyer see their own invoices in any status; financiers see invoices open for bidding plus any they have bid on; admins see all.',
  })
  @ApiOkResponse({ type: [InvoiceResponseDto] })
  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<InvoiceResponseDto[]> {
    return this.invoicesService.list(user);
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

  @ApiOperation({
    summary: 'Attach a supporting document (PDF/PNG/JPEG, max 5MB) to an invoice',
    description: 'Reference material for the buyer/financier to cross-check — never parsed, never a data source.',
  })
  @ApiParam({ name: 'id', description: 'Invoice id' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOkResponse({ type: InvoiceResponseDto })
  @Roles(UserRole.SME)
  @UseInterceptors(FileInterceptor('file', invoiceDocumentMulterOptions))
  @Post(':id/document')
  attachDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<InvoiceResponseDto> {
    return this.invoicesService.attachDocument(id, user.id, file);
  }

  @ApiOperation({ summary: "Download an invoice's attached document" })
  @ApiParam({ name: 'id', description: 'Invoice id' })
  @Get(':id/document')
  async downloadDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    const document = await this.invoicesService.getDocumentForDownload(id, user);
    res.setHeader('Content-Type', document.mimeType);
    res.download(document.path, document.originalName);
  }
}
