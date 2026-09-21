import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { UserRole } from '../users/enums/user-role.enum';
import { UserStatus } from '../users/enums/user-status.enum';
import { UsersRepository } from '../users/repositories/users.repository';
import { AuthTokensResponseDto } from './dto/auth-tokens-response.dto';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { RegisterDto } from './dto/register.dto';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';
// A fixed, valid bcrypt hash with no matching plaintext, compared against
// when the email isn't found so a login attempt costs the same either way
// — otherwise the "no bcrypt call" path for unknown emails is measurably
// faster and leaks which emails are registered.
const DUMMY_PASSWORD_HASH = '$2b$12$d3cNznu89McGl/Le7Pa.F.ge8zOLmiWVRcNggD5eRnIl/lvfUSnc.';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
  ) {}

  async register(dto: RegisterDto): Promise<UserResponseDto> {
    const existing = await this.usersRepository.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await this.passwordService.hash(dto.password);
    // No email-verification flow yet, so accounts are active immediately.
    // KYC/verification is future scope, not built in this pass.
    const user = await this.usersRepository.create({
      email: dto.email,
      passwordHash,
      role: dto.role as unknown as UserRole,
      companyName: dto.companyName,
      status: UserStatus.ACTIVE,
    });

    return UserResponseDto.fromEntity(user);
  }

  async login(dto: LoginDto): Promise<LoginResponseDto> {
    const user = await this.usersRepository.findByEmail(dto.email);
    const passwordMatches = await this.passwordService.compare(dto.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user || !passwordMatches) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Account is not active');
    }

    const tokens = await this.tokenService.issueTokenPair(user);
    return { user: UserResponseDto.fromEntity(user), tokens };
  }

  refresh(refreshToken: string): Promise<AuthTokensResponseDto> {
    return this.tokenService.rotateRefreshToken(refreshToken);
  }

  logout(refreshToken: string): Promise<void> {
    return this.tokenService.revokeRefreshToken(refreshToken);
  }
}
