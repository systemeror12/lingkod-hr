import { describe, expect, it, vi } from 'vitest';
import { requestSignOut } from './sign-out-button';

const answering = (status: number) =>
  vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));

describe('requestSignOut', () => {
  it('posts to the relative logout route with credentials', async () => {
    const request = answering(200);
    await requestSignOut(request);
    expect(request).toHaveBeenCalledWith('/api/v1/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
  });

  it.each([200, 401])('counts %i as signed out', async (status) => {
    expect(await requestSignOut(answering(status))).toBe(true);
  });

  it.each([403, 500, 503])('keeps the session on %i', async (status) => {
    expect(await requestSignOut(answering(status))).toBe(false);
  });

  it('keeps the session when the request never reaches the server', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await requestSignOut(request)).toBe(false);
  });
});
