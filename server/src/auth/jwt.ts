import jwt from 'jsonwebtoken';
import type { Role } from '@de/shared';
import { config } from '../config.js';

export interface AccessTokenClaims {
  sub: number; // user id
  email: string;
  name: string;
  role: Role;
  merchantId?: number; // MERCHANT logins + impersonation tokens
  imp?: string; // impersonation: the internal actor who minted this token
}

export function signAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign(claims, config.JWT_SECRET, {
    expiresIn: config.JWT_ACCESS_TTL,
    issuer: 'deployment-engine',
    audience: 'deployment-engine:internal',
  });
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  const decoded = jwt.verify(token, config.JWT_SECRET, {
    issuer: 'deployment-engine',
    audience: 'deployment-engine:internal',
  });
  return decoded as unknown as AccessTokenClaims;
}
