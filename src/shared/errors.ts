export type ErrorCode =
  | 'INVALID_TOKEN'
  | 'INVALID_REQUEST'
  | 'FEED_MISMATCH'
  | 'SOURCE_IDENTITY_MISMATCH'
  | 'INVALID_TIMEZONE'
  | 'INVALID_DATE_RANGE'
  | 'INVALID_LESSON'
  | 'INVALID_TIME_RANGE'
  | 'DUPLICATE_LESSON_CONFLICT'
  | 'SUSPICIOUS_EMPTY_SNAPSHOT'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'SYNC_ALREADY_RUNNING'
  | 'PAYLOAD_TOO_LARGE'
  | 'DATABASE_UNAVAILABLE'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'ACCOUNT_SUSPENDED'
  | 'SYNC_DISABLED'
  | 'FEED_DISABLED'
  | 'PAIRING_CODE_INVALID'
  | 'PAIRING_CODE_EXPIRED'
  | 'DEVICE_LIMIT_REACHED'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, statusCode: number, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function statusCodeForError(code: ErrorCode): number {
  switch (code) {
    case 'INVALID_TOKEN':
      return 401;
    case 'INVALID_REQUEST':
    case 'INVALID_TIMEZONE':
    case 'INVALID_DATE_RANGE':
    case 'INVALID_LESSON':
    case 'INVALID_TIME_RANGE':
    case 'PAYLOAD_TOO_LARGE':
      return 400;
    case 'FEED_MISMATCH':
    case 'SOURCE_IDENTITY_MISMATCH':
    case 'DUPLICATE_LESSON_CONFLICT':
    case 'IDEMPOTENCY_KEY_REUSED':
    case 'SYNC_ALREADY_RUNNING':
      return 409;
    case 'SUSPICIOUS_EMPTY_SNAPSHOT':
      return 422;
    case 'UNAUTHORIZED':
      return 401;
    case 'FORBIDDEN':
    case 'ACCOUNT_SUSPENDED':
    case 'SYNC_DISABLED':
      return 403;
    case 'FEED_DISABLED':
      return 410;
    case 'PAIRING_CODE_INVALID':
    case 'PAIRING_CODE_EXPIRED':
    case 'DEVICE_LIMIT_REACHED':
      return 400;
    case 'RATE_LIMITED':
      return 429;
    case 'DATABASE_UNAVAILABLE':
      return 503;
    case 'INTERNAL_ERROR':
      return 500;
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}
