'use client';

import { useEffect } from 'react';
import { StateCode, StateSurface } from '../../components/state-surface';
import { Button } from '../../components/ui/button';

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
    <StateSurface labelledBy="error-title">
      <StateCode>Unavailable</StateCode>
      <h2 className="m-0 text-2xl font-[670] tracking-[-0.025em] text-midnight" id="error-title">
        The workspace could not be loaded
      </h2>
      <p className="m-0 max-w-[500px] text-sm leading-[1.6] text-muted">
        Try the request again. If the problem continues, return to the Dashboard.
      </p>
      <Button className="mt-2" variant="primary" size="default" type="button" onClick={reset}>
        Try again
      </Button>
    </StateSurface>
  );
}
