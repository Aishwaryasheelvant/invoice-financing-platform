import { Controller, Get, NotFoundException } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { UserResponseDto } from './dto/user-response.dto';
import { UsersRepository } from './repositories/users.repository';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersRepository: UsersRepository) {}

  // No @Public() and no @Roles(): the global JwtAuthGuard requires a valid
  // access token, and any authenticated role may read their own profile.
  @ApiOperation({ summary: "Get the current user's own profile" })
  @ApiOkResponse({ type: UserResponseDto })
  @Get('me')
  async getCurrentUser(@CurrentUser() currentUser: AuthenticatedUser): Promise<UserResponseDto> {
    const user = await this.usersRepository.findById(currentUser.id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return UserResponseDto.fromEntity(user);
  }
}
