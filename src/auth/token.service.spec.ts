import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'crypto';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { UserStatus } from '../users/enums/user-status.enum';
import { UsersRepository } from '../users/repositories/users.repository';
import { RefreshToken } from './entities/refresh-token.entity';
import { RefreshTokensRepository } from './repositories/refresh-tokens.repository';
import { TokenService } from './token.service';

const CONFIG: Record<string, string | number> = {
  JWT_ACCESS_SECRET: 'test-access-secret',
  JWT_ACCESS_EXPIRES_IN_SECONDS: 900,
  JWT_REFRESH_SECRET: 'test-refresh-secret',
  JWT_REFRESH_EXPIRES_IN_SECONDS: 3600,
};

function makeConfigService() {
  return {
    get: jest.fn((key: string, fallback?: unknown) => CONFIG[key] ?? fallback),
    getOrThrow: jest.fn((key: string) => {
      if (CONFIG[key] === undefined) throw new Error(`missing ${key}`);
      return CONFIG[key];
    }),
  };
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'user@example.com',
    passwordHash: 'hash',
    role: UserRole.SME,
    companyName: 'Acme',
    status: UserStatus.ACTIVE,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as User;
}

describe('TokenService', () => {
  // A real JwtService, not a mock — sign/verify are pure and fast, and
  // using the real thing means these tests exercise actual JWT behavior
  // (signatures, expiry, payload shape) instead of asserting against a
  // hand-rolled fake.
  const jwtService = new JwtService();
  let refreshTokensRepository: jest.Mocked<RefreshTokensRepository>;
  let usersRepository: jest.Mocked<UsersRepository>;
  let dataSource: { transaction: jest.Mock };
  let service: TokenService;

  beforeEach(() => {
    refreshTokensRepository = {
      findById: jest.fn(),
      findByIdForUpdate: jest.fn(),
      insert: jest.fn(),
      revokeAndReplace: jest.fn(),
      revoke: jest.fn(),
      revokeAllForUser: jest.fn(),
    } as unknown as jest.Mocked<RefreshTokensRepository>;

    usersRepository = { findById: jest.fn() } as unknown as jest.Mocked<UsersRepository>;
    dataSource = { transaction: jest.fn((cb) => cb({})) };

    service = new TokenService(jwtService, makeConfigService() as any, refreshTokensRepository, usersRepository, dataSource as any);
  });

  describe('issueTokenPair', () => {
    it('signs an access token carrying the user role and persists a refresh token row', async () => {
      const user = makeUser();
      const tokens = await service.issueTokenPair(user);

      const accessPayload = jwtService.decode(tokens.accessToken) as any;
      expect(accessPayload.sub).toBe(user.id);
      expect(accessPayload.role).toBe(UserRole.SME);
      expect(accessPayload.type).toBe('access');
      expect(tokens.expiresIn).toBe(900);

      expect(refreshTokensRepository.insert).toHaveBeenCalledWith(
        expect.objectContaining({ userId: user.id, tokenHash: expect.any(String) }),
        undefined,
      );
    });
  });

  describe('rotateRefreshToken', () => {
    function issueRawRefreshToken(userId: string, jti: string) {
      return jwtService.sign({ sub: userId, jti, type: 'refresh' }, { secret: CONFIG.JWT_REFRESH_SECRET as string, expiresIn: 3600 });
    }

    function makeRow(overrides: Partial<RefreshToken> = {}): RefreshToken {
      return {
        id: 'jti-1',
        userId: 'user-1',
        tokenHash: '',
        expiresAt: new Date(Date.now() + 3600_000),
        revokedAt: null,
        replacedById: null,
        createdAt: new Date(),
        ...overrides,
      } as RefreshToken;
    }

    it('rejects a token with an invalid signature', async () => {
      await expect(service.rotateRefreshToken('not-a-real-jwt')).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an access token presented as a refresh token', async () => {
      const accessToken = jwtService.sign(
        { sub: 'user-1', email: 'a@b.com', role: UserRole.SME, type: 'access' },
        { secret: CONFIG.JWT_ACCESS_SECRET as string, expiresIn: 900 },
      );
      await expect(service.rotateRefreshToken(accessToken)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects when no matching row exists', async () => {
      const raw = issueRawRefreshToken('user-1', 'jti-1');
      refreshTokensRepository.findByIdForUpdate.mockResolvedValue(null);
      await expect(service.rotateRefreshToken(raw)).rejects.toThrow(UnauthorizedException);
    });

    it('detects reuse of an already-rotated token and revokes every session for that user', async () => {
      const raw = issueRawRefreshToken('user-1', 'jti-1');
      const tokenHash = createHash('sha256').update(raw).digest('hex');
      refreshTokensRepository.findByIdForUpdate.mockResolvedValue(
        makeRow({ tokenHash, revokedAt: new Date() }), // already rotated once
      );

      await expect(service.rotateRefreshToken(raw)).rejects.toThrow('reuse detected');
      expect(refreshTokensRepository.revokeAllForUser).toHaveBeenCalledWith('user-1', expect.anything());
      // The compromised rotation itself must not have been allowed to proceed.
      expect(refreshTokensRepository.revokeAndReplace).not.toHaveBeenCalled();
    });

    it('rejects an expired row even though the JWT itself has not expired', async () => {
      const raw = issueRawRefreshToken('user-1', 'jti-1');
      const tokenHash = createHash('sha256').update(raw).digest('hex');
      refreshTokensRepository.findByIdForUpdate.mockResolvedValue(
        makeRow({ tokenHash, expiresAt: new Date(Date.now() - 1000) }),
      );
      await expect(service.rotateRefreshToken(raw)).rejects.toThrow('expired');
    });

    it('rejects when the presented token does not hash-match the stored row (tampering/JWT-secret confusion)', async () => {
      const raw = issueRawRefreshToken('user-1', 'jti-1');
      refreshTokensRepository.findByIdForUpdate.mockResolvedValue(makeRow({ tokenHash: 'a-different-hash' }));
      await expect(service.rotateRefreshToken(raw)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects when the user account is no longer active', async () => {
      const raw = issueRawRefreshToken('user-1', 'jti-1');
      const tokenHash = createHash('sha256').update(raw).digest('hex');
      refreshTokensRepository.findByIdForUpdate.mockResolvedValue(makeRow({ tokenHash }));
      usersRepository.findById.mockResolvedValue(makeUser({ status: UserStatus.SUSPENDED }));
      await expect(service.rotateRefreshToken(raw)).rejects.toThrow('not active');
    });

    it('rotates a valid token: revokes the old row and issues a new pair', async () => {
      const raw = issueRawRefreshToken('user-1', 'jti-1');
      const tokenHash = createHash('sha256').update(raw).digest('hex');
      refreshTokensRepository.findByIdForUpdate.mockResolvedValue(makeRow({ tokenHash }));
      usersRepository.findById.mockResolvedValue(makeUser());

      const tokens = await service.rotateRefreshToken(raw);

      expect(tokens.accessToken).toEqual(expect.any(String));
      expect(tokens.refreshToken).not.toBe(raw);
      expect(refreshTokensRepository.revokeAndReplace).toHaveBeenCalledWith('jti-1', expect.any(String), expect.anything());
    });
  });

  describe('revokeRefreshToken', () => {
    it('is a no-op for a garbage token instead of throwing', async () => {
      await expect(service.revokeRefreshToken('garbage')).resolves.toBeUndefined();
      expect(refreshTokensRepository.revoke).not.toHaveBeenCalled();
    });

    it('revokes the matching row for a valid token', async () => {
      const raw = jwtService.sign(
        { sub: 'user-1', jti: 'jti-1', type: 'refresh' },
        { secret: CONFIG.JWT_REFRESH_SECRET as string, expiresIn: 3600 },
      );
      refreshTokensRepository.findById.mockResolvedValue({ id: 'jti-1', revokedAt: null } as RefreshToken);

      await service.revokeRefreshToken(raw);

      expect(refreshTokensRepository.revoke).toHaveBeenCalledWith('jti-1');
    });
  });
});
