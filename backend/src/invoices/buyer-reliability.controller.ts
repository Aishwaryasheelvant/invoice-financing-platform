import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { BuyerReliabilityResponseDto } from './dto/buyer-reliability-response.dto';
import { InvoicesService } from './invoices.service';

/**
 * Lives in the invoices module because it's an aggregate over invoice
 * payment history, even though it's addressed as a property of a buyer.
 */
@ApiTags('buyers')
@ApiBearerAuth()
@Controller('buyers/:buyerId/reliability')
export class BuyerReliabilityController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @ApiOperation({
    summary: "A buyer's payment track record",
    description:
      'On-time rate, average and worst delay, current arrears and prior defaults, plus a derived ' +
      'rating. Financiers use it to price risk; SMEs use it to decide whether to keep extending ' +
      'credit terms to that buyer. Not exposed to other buyers.',
  })
  @ApiParam({ name: 'buyerId', description: 'User id of the buyer' })
  @ApiOkResponse({ type: BuyerReliabilityResponseDto })
  @Roles(UserRole.SME, UserRole.FINANCIER, UserRole.ADMIN)
  @Get()
  get(@Param('buyerId', ParseUUIDPipe) buyerId: string): Promise<BuyerReliabilityResponseDto> {
    return this.invoicesService.getBuyerReliability(buyerId);
  }
}
