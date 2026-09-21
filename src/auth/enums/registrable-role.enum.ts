/**
 * Deliberately excludes UserRole.ADMIN — the public registration endpoint
 * must never let a caller grant themselves admin privileges. Admin
 * accounts are provisioned out-of-band.
 */
export enum RegistrableRole {
  SME = 'sme',
  BUYER = 'buyer',
  FINANCIER = 'financier',
}
