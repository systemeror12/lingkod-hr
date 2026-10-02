'use client';

// PROTOTYPE (#398). Reads screen, state, and variant from the URL, fakes a short wait on submit,
// and shows the current fake state in a corner panel.

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { PrototypeSwitcher } from '../../components/prototype-switcher';
import { screens, variantsFor, type ScreenKey } from './fake-states';
import { publicView, type Go } from './public-flows';
import { ContextStrip, SingleCard, StepRail } from './public-variants';
import {
  AccountDialogs,
  AccountInline,
  AdminDialogs,
  AdminInline,
  ProtectedFrame,
} from './protected-variants';

const FAKE_LATENCY_MS = 700;

export function Prototype() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const screen = (screens.find(({ key }) => key === params.get('screen')) ?? screens[0]!).key;
  const definition = screens.find(({ key }) => key === screen)!;
  const state =
    definition.states.find(({ key }) => key === params.get('state'))?.key ??
    definition.states[0]!.key;
  const variants = variantsFor(screen);
  const variant =
    variants.find(({ key }) => key === params.get('variant'))?.key ?? variants[0]!.key;
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function navigate(next: { screen?: string; state?: string; variant?: string }) {
    const nextScreen = (next.screen ?? screen) as ScreenKey;
    const nextVariants = variantsFor(nextScreen);
    const wanted = next.variant ?? variant;
    const query = new URLSearchParams({
      screen: nextScreen,
      state: next.state ?? (next.screen && next.screen !== screen ? '' : state),
      variant: nextVariants.some(({ key }) => key === wanted) ? wanted : 'A',
    });
    if (!query.get('state')) query.delete('state');
    if (timer.current) clearTimeout(timer.current);
    setBusy(false);
    router.replace(`${pathname}?${query.toString()}`, { scroll: false });
  }

  const go: Go = (nextState, nextScreen) =>
    navigate({ state: nextState, ...(nextScreen ? { screen: nextScreen } : {}) });
  const submit = (next: () => void) => {
    setBusy(true);
    timer.current = setTimeout(() => {
      setBusy(false);
      next();
    }, FAKE_LATENCY_MS);
  };

  const key = `${screen}:${state}:${variant}`;
  const fake = definition.states.find(({ key: k }) => k === state)!.fake;
  let body;
  if (screen === 'reauth' || screen === 'account' || screen === 'admin') {
    const props = { screen, state, go, busy, submit };
    body = (
      <ProtectedFrame admin={screen === 'admin'}>
        {screen === 'admin' ? (
          variant === 'B' ? (
            <AdminInline key={key} {...props} />
          ) : (
            <AdminDialogs key={key} {...props} />
          )
        ) : variant === 'B' ? (
          <AccountInline key={key} {...props} />
        ) : (
          <AccountDialogs key={key} {...props} />
        )}
      </ProtectedFrame>
    );
  } else {
    const Variant = variant === 'B' ? StepRail : variant === 'C' ? ContextStrip : SingleCard;
    body = <Variant key={key} view={publicView(screen, state, go)} busy={busy} submit={submit} />;
  }

  return (
    <>
      {body}
      <aside
        aria-label="Fake state"
        className="fixed top-3 right-3 z-50 grid max-w-72 gap-1 rounded-panel bg-[#1b1033]/95 p-3 font-mono text-[11px] leading-4 text-fuchsia-100 shadow-lg ring-2 ring-fuchsia-400"
      >
        <span className="font-sans text-caption font-[700] text-fuchsia-300 uppercase">
          Fake state{busy ? ' · request in flight' : ''}
        </span>
        <span>screen: {screen}</span>
        <span>state: {state}</span>
        {Object.entries(fake).map(([name, value]) => (
          <span key={name}>
            {name}: {Array.isArray(value) ? value.join(', ') : String(value)}
          </span>
        ))}
      </aside>
      <PrototypeSwitcher
        screens={screens.map(({ key, label }) => ({ key, label }))}
        screen={screen}
        states={definition.states.map(({ key, label }) => ({ key, label }))}
        state={state}
        variants={variants}
        variant={variant}
        onChange={navigate}
      />
    </>
  );
}
