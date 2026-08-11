import { expect, it, vi } from 'vitest';
import { createPkceChallenge, OidcClient, OidcError } from './oidc';

it('creates the RFC 7636 S256 challenge for the verifier', () => {
  expect(createPkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  );
});

it('normalizes invalid provider tokens to an OIDC error', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const body = String(input).endsWith('/.well-known/openid-configuration')
      ? {
          authorization_endpoint: 'https://issuer.example/authorize',
          token_endpoint: 'https://issuer.example/token',
          jwks_uri: 'https://issuer.example/jwks',
        }
      : { keys: [] };
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  });

  try {
    const client = new OidcClient({
      issuer: 'https://issuer.example',
      clientId: 'client',
      clientSecret: 'secret',
      redirectUri: 'https://app.example/callback',
    });
    await expect(client.verifyIdToken('not-a-jwt', 'nonce')).rejects.toBeInstanceOf(OidcError);
  } finally {
    fetch.mockRestore();
  }
});
