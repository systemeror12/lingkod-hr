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

it('rejects non-HTTPS endpoints discovered from an HTTPS issuer', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        authorization_endpoint: 'https://issuer.example/authorize',
        token_endpoint: 'http://issuer.example/token',
        jwks_uri: 'https://issuer.example/jwks',
      }),
    ),
  );
  const client = new OidcClient({
    issuer: 'https://issuer.example',
    clientId: 'client',
    clientSecret: 'secret',
    redirectUri: 'https://app.example/callback',
  });

  try {
    await expect(client.authorizationUrl('state', 'nonce', 'verifier')).rejects.toThrow(
      /non-HTTPS token_endpoint/,
    );
  } finally {
    fetch.mockRestore();
  }
});

it('treats provider logout discovery as optional', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('provider unavailable'));
  const client = new OidcClient({
    issuer: 'https://issuer.example',
    clientId: 'client',
    clientSecret: 'secret',
    redirectUri: 'https://app.example/callback',
  });

  try {
    await expect(client.providerLogoutUrl()).resolves.toBeNull();
  } finally {
    fetch.mockRestore();
  }
});

it('uses standard RP-initiated provider logout parameters', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        authorization_endpoint: 'https://issuer.example/authorize',
        token_endpoint: 'https://issuer.example/token',
        jwks_uri: 'https://issuer.example/jwks',
        end_session_endpoint: 'https://issuer.example/logout',
      }),
    ),
  );
  const client = new OidcClient({
    issuer: 'https://issuer.example',
    clientId: 'client',
    clientSecret: 'secret',
    redirectUri: 'https://app.example/callback',
  });

  try {
    const url = new URL((await client.providerLogoutUrl()) ?? '');
    expect(url.searchParams.get('client_id')).toBe('client');
    expect(url.searchParams.has('sid')).toBe(false);
  } finally {
    fetch.mockRestore();
  }
});
