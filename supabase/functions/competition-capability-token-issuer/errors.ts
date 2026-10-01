// supabase/functions/competition-capability-token-issuer/errors.ts
import { ErrorCode, StandardErrorEnvelope } from './types.ts';
import { getCorsHeaders } from './cors.ts';

const STATUS_CODE_MAP: Record<ErrorCode, number> = {
  invalid_request: 400,
  unauthorized: 401,
  forbidden: 403,
  session_unavailable: 409,
  rate_limited: 429,
  rate_limit_unavailable: 503,
  internal_error: 500,
};

export class CapabilityIssuerError extends Error {
  readonly errorCode: ErrorCode;
  readonly httpStatus: number;
  readonly retryAfter?: number;

  constructor(errorCode: ErrorCode, message: string, retryAfter?: number) {
    super(message);
    this.name = 'CapabilityIssuerError';
    this.errorCode = errorCode;
    this.httpStatus = STATUS_CODE_MAP[errorCode] || 500;
    this.retryAfter = retryAfter;
  }
}

export function createErrorResponse(
  errorCode: ErrorCode,
  message: string,
  requestId: string,
  origin: string | null = null,
  retryAfter?: number
): Response {
  const status = STATUS_CODE_MAP[errorCode] || 500;
  const cors = getCorsHeaders(origin);
  const headers: Record<string, string> = {
    ...cors,
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };

  if (retryAfter !== undefined && retryAfter !== null && retryAfter > 0) {
    headers['Retry-After'] = String(Math.ceil(retryAfter));
  }

  const body: StandardErrorEnvelope = {
    error: errorCode,
    message,
    request_id: requestId,
  };

  return new Response(JSON.stringify(body), {
    status,
    headers,
  });
}

export function mapDbErrorCodeToSafeError(dbErrorCode: string | null | undefined): {
  errorCode: ErrorCode;
  message: string;
} {
  switch (dbErrorCode) {
    case 'SESSION_CLOSED':
      return { errorCode: 'session_unavailable', message: 'Competition session is closed or unavailable' };
    case 'PARTICIPANT_KICKED':
      return { errorCode: 'forbidden', message: 'Participant access has been revoked' };
    case 'PARTICIPANT_DISCONNECTED':
      return { errorCode: 'forbidden', message: 'Participant is disconnected' };
    case 'USER_ID_MISMATCH':
      return { errorCode: 'forbidden', message: 'Participant does not belong to authenticated user' };
    case 'NOT_AN_AUTHENTICATED_PARTICIPANT':
    case 'NOT_A_GUEST_PARTICIPANT':
      return { errorCode: 'forbidden', message: 'Participant credential mode mismatch' };
    case 'INVALID_GUEST_CREDENTIALS':
    case 'INVALID_GUEST_TOKEN':
    case 'PARTICIPANT_NOT_FOUND':
    case 'SESSION_NOT_FOUND':
    case 'INVALID_INPUT':
    case 'PARTICIPANT_STATUS_INVALID':
    default:
      return { errorCode: 'unauthorized', message: 'Invalid competition credentials' };
  }
}
