import { cache } from 'react';
import { isActiveSessionResponse, type ActiveSessionResponse } from '@lingkod-hr/auth';
import { getConfig } from '@lingkod-hr/config';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export type ActiveSession = ActiveSessionResponse;

export const getActiveSession = cache(async (): Promise<ActiveSession> => {
  const { API_URL: apiUrl, APP_URL: appUrl } = getConfig();
  const cookieStore = await cookies();
  const response = await fetch(`${apiUrl}/api/v1/auth/me`, {
    headers: {
      cookie: cookieStore.toString(),
      origin: new URL(appUrl).origin,
    },
    cache: 'no-store',
  });

  if (response.status === 401) {
    redirect('/sign-in');
  }
  if (!response.ok) {
    throw new Error('The protected workspace could not be loaded.');
  }

  const value: unknown = await response.json();
  if (!isActiveSessionResponse(value)) {
    throw new Error('The protected workspace returned an invalid session context.');
  }
  return value;
});

export { hasPermission } from './navigation';
