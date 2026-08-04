import type { AppConfig } from '../../config.js';
import { detectTokenType, generateRawToken, hashToken } from '../../shared/crypto.js';
import type { TokenType } from '../../shared/types.js';
import { AppError } from '../../shared/errors.js';

export class TokenService {
  constructor(private readonly tokenPepper: Buffer) {}

  generateTokenPair(): { uploadToken: string; calendarToken: string } {
    return {
      uploadToken: generateRawToken('upload'),
      calendarToken: generateRawToken('calendar'),
    };
  }

  generateDeviceToken(): string {
    return generateRawToken('device');
  }

  hash(type: TokenType, rawToken: string): string {
    return hashToken(this.tokenPepper, type, rawToken);
  }

  parseBearerToken(
    authorizationHeader: string | undefined,
    allowedTypes: TokenType[] = ['upload'],
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

  parseUploadBearerToken(authorizationHeader: string | undefined): { rawToken: string; type: TokenType } {
    return this.parseBearerToken(authorizationHeader, ['upload']);
  }

  parseDeviceBearerToken(authorizationHeader: string | undefined): { rawToken: string; type: TokenType } {
    return this.parseBearerToken(authorizationHeader, ['device']);
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
