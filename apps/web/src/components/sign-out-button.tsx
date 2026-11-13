'use client';

import { useState } from 'react';
import { cn } from '../lib/class-names';

/**
 * Ends the current session through the API. Resolves `true` once the server confirms the session
 * is over: it revoked it, or answered `401` because it had already ended. Any other answer, or no
 * answer, leaves the User signed in, so the caller must not say otherwise.
 */
export async function requestSignOut(request: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await request('/api/v1/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
    return response.ok || response.status === 401;
  } catch {
    return false;
  }
}

/** The shell's Sign out control. On success it loads `/sign-in`, dropping every cached page. */
export function SignOutButton({ className }: { className?: string }) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signOut() {
    setPending(true);
    setFailed(false);
    if (await requestSignOut()) {
      (globalThis as unknown as { location: { replace(url: string): void } }).location.replace(
        '/sign-in',
      );
      return;
    }
    setPending(false);
    setFailed(true);
  }

  return (
    <>
      <button
        type="button"
        aria-label="Sign out"
        title="Sign out"
        disabled={pending}
        onClick={() => void signOut()}
        className={cn(
          'grid size-8 shrink-0 cursor-pointer place-items-center rounded-panel text-nav-muted hover:bg-white/6 hover:text-nav-ink disabled:cursor-wait disabled:opacity-60',
          className,
        )}
      >
        <svg
          viewBox="0 0 24 24"
          className="size-4.5 fill-none stroke-current stroke-[1.7] [stroke-linecap:round] [stroke-linejoin:round]"
          aria-hidden="true"
        >
          <path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9" />
        </svg>
      </button>
      {failed && (
        <p
          role="alert"
          className="fixed right-4 bottom-4 left-4 z-40 m-0 min-[621px]:left-auto min-[621px]:max-w-80 rounded-panel border border-border bg-surface px-4 py-3 text-small text-danger shadow-[0_12px_32px_rgb(0_0_0/22%)]"
        >
          Sign-out didn’t complete, so you’re still signed in. Try again.
        </p>
      )}
    </>
  );
}
