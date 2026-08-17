import { createHash, randomBytes } from 'node:crypto';
import { createLocalJWKSet, jwtVerify, type JWTPayload, type JSONWebKeySet } from 'jose';

const BACK_CHANNEL_LOGOUT_EVENT = 'http://schemas.openid.net/event/backchannel-logout';
const CACHE_FALLBACK_MS = 5 * 60 * 1000;

export interface OidcClientOptions {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface OidcIdentity {
  issuer: string;
  subject: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  providerSid: string | null;
  authTime: Date | null;
  authenticationMethods: readonly string[];
}

export interface OidcLogoutIdentity {
  subject: string | null;
  providerSid: string | null;
  eventId: string;
}

interface OidcDiscovery {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  endSessionEndpoint: string | null;
}

interface Cached<T> {
  value: T;
  expiresAt: number;
}

interface OidcClaims extends JWTPayload {
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  preferred_username?: unknown;
  sid?: unknown;
  auth_time?: unknown;
  amr?: unknown;
}

function cacheExpiry(headers: Headers): number {
  const match = headers.get('cache-control')?.match(/(?:^|,)\s*max-age=(\d+)/i);
  const maxAge = match?.[1] ? Number(match[1]) * 1000 : CACHE_FALLBACK_MS;
  return Date.now() + Math.max(1000, maxAge);
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) throw new OidcError(`OIDC provider returned HTTP ${response.status}.`);
  const value: unknown = await response.json();
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OidcError('OIDC provider returned an invalid JSON object.');
  }
  return value as Record<string, unknown>;
}

function requiredUrl(value: unknown, field: string, requireHttps: boolean): string {
  if (typeof value !== 'string') throw new OidcError(`OIDC discovery is missing ${field}.`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OidcError(`OIDC discovery returned an invalid ${field}.`);
  }
  if (requireHttps && url.protocol !== 'https:') {
    throw new OidcError(`OIDC discovery returned a non-HTTPS ${field}.`);
  }
  return url.toString();
}

function parseDiscovery(value: Record<string, unknown>, requireHttps: boolean): OidcDiscovery {
  return {
    authorizationEndpoint: requiredUrl(
      value.authorization_endpoint,
      'authorization_endpoint',
      requireHttps,
    ),
    tokenEndpoint: requiredUrl(value.token_endpoint, 'token_endpoint', requireHttps),
    jwksUri: requiredUrl(value.jwks_uri, 'jwks_uri', requireHttps),
    endSessionEndpoint:
      value.end_session_endpoint === undefined || value.end_session_endpoint === null
        ? null
        : requiredUrl(value.end_session_endpoint, 'end_session_endpoint', requireHttps),
  };
}

export class OidcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OidcError';
  }
}

export function createPkceVerifier(): string {
  return randomBytes(32).toString('base64url');
}

export function createPkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export class OidcClient {
  private discoveryCache: Cached<OidcDiscovery> | undefined;
  private jwksCache: Cached<ReturnType<typeof createLocalJWKSet>> | undefined;

  constructor(private readonly options: OidcClientOptions) {}

  async authorizationUrl(
    state: string,
    nonce: string,
    verifier: string,
    loginHint: string | null = null,
  ): Promise<string> {
    const discovery = await this.discovery();
    const url = new URL(discovery.authorizationEndpoint);
    url.searchParams.set('client_id', this.options.clientId);
    url.searchParams.set('redirect_uri', this.options.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('code_challenge', createPkceChallenge(verifier));
    url.searchParams.set('code_challenge_method', 'S256');
    if (loginHint) url.searchParams.set('login_hint', loginHint);
    return url.toString();
  }

  async exchangeCode(code: string, verifier: string): Promise<string> {
    const discovery = await this.discovery();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
      redirect_uri: this.options.redirectUri,
      code_verifier: verifier,
    });
    const response = await fetch(discovery.tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const payload = await readJson(response);
    if (typeof payload.id_token !== 'string') {
      throw new OidcError('OIDC token response did not contain an ID token.');
    }
    return payload.id_token;
  }

  async verifyIdToken(token: string, nonce: string): Promise<OidcIdentity> {
    const payload = await this.verify(token);
    if (payload.nonce !== nonce) throw new OidcError('OIDC nonce validation failed.');

    const claims = payload as OidcClaims;
    if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
      throw new OidcError('OIDC subject is missing.');
    }
    if (typeof claims.email !== 'string' || claims.email.length === 0) {
      throw new OidcError('OIDC email is missing.');
    }
    if (claims.email_verified !== true) throw new OidcError('OIDC email is not verified.');
    if (claims.azp !== undefined && claims.azp !== this.options.clientId) {
      throw new OidcError('OIDC authorized party validation failed.');
    }

    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (audience.length > 1 && claims.azp !== this.options.clientId) {
      throw new OidcError('OIDC authorized party is required for multiple audiences.');
    }

    const authTime =
      typeof claims.auth_time === 'number' ? new Date(claims.auth_time * 1000) : null;
    const authenticationMethods = Array.isArray(claims.amr)
      ? claims.amr.filter((method): method is string => typeof method === 'string')
      : [];

    return {
      issuer: this.options.issuer,
      subject: claims.sub,
      email: claims.email.trim().toLowerCase(),
      displayName:
        typeof claims.name === 'string'
          ? claims.name
          : typeof claims.preferred_username === 'string'
            ? claims.preferred_username
            : claims.email,
      emailVerified: true,
      providerSid: typeof claims.sid === 'string' ? claims.sid : null,
      authTime,
      authenticationMethods,
    };
  }

  async verifyLogoutToken(token: string): Promise<OidcLogoutIdentity> {
    const payload = await this.verify(token);
    const events = payload.events;
    if (typeof events !== 'object' || events === null || !(BACK_CHANNEL_LOGOUT_EVENT in events)) {
      throw new OidcError('OIDC logout event is missing.');
    }
    const subject = typeof payload.sub === 'string' ? payload.sub : null;
    const providerSid = typeof payload.sid === 'string' ? payload.sid : null;
    if (subject === null && providerSid === null) {
      throw new OidcError('OIDC logout subject or session identifier is missing.');
    }
    if (typeof payload.jti !== 'string' || payload.jti.length === 0) {
      throw new OidcError('OIDC logout event identifier is missing.');
    }
    return { subject, providerSid, eventId: payload.jti };
  }

  async providerLogoutUrl(): Promise<string | null> {
    try {
      const endpoint = (await this.discovery()).endSessionEndpoint;
      if (!endpoint) return null;
      const url = new URL(endpoint);
      url.searchParams.set('client_id', this.options.clientId);
      return url.toString();
    } catch {
      return null;
    }
  }

  private async discovery(): Promise<OidcDiscovery> {
    if (this.discoveryCache && this.discoveryCache.expiresAt > Date.now()) {
      return this.discoveryCache.value;
    }
    const issuer = this.options.issuer.replace(/\/$/, '');
    const response = await fetch(`${issuer}/.well-known/openid-configuration`);
    const discovery = parseDiscovery(
      await readJson(response),
      new URL(this.options.issuer).protocol === 'https:',
    );
    this.discoveryCache = { value: discovery, expiresAt: cacheExpiry(response.headers) };
    return discovery;
  }

  private async jwks(refresh = false): Promise<ReturnType<typeof createLocalJWKSet>> {
    if (!refresh && this.jwksCache && this.jwksCache.expiresAt > Date.now()) {
      return this.jwksCache.value;
    }
    const response = await fetch((await this.discovery()).jwksUri);
    const value = await readJson(response);
    const keySet = createLocalJWKSet(value as unknown as JSONWebKeySet);
    this.jwksCache = { value: keySet, expiresAt: cacheExpiry(response.headers) };
    return keySet;
  }

  private async verify(token: string): Promise<JWTPayload> {
    try {
      return (
        await jwtVerify(token, await this.jwks(), {
          issuer: this.options.issuer,
          audience: this.options.clientId,
          algorithms: ['RS256'],
          clockTolerance: 5,
        })
      ).payload;
    } catch (error: unknown) {
      if (error instanceof Error && error.constructor.name === 'JWKSNoMatchingKey') {
        try {
          return (
            await jwtVerify(token, await this.jwks(true), {
              issuer: this.options.issuer,
              audience: this.options.clientId,
              algorithms: ['RS256'],
              clockTolerance: 5,
            })
          ).payload;
        } catch {
          throw new OidcError('OIDC token validation failed.');
        }
      }
      throw new OidcError('OIDC token validation failed.');
    }
  }
}
