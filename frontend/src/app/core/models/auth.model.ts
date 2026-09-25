import { User } from './user.model';

/** Mirrors backend AuthTokensResponseDto. */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/** Mirrors backend LoginResponseDto. */
export interface LoginResponse {
  user: User;
  tokens: AuthTokens;
}
