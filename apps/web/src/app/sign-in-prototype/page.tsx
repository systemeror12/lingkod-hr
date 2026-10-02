// PROTOTYPE (#398). Throwaway route comparing login and account security designs. Never merge
// into dev: it lives on the prototype/398-login-screens branch only.
//
// Plan: every login and account security screen from #374–#382 on one route, switchable with
// `?screen=`, `?state=`, and `?variant=` (A/B/C public, A/B signed-in). Fake in-memory state; no API.

import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Prototype } from './prototype';

export const metadata: Metadata = { title: 'PROTOTYPE · Login screens' };

export default function SignInPrototypePage() {
  return (
    <Suspense>
      <Prototype />
    </Suspense>
  );
}
