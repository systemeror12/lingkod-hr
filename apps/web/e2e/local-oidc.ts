import { createHash, generateKeyPairSync, randomUUID, sign, type KeyObject } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';

const host = '127.0.0.1';
const port = 4100;
const issuer = `http://${host}:${port}`;
const clientId = 'local-client';
const clientSecret = 'local-client-secret';
const redirectUri = 'http://localhost:3101/api/v1/auth/callback';
const keyId = 'lingkod-hr-local-oidc';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = publicKey.export({ format: 'jwk' });
const authorizationCodes = new Map<string, { challenge: string; nonce: string }>();

function json(response: ServerResponse, value: unknown, status = 200): void {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

function encoded(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function idToken(nonce: string, signingKey: KeyObject): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const unsigned = `${encoded({ alg: 'RS256', kid: keyId, typ: 'JWT' })}.${encoded({
    iss: issuer,
    sub: 'local-work-queue-user',
    aud: clientId,
    azp: clientId,
    exp: issuedAt + 300,
    iat: issuedAt,
    auth_time: issuedAt,
    nonce,
    email: 'marisol.santos@example.test',
    email_verified: true,
    name: 'Marisol Santos',
    sid: 'local-work-queue-session',
    amr: ['pwd', 'otp'],
  })}`;
  const signature = sign('RSA-SHA256', Buffer.from(unsigned), signingKey).toString('base64url');
  return `${unsigned}.${signature}`;
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', issuer);

  if (request.method === 'GET' && url.pathname === '/health') {
    json(response, { status: 'ok' });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/.well-known/openid-configuration') {
    json(response, {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
    });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/jwks') {
    json(response, { keys: [{ ...publicJwk, alg: 'RS256', kid: keyId, use: 'sig' }] });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/authorize') {
    const state = url.searchParams.get('state');
    const nonce = url.searchParams.get('nonce');
    const challenge = url.searchParams.get('code_challenge');
    const valid =
      url.searchParams.get('client_id') === clientId &&
      url.searchParams.get('redirect_uri') === redirectUri &&
      url.searchParams.get('response_type') === 'code' &&
      url.searchParams.get('code_challenge_method') === 'S256' &&
      state &&
      nonce &&
      challenge;
    if (!valid) {
      json(response, { error: 'invalid_request' }, 400);
      return;
    }
    const code = randomUUID();
    authorizationCodes.set(code, { challenge, nonce });
    const callback = new URL(redirectUri);
    callback.searchParams.set('state', state);
    callback.searchParams.set('code', code);
    response.writeHead(302, { location: callback.toString() });
    response.end();
    return;
  }
  if (request.method === 'POST' && url.pathname === '/token') {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () => {
      const values = new URLSearchParams(body);
      const code = values.get('code') ?? '';
      const verifier = values.get('code_verifier') ?? '';
      const flow = authorizationCodes.get(code);
      authorizationCodes.delete(code);
      const verifiedChallenge = createHash('sha256').update(verifier).digest('base64url');
      const valid =
        flow &&
        values.get('grant_type') === 'authorization_code' &&
        values.get('client_id') === clientId &&
        values.get('client_secret') === clientSecret &&
        values.get('redirect_uri') === redirectUri &&
        verifiedChallenge === flow.challenge;
      if (!valid) {
        json(response, { error: 'invalid_grant' }, 400);
        return;
      }
      json(response, {
        token_type: 'Bearer',
        expires_in: 300,
        id_token: idToken(flow.nonce, privateKey),
      });
    });
    return;
  }

  json(response, { error: 'not_found' }, 404);
});

server.listen(port, host);

function close(): void {
  server.close(() => process.exit(0));
}

process.on('SIGINT', close);
process.on('SIGTERM', close);
