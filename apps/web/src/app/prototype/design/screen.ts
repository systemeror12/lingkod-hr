'use client';

// PROTOTYPE: screen + selection state kept in the URL so reloads and shares are stable.

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { employees } from './fixtures';

export type Screen = 'queue' | 'employees' | 'record';

export function usePrototypeState() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const screen = (params.get('screen') as Screen | null) ?? 'queue';
  const employee = employees.find(({ id }) => id === params.get('employee')) ?? employees[0]!;

  function set(values: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(values)) next.set(key, value);
    router.replace(`${pathname}?${next}`, { scroll: false });
  }

  return {
    screen,
    employee,
    navCollapsed: params.get('nav') === 'collapsed',
    setNavCollapsed: (collapsed: boolean) => set({ nav: collapsed ? 'collapsed' : 'open' }),
    go: (next: Screen) => set({ screen: next }),
    openEmployee: (id: string) => set({ screen: 'record', employee: id }),
  };
}
