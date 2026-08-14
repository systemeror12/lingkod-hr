import type { Metadata } from 'next';
import Link from 'next/link';
import { authorizedDestinations } from '../../../lib/navigation';
import { getActiveSession } from '../../../lib/session';

export const metadata: Metadata = { title: 'Work queue' };

export default async function DashboardPage() {
  const session = await getActiveSession();
  const availableWork = authorizedDestinations(session).filter(({ href }) => href !== '/dashboard');
  const roleNames =
    session.effectiveRoles.map(({ name }) => name).join(', ') || 'No effective role';

  return (
    <div className="grid gap-[30px]">
      <header className="grid max-w-[720px] gap-2">
        <p className="m-0 text-[11px] font-bold tracking-[0.09em] text-cobalt uppercase">
          Dashboard
        </p>
        <h1 className="m-0 text-[clamp(28px,3vw,38px)] leading-[1.08] font-[680] tracking-[-0.035em] text-midnight">
          Work queue
        </h1>
        <p className="mt-0.5 mb-0 text-sm leading-[1.65] text-muted">
          Review the work available in your active Agency Context.
        </p>
      </header>

      <section
        className="grid grid-cols-1 rounded-[5px] border border-line bg-paper min-[761px]:grid-cols-[minmax(0,1.5fr)_minmax(180px,0.75fr)]"
        aria-label="Signed-in context"
      >
        <div className="grid gap-[15px] border-b border-line p-6 min-[761px]:border-r min-[761px]:border-b-0">
          <p className="m-0 text-[10px] font-bold tracking-[0.08em] text-muted uppercase">Agency</p>
          <strong className="text-lg font-[660] text-midnight">{session.agency.name}</strong>
          <span className="text-[13px] text-muted">
            {session.agency.acronym ?? 'Active Agency Context'}
          </span>
        </div>
        <div className="grid content-center gap-1.5 bg-[#fafbfd] p-6">
          <p className="m-0 text-[10px] font-bold tracking-[0.08em] text-muted uppercase">
            Signed in as
          </p>
          <strong className="text-[13px] font-[650]">{session.identity.displayName}</strong>
          <span className="text-[13px] text-muted">{roleNames}</span>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-[18px] min-[761px]:grid-cols-[minmax(0,1.25fr)_minmax(260px,0.75fr)]">
        <section
          className="min-h-[250px] rounded-[5px] border border-line bg-paper"
          aria-labelledby="queue-heading"
        >
          <header className="flex min-h-[54px] items-center justify-between border-b border-line px-5">
            <h2 className="m-0 text-sm font-[670] text-midnight" id="queue-heading">
              Current work
            </h2>
            <span className="text-[11px] text-muted">Today</span>
          </header>
          <div className="grid min-h-[195px] place-content-center justify-items-start gap-[7px] p-7">
            <strong className="text-[15px] font-[650] text-midnight">No work is waiting.</strong>
            <p className="m-0 max-w-[410px] text-[13px] leading-[1.6] text-muted">
              New authorized tasks will appear here as they enter your Agency work queue.
            </p>
          </div>
        </section>

        <section
          className="min-h-[250px] rounded-[5px] border border-line bg-paper"
          aria-labelledby="destinations-heading"
        >
          <header className="flex min-h-[54px] items-center justify-between border-b border-line px-5">
            <h2 className="m-0 text-sm font-[670] text-midnight" id="destinations-heading">
              Available destinations
            </h2>
          </header>
          <ul className="m-0 grid list-none py-1">
            {availableWork.map((destination) => (
              <li className="border-t border-line first:border-t-0" key={destination.href}>
                <Link
                  className="flex min-h-[58px] items-center justify-between gap-4 px-5 text-[13px] font-[610] text-ink no-underline after:text-cobalt after:content-['→'] hover:bg-pale-blue"
                  href={destination.href}
                >
                  {destination.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
