import type { Metadata } from 'next';
import Link from 'next/link';
import { authorizedDestinations } from '../../../lib/navigation';
import { getActiveSession } from '../../../lib/session';
import styles from '../../../components/workspace.module.css';

export const metadata: Metadata = { title: 'Work queue' };

export default async function DashboardPage() {
  const session = await getActiveSession();
  const availableWork = authorizedDestinations(session).filter(({ href }) => href !== '/dashboard');
  const roleNames =
    session.effectiveRoles.map(({ name }) => name).join(', ') || 'No effective role';

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>Dashboard</p>
        <h1>Work queue</h1>
        <p>Review the work available in your active Agency Context.</p>
      </header>

      <section className={styles.contextCard} aria-label="Signed-in context">
        <div className={styles.contextLead}>
          <p className={styles.sectionLabel}>Agency</p>
          <strong>{session.agency.name}</strong>
          <span>{session.agency.acronym ?? 'Active Agency Context'}</span>
        </div>
        <div className={styles.contextSide}>
          <p className={styles.sectionLabel}>Signed in as</p>
          <strong>{session.identity.displayName}</strong>
          <span>{roleNames}</span>
        </div>
      </section>

      <div className={styles.grid}>
        <section className={styles.panel} aria-labelledby="queue-heading">
          <header className={styles.panelHeader}>
            <h2 id="queue-heading">Current work</h2>
            <span>Today</span>
          </header>
          <div className={styles.empty}>
            <strong>No work is waiting.</strong>
            <p>New authorized tasks will appear here as they enter your Agency work queue.</p>
          </div>
        </section>

        <section className={styles.panel} aria-labelledby="destinations-heading">
          <header className={styles.panelHeader}>
            <h2 id="destinations-heading">Available destinations</h2>
          </header>
          <ul className={styles.destinationList}>
            {availableWork.map((destination) => (
              <li key={destination.href}>
                <Link href={destination.href}>{destination.label}</Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
