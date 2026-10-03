import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getConfig } from '@lingkod-hr/config';
import { getActiveSession } from '../../../lib/session';
import { AccountSecurity } from './account-security';

export const metadata: Metadata = { title: 'Account security' };

export const dynamic = 'force-dynamic';

export default async function AccountSecurityPage() {
  const session = await getActiveSession();
  const config = getConfig();
  const cookieStore = await cookies();
  const response = await fetch(`${config.API_URL}/api/v1/auth/recovery-codes`, {
    headers: { cookie: cookieStore.toString(), origin: new URL(config.APP_URL).origin },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Account security could not be loaded.');
  const status = (await response.json()) as { hasAuthenticator: boolean; remaining: number };
  return <AccountSecurity account={session.identity.email} initial={status} />;
}
