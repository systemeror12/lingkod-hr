import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { ApplicationShell } from '../../components/application-shell';
import { authorizedDestinations, navigationCollapsedCookie } from '../../lib/navigation';
import { getActiveSession } from '../../lib/session';

export const dynamic = 'force-dynamic';

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const session = await getActiveSession();
  const collapsed = (await cookies()).has(navigationCollapsedCookie);
  return (
    <ApplicationShell
      session={session}
      destinations={authorizedDestinations(session)}
      initialCollapsed={collapsed}
    >
      {children}
    </ApplicationShell>
  );
}
