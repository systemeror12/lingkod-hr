import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../../components/ui/page-header';
import { Panel } from '../../../components/ui/panel';
import { authorizedDestinations } from '../../../lib/navigation';
import { getActiveSession } from '../../../lib/session';

export const metadata: Metadata = { title: 'Work queue' };

export default async function DashboardPage() {
  const session = await getActiveSession();
  const availableWork = authorizedDestinations(session).filter(({ href }) => href !== '/dashboard');
  const roleNames =
    session.effectiveRoles.map(({ name }) => name).join(', ') || 'No effective role';
  const context = [
    { label: 'Agency', value: session.agency.name },
    ...(session.agency.acronym ? [{ label: 'Acronym', value: session.agency.acronym }] : []),
    { label: 'Signed in as', value: session.identity.displayName },
    { label: 'Effective roles', value: roleNames },
  ];

  return (
    <div className="grid gap-5">
      <PageHeader breadcrumbs={[{ label: 'Dashboard' }]} title="Work queue" />

      <Panel title="Signed-in context">
        <dl className="m-0 flex flex-wrap gap-x-10 gap-y-3">
          {context.map(({ label, value }) => (
            <div key={label}>
              <dt className="text-caption text-ink-muted">{label}</dt>
              <dd className="m-0 text-body font-[600] text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      <div className="grid grid-cols-1 items-start gap-5 min-[761px]:grid-cols-[minmax(0,1.25fr)_minmax(260px,0.75fr)]">
        <Panel title="Current work">
          <div className="grid gap-1.5 py-8">
            <strong className="text-body font-[600] text-ink">No work is waiting.</strong>
            <p className="m-0 max-w-[410px] text-body text-ink-muted">
              New authorized tasks will appear here as they enter your Agency work queue.
            </p>
          </div>
        </Panel>

        <Panel title="Available destinations" flush>
          <ul className="m-0 grid list-none p-0">
            {availableWork.map((destination) => (
              <li className="border-t border-border-subtle first:border-t-0" key={destination.href}>
                <Link
                  className="flex min-h-11 items-center justify-between gap-4 px-4 text-small font-[600] text-ink no-underline after:text-primary after:content-['→'] hover:bg-canvas"
                  href={destination.href}
                >
                  {destination.label}
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
