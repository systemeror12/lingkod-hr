'use client';

import { useEffect } from 'react';
import styles from '../../components/workspace.module.css';

export default function ErrorSurface({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className={styles.state} aria-labelledby="error-title">
      <span className={styles.stateCode}>Unavailable</span>
      <h2 id="error-title">The workspace could not be loaded</h2>
      <p>Try the request again. If the problem continues, return to the Dashboard.</p>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </section>
  );
}
