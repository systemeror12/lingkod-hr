// PROTOTYPE (#399). Throwaway route asking whether an Agency should show its own seal and building
// photo on the Civic sunrise login screens (#398), and how its Agency Administrator would manage
// them. Never merge into dev: it lives on the prototype/399-agency-seal branch only.
//
// Switch with `?screen=`, `?state=`, and `?variant=`. Fake in-memory state; no API.

import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Prototype } from './prototype';

export const metadata: Metadata = { title: 'PROTOTYPE · Agency seal and photo' };

export default function AgencyBrandPrototypePage() {
  return (
    <Suspense>
      <Prototype />
    </Suspense>
  );
}
