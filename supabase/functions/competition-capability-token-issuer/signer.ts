// supabase/functions/competition-capability-token-issuer/signer.ts
import { CapabilityJwtClaims, CapabilityTokenResponse } from './types.ts';
import { CapabilityIssuerError } from './errors.ts';

const CAPABILITY_TTL_SECONDS = 300;

export function resolveSigningKey(): string | null {
  const key = typeof Deno !== 'undefined' ? Deno.env?.get('COMPETITION_CAPABILITY_SIGNING_KEY') : undefined;
  if (key && typeof key === 'string' && key.trim() !== '') {
    return key.trim();
  }
  return null;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = typeof btoa === 'function' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function stringToBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  return base64UrlEncode(bytes);
}

export async function mintCapabilityToken(
  sessionId: string,
  participantId: string,
  explicitSigningKey?: string
): Promise<CapabilityTokenResponse> {
  const signingKey = explicitSigningKey || resolveSigningKey();
  if (!signingKey) {
    throw new CapabilityIssuerError('internal_error', 'Capability token signing key is not configured');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expSeconds = nowSeconds + CAPABILITY_TTL_SECONDS;

  // STRICT CLAIMS CONTRACT: EXACTLY 5 CLAIMS ONLY
  const claims: CapabilityJwtClaims = {
    role: 'competition_guest',
    session_id: sessionId,
    participant_id: participantId,
    iat: nowSeconds,
    exp: expSeconds,
  };

  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  const headerB64 = stringToBase64Url(JSON.stringify(header));
  const payloadB64 = stringToBase64Url(JSON.stringify(claims));
  const signingInput = `${headerB64}.${payloadB64}`;

  const encoder = new TextEncoder();
  const keyData = encoder.encode(signingKey);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    encoder.encode(signingInput)
  );

  const signatureB64 = base64UrlEncode(new Uint8Array(signatureBuffer));
  const token = `${signingInput}.${signatureB64}`;

  return {
    token,
    expires_at: expSeconds,
    expires_in: 300,
  };
}
