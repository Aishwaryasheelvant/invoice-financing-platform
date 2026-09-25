export type UserRole = 'sme' | 'buyer' | 'financier' | 'admin';

/** Mirrors backend UserResponseDto — never carries a password. */
export interface User {
  id: string;
  email: string;
  role: UserRole;
  companyName: string;
  status: string;
  createdAt: string;
}
