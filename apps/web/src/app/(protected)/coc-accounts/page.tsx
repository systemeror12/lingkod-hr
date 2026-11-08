import type { Metadata } from 'next';
import { getConfig } from '@lingkod-hr/config';
import { cookies } from 'next/headers';
import { ShellState } from '../../../components/shell-state';
import {
  CocAccountWorkspace,
  type CocAccountSummary,
} from '../../../components/coc-account-workspace';
import { getActiveSession, hasPermission } from '../../../lib/session';

export const metadata: Metadata = { title: 'COC Accounts' };
export const dynamic = 'force-dynamic';

const denied = (
  <ShellState
    code="403"
    title="You can’t open this page"
    message="Your active Agency Membership does not permit reading COC Accounts. Return to the Dashboard to continue."
  />
);

export default async function CocAccountsPage() {
  const session = await getActiveSession();
  if (!hasPermission(session, 'overtime.coc.read')) return denied;

  const config = getConfig();
  const cookieStore = await cookies();
  const response = await fetch(
    config.API_URL + '/api/v1/agencies/' + session.agencyId + '/coc-accounts',
    {
      headers: { cookie: cookieStore.toString(), origin: new URL(config.APP_URL).origin },
      cache: 'no-store',
    },
  );
  if (response.status === 403) return denied;
  if (!response.ok) throw new Error('COC Accounts could not be loaded.');
  const list: unknown = await response.json();
  if (
    typeof list !== 'object' ||
    list === null ||
    !Array.isArray((list as { accounts?: unknown }).accounts)
  ) {
    throw new Error('The COC Account response was invalid.');
  }

  return (
    <CocAccountWorkspace
      agencyId={session.agencyId}
      initial={(list as { accounts: CocAccountSummary[] }).accounts}
      canAdjust={hasPermission(session, 'overtime.coc.adjust')}
      canReverse={hasPermission(session, 'overtime.coc.reverse')}
    />
  );
}
