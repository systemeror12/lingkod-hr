'use client';

// PROTOTYPE: three enterprise-workbench design directions for the whole
// LingkodHR client (B is the current pick), switchable via `?variant=` on this
// throwaway route. All variants share the collapsible lifecycle nav and render
// the same three screens (`?screen=queue|employees|record`) from in-memory
// fixtures. Lives outside (protected) because the variants replace the
// application shell itself. Delete once a direction is chosen.

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { PrototypeSwitcher } from '../../../components/prototype-switcher';
import { VariantA } from './variant-a';
import { VariantB } from './variant-b';
import { VariantC } from './variant-c';

const variants = [
  { key: 'A', name: 'Workbench, detail pane' },
  { key: 'B', name: 'Enterprise workbench' },
  { key: 'C', name: 'Workbench, folders & grid' },
] as const;

function Prototype() {
  const variant = useSearchParams().get('variant') ?? 'A';
  return (
    <>
      {variant === 'A' && <VariantA />}
      {variant === 'B' && <VariantB />}
      {variant === 'C' && <VariantC />}
      <PrototypeSwitcher variants={variants} />
    </>
  );
}

export default function DesignPrototypePage() {
  return (
    <Suspense>
      <Prototype />
    </Suspense>
  );
}
