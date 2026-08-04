import { createHash, randomBytes } from 'node:crypto';
import type { AppConfig } from '../../config.js';

interface OidcTokenResponse {
  access_token: string;
  id_token: string;
  token_type: string;
}

interface OidcIdTokenClaims {
  iss: string;
  sub: string;
  name?: string;
  preferred_username?: string;
  email?: string;
}

export class OidcClient {
  private readonly metadata: { authorization_endpoint: string; token_endpoint: string } | null =
    null;

  constructor(private readonly config: AppConfig) {}

  buildAuthorizeUrl(state: string, codeChallenge: string): string {
    const issuer = this.config.oidcIssuer!;
    const params = new URLSearchParams({
      client_id: this.config.oidcClientId!,
      redirect_uri: this.config.oidcRedirectUri!,
      response_type: 'code',
      scope: 'openid profile email',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    return `${issuer}/authorize/?${params.toString()}`;
  }

  async exchangeCode(
    code: string,
    codeVerifier: string,
  ): Promise<{ issuer: string; subject: string; name: string; email?: string }> {
    const issuer = this.config.oidcIssuer!;
    const tokenEndpoint = `${issuer}/token/`;
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.config.oidcClientId!,
      client_secret: this.config.oidcClientSecret ?? '',
      redirect_uri: this.config.oidcRedirectUri!,
      code,
      code_verifier: codeVerifier,
    });

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) {
      throw new Error(`OIDC token exchange failed (${response.status})`);
    }
    const tokenJson = (await response.json()) as OidcTokenResponse;
    const claims = parseIdToken(tokenJson.id_token);
    return {
      issuer: claims.iss,
      subject: claims.sub,
      name: claims.name ?? claims.preferred_username ?? 'User',
      email: claims.email,
    };
  }
}

function parseIdToken(idToken: string): OidcIdTokenClaims {
  const [, payload] = idToken.split('.');
  if (!payload) {
    throw new Error('Invalid id_token');
  }
  const json = Buffer.from(payload, 'base64url').toString('utf8');
  return JSON.parse(json) as OidcIdTokenClaims;
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}
