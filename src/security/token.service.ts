import type { AppConfig } from '../config.js';
import {
  detectTokenType,
  generateRawToken,
  hashInviteToken,
  hashToken,
} from '../shared/crypto.js';
import type { SecretHashPurpose, TokenType } from '../shared/types.js';
import { AppError } from '../shared/errors.js';

export class TokenService {
  constructor(private readonly tokenPepper: Buffer) {}

  generateDeviceToken(): string {
    return generateRawToken('device');
  }

  hash(purpose: SecretHashPurpose, rawToken: string): string {
    return hashToken(this.tokenPepper, purpose, rawToken);
  }

  hashInvite(rawToken: string): string {
    return hashInviteToken(this.tokenPepper, rawToken);
  }

  parseBearerToken(
    authorizationHeader: string | undefined,
    allowedTypes: TokenType[] = ['upload', 'device'],
  ): { rawToken: string; type: TokenType } {
    if (!authorizationHeader?.startsWith('Bearer ')) {
      throw new AppError('INVALID_TOKEN', 'Missing or invalid Authorization header.', 401);
    }
    const rawToken = authorizationHeader.slice('Bearer '.length).trim();
    const type = detectTokenType(rawToken);
    if (!type || !allowedTypes.includes(type)) {
      throw new AppError('INVALID_TOKEN', 'Invalid token format.', 401);
    }
    return { rawToken, type };
  }

  parseCalendarTokenFromPath(tokenParam: string): { rawToken: string; type: TokenType } {
    const rawToken = tokenParam.endsWith('.ics') ? tokenParam.slice(0, -4) : tokenParam;
    const type = detectTokenType(rawToken);
    if (!type || type !== 'calendar') {
      throw new AppError('INVALID_TOKEN', 'Calendar feed not found.', 404);
    }
    return { rawToken, type };
  }
}

export function createTokenService(config: AppConfig): TokenService {
  return new TokenService(config.tokenPepper);
}
