// supabase/functions/competition-capability-token-issuer/validation.ts
import { ValidatedRequestBody } from './types.ts';
import { CapabilityIssuerError } from './errors.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 10 * 1024; // 10KB limit

export function isValidUuid(val: unknown): val is string {
  return typeof val === 'string' && UUID_REGEX.test(val.trim());
}

export async function parseAndValidateRequest(req: Request): Promise<ValidatedRequestBody> {
  // 1. Method check
  if (req.method !== 'POST') {
    throw new CapabilityIssuerError('invalid_request', 'Method not allowed: only POST is supported');
  }

  // 2. Body size check via Content-Length if present
  const contentLength = req.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    throw new CapabilityIssuerError('invalid_request', 'Request payload exceeds maximum allowed size');
  }

  // 3. Read body safely
  let rawBodyText = '';
  try {
    rawBodyText = await req.text();
  } catch (_) {
    throw new CapabilityIssuerError('invalid_request', 'Failed to read request body');
  }

  if (rawBodyText.length > MAX_BODY_BYTES) {
    throw new CapabilityIssuerError('invalid_request', 'Request payload exceeds maximum allowed size');
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBodyText);
  } catch (_) {
    throw new CapabilityIssuerError('invalid_request', 'Invalid JSON body');
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new CapabilityIssuerError('invalid_request', 'Request body must be a JSON object');
  }

  // 4. Strict Rejection of user_id in client body (Never trust user_id from client)
  if ('user_id' in body) {
    throw new CapabilityIssuerError('invalid_request', 'Field user_id is forbidden in request body');
  }

  // 5. Extract and validate session_id and participant_id
  const { session_id, participant_id, guest_token, ...unknownFields } = body;

  if (!isValidUuid(session_id)) {
    throw new CapabilityIssuerError('invalid_request', 'session_id must be a valid UUID');
  }

  if (!isValidUuid(participant_id)) {
    throw new CapabilityIssuerError('invalid_request', 'participant_id must be a valid UUID');
  }

  // 6. Check unknown unexpected fields
  const unknownKeys = Object.keys(unknownFields);
  if (unknownKeys.length > 0) {
    throw new CapabilityIssuerError('invalid_request', `Unexpected fields in body: ${unknownKeys.join(', ')}`);
  }

  // 7. Check credentials (guest_token vs Authorization Bearer)
  const authHeader = req.headers.get('authorization');
  const hasAuthHeader = Boolean(authHeader && authHeader.trim().length > 0);
  const hasGuestToken = Boolean(guest_token !== undefined && guest_token !== null);

  // Both present -> reject as invalid_request (400)
  if (hasGuestToken && hasAuthHeader) {
    throw new CapabilityIssuerError(
      'invalid_request',
      'Conflicting credentials: both guest_token and Authorization header provided'
    );
  }

  // Neither present -> return unauthorized (401)
  if (!hasGuestToken && !hasAuthHeader) {
    throw new CapabilityIssuerError(
      'unauthorized',
      'Missing credentials: provide guest_token or Authorization Bearer header'
    );
  }

  // Guest Mode
  if (hasGuestToken) {
    if (typeof guest_token !== 'string' || guest_token.trim().length < 32 || guest_token.trim().length > 256) {
      throw new CapabilityIssuerError(
        'invalid_request',
        'guest_token must be an opaque string between 32 and 256 characters'
      );
    }

    return {
      mode: 'guest',
      data: {
        session_id: (session_id as string).trim(),
        participant_id: (participant_id as string).trim(),
        guest_token: guest_token.trim(),
      },
    };
  }

  // Auth Mode
  const cleanAuth = (authHeader || '').trim();
  const bearerPrefix = 'bearer ';
  if (!cleanAuth.toLowerCase().startsWith(bearerPrefix)) {
    throw new CapabilityIssuerError('unauthorized', 'Authorization header must use Bearer scheme');
  }

  const bearerToken = cleanAuth.slice(bearerPrefix.length).trim();
  if (bearerToken.length === 0) {
    throw new CapabilityIssuerError('unauthorized', 'Bearer token cannot be empty');
  }

  return {
    mode: 'auth',
    data: {
      session_id: (session_id as string).trim(),
      participant_id: (participant_id as string).trim(),
    },
    bearerToken,
  };
}
