import type { ReactNode } from 'react';
import { ApplicationShell } from '../../components/application-shell';
import { authorizedDestinations } from '../../lib/navigation';
import { getActiveSession } from '../../lib/session';

export const dynamic = 'force-dynamic';

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const session = await getActiveSession();
  return (
    <ApplicationShell session={session} destinations={authorizedDestinations(session)}>
      {children}
    </ApplicationShell>
  );
}
