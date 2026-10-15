import crypto from 'node:crypto';
import { Freelancer } from '../types';

// Secret for HMAC signing (uses env var in production or secure default)
const SESSION_SECRET = process.env.SESSION_SECRET || process.env.JWT_SECRET || 'ghprospeccao_hmac_secret_key_2026_prod_secure';

export interface TokenPayload {
  sub: string;
  role: 'admin' | 'freelancer';
  email?: string;
  name?: string;
  freelancerId?: string;
  accessCode?: string;
  iat: number;
  exp: number;
}

export interface AuthUser {
  id: string;
  role: 'admin' | 'freelancer';
  email?: string;
  name?: string;
  freelancerId?: string;
  freelancer?: Freelancer;
}

// In-memory revocation set for revoked tokens
const revokedTokens = new Set<string>();

/**
 * Sign a payload into a secure HMAC-SHA256 token (format: base64(payload).signature)
 */
export function signToken(payload: Omit<TokenPayload, 'iat' | 'exp'>, expiresInSeconds: number = 86400 * 7): string {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: TokenPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const payloadStr = JSON.stringify(fullPayload);
  const payloadB64 = Buffer.from(payloadStr).toString('base64url');

  const hmac = crypto.createHmac('sha256', SESSION_SECRET);
  hmac.update(payloadB64);
  const signature = hmac.digest('base64url');

  return `${payloadB64}.${signature}`;
}

/**
 * Verify and decode an HMAC-SHA256 token. Returns null if invalid, expired, or revoked.
 */
export function verifyToken(token: string): TokenPayload | null {
  if (!token || typeof token !== 'string') return null;
  if (revokedTokens.has(token)) return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, signature] = parts;

  // Verify HMAC signature using timing-safe comparison
  const hmac = crypto.createHmac('sha256', SESSION_SECRET);
  hmac.update(payloadB64);
  const expectedSignature = hmac.digest('base64url');

  try {
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSignature);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson) as TokenPayload;

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Revoke a token (for logout)
 */
export function revokeToken(token: string): void {
  if (token) {
    revokedTokens.add(token);
    // Keep set bounded
    if (revokedTokens.size > 10000) {
      const first = revokedTokens.values().next().value;
      if (first) revokedTokens.delete(first);
    }
  }
}
