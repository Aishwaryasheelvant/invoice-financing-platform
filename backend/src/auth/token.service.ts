import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { UserStatus } from '../users/enums/user-status.enum';
import { UsersRepository } from '../users/repositories/users.repository';
import { AuthTokensResponseDto } from './dto/auth-tokens-response.dto';
import { AccessTokenPayload, RefreshTokenPayload } from './interfaces/jwt-payload.interface';
import { RefreshTokensRepository } from './repositories/refresh-tokens.repository';

/**
 * Owns every JWT sign/verify operation plus refresh-token rotation.
 *
 * Rotation + reuse detection: each refresh consumes the presented token
 * and issues a new one (`replaced_by_id` chains them). If a token that
 * has *already* been rotated is presented again, that can only mean it
 * was stolen and used by two different parties — so instead of just
 * rejecting the request, every refresh token for that user is revoked,
 * forcing a fresh login everywhere.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly refreshTokensRepository: RefreshTokensRepository,
    private readonly usersRepository: UsersRepository,
    private readonly dataSource: DataSource,
  ) {}

  private get accessSecret(): string {
    return this.configService.getOrThrow<string>('JWT_ACCESS_SECRET');
  }

  private get accessExpiresInSeconds(): number {
    return Number(this.configService.get('JWT_ACCESS_EXPIRES_IN_SECONDS', 900));
  }

  private get refreshSecret(): string {
    return this.configService.getOrThrow<string>('JWT_REFRESH_SECRET');
  }

  private get refreshExpiresInSeconds(): number {
    return Number(this.configService.get('JWT_REFRESH_EXPIRES_IN_SECONDS', 60 * 60 * 24 * 7));
  }

  private static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private signAccessToken(user: User): string {
    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      type: 'access',
    };
    return this.jwtService.sign(payload, { secret: this.accessSecret, expiresIn: this.accessExpiresInSeconds });
  }

  /** Signs a new refresh JWT and persists its tracking row; returns both the JWT and its row id. */
  private async issueRefreshToken(userId: string, manager?: EntityManager): Promise<{ token: string; jti: string }> {
    const jti = randomUUID();
    const payload: RefreshTokenPayload = { sub: userId, jti, type: 'refresh' };
    const token = this.jwtService.sign(payload, {
      secret: this.refreshSecret,
      expiresIn: this.refreshExpiresInSeconds,
    });

    await this.refreshTokensRepository.insert(
      {
        id: jti,
        userId,
        tokenHash: TokenService.hash(token),
        expiresAt: new Date(Date.now() + this.refreshExpiresInSeconds * 1000),
      },
      manager,
    );

    return { token, jti };
  }

  async issueTokenPair(user: User): Promise<AuthTokensResponseDto> {
    const accessToken = this.signAccessToken(user);
    const { token: refreshToken } = await this.issueRefreshToken(user.id);
    return { accessToken, refreshToken, expiresIn: this.accessExpiresInSeconds };
  }

  /**
   * Verifies + rotates a refresh token, returning a brand-new token pair.
   *
   * Runs under a pessimistic row lock inside one transaction: two
   * concurrent refresh calls presenting the same still-valid token must
   * not both succeed (that would fork the session into two live token
   * chains). The second one blocks on the lock until the first commits,
   * then sees the row already revoked and hits the reuse-detection path.
   *
   * Reuse detection has to commit its revocation and *then* reject the
   * caller — throwing inside the transaction would roll the revocation
   * back along with everything else — so the transaction returns a
   * discriminated result instead of throwing for that one case.
   */
  async rotateRefreshToken(rawRefreshToken: string): Promise<AuthTokensResponseDto> {
    const payload = this.verifyRefreshTokenSignature(rawRefreshToken);

    const result = await this.dataSource.transaction(
      async (manager): Promise<{ reuseDetected: true } | { reuseDetected: false; tokens: AuthTokensResponseDto }> => {
        const existing = await this.refreshTokensRepository.findByIdForUpdate(payload.jti, manager);
        if (!existing || existing.userId !== payload.sub) {
          throw new UnauthorizedException('Invalid refresh token');
        }

        if (existing.revokedAt) {
          // Reuse of an already-rotated (or already-logged-out) token: assume compromise.
          await this.refreshTokensRepository.revokeAllForUser(existing.userId, manager);
          return { reuseDetected: true };
        }

        if (existing.expiresAt.getTime() < Date.now()) {
          throw new UnauthorizedException('Refresh token expired');
        }

        if (existing.tokenHash !== TokenService.hash(rawRefreshToken)) {
          throw new UnauthorizedException('Invalid refresh token');
        }

        const user = await this.usersRepository.findById(existing.userId, manager);
        if (!user || user.status !== UserStatus.ACTIVE) {
          throw new UnauthorizedException('Account is not active');
        }

        const newAccessToken = this.signAccessToken(user);
        const { token: newRefreshToken, jti: newJti } = await this.issueRefreshToken(user.id, manager);
        await this.refreshTokensRepository.revokeAndReplace(existing.id, newJti, manager);

        return {
          reuseDetected: false,
          tokens: { accessToken: newAccessToken, refreshToken: newRefreshToken, expiresIn: this.accessExpiresInSeconds },
        };
      },
    );

    if (result.reuseDetected) {
      throw new UnauthorizedException('Refresh token reuse detected; all sessions have been revoked');
    }
    return result.tokens;
  }

  /** Best-effort, idempotent: an invalid/expired token has nothing to revoke. */
  async revokeRefreshToken(rawRefreshToken: string): Promise<void> {
    let payload: RefreshTokenPayload;
    try {
      payload = this.verifyRefreshTokenSignature(rawRefreshToken);
    } catch {
      return;
    }

    const existing = await this.refreshTokensRepository.findById(payload.jti);
    if (existing && !existing.revokedAt) {
      await this.refreshTokensRepository.revoke(existing.id);
    }
  }

  private verifyRefreshTokenSignature(rawRefreshToken: string): RefreshTokenPayload {
    let payload: RefreshTokenPayload;
    try {
      payload = this.jwtService.verify<RefreshTokenPayload>(rawRefreshToken, { secret: this.refreshSecret });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid refresh token');
    }
    return payload;
  }
}
