import Link from 'next/link';
import styles from './workspace.module.css';

export function ShellState({
  code,
  title,
  message,
}: {
  code: string;
  title: string;
  message: string;
}) {
  return (
    <section className={styles.state} aria-labelledby="shell-state-title">
      <span className={styles.stateCode}>{code}</span>
      <h1 id="shell-state-title">{title}</h1>
      <p>{message}</p>
      <Link href="/dashboard">Return to Dashboard</Link>
    </section>
  );
}
