'use client';

// PROTOTYPE (#399). Reads screen, state, and variant from the URL, fakes a short wait on submit,
// and shows the current fake state in a corner panel.

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { PrototypeSwitcher } from '../../components/prototype-switcher';
import { screens, variants, type ScreenKey } from './fake-states';
import { BrandedSunrise, brandFor, stateFrom, viewFor } from './public-screens';
import { SettingsFrame, SettingsOnePage, SettingsPanels } from './settings-screens';

const FAKE_LATENCY_MS = 700;

export function Prototype() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const definition = screens.find(({ key }) => key === params.get('screen')) ?? screens[0]!;
  const screen = definition.key;
  const state =
    definition.states.find(({ key }) => key === params.get('state'))?.key ??
    definition.states[0]!.key;
  const options = variants[screen];
  const variant = options.find(({ key }) => key === params.get('variant'))?.key ?? 'A';
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
    const wanted = next.variant ?? variant;
    const query = new URLSearchParams({
      screen: nextScreen,
      state: next.state ?? (nextScreen !== screen ? '' : state),
      variant: variants[nextScreen].some(({ key }) => key === wanted) ? wanted : 'A',
    });
    if (!query.get('state')) query.delete('state');
    if (timer.current) clearTimeout(timer.current);
    setBusy(false);
    router.replace(`${pathname}?${query.toString()}`, { scroll: false });
  }

  const submit = (next: () => void) => {
    setBusy(true);
    timer.current = setTimeout(() => {
      setBusy(false);
      next();
    }, FAKE_LATENCY_MS);
  };

  const fake = definition.states.find(({ key }) => key === state)!.fake;
  let body;
  if (screen === 'settings') {
    const props = { state, go: (next: string) => navigate({ state: next }), busy, submit };
    body = (
      <SettingsFrame>
        {variant === 'B' ? (
          <SettingsPanels key={`${state}:B`} {...props} />
        ) : (
          <SettingsOnePage key={`${state}:A`} {...props} />
        )}
      </SettingsFrame>
    );
  } else {
    // #398 flow steps that this prototype has a state for move it; the rest stay put.
    const go = (next: string) => {
      const mapped = stateFrom[screen]?.[next];
      if (mapped) navigate({ state: mapped });
    };
    const { seal, align, scene } = brandFor(screen, state, variant);
    body = (
      <BrandedSunrise
        // The scene stays mounted across steps, so progress transitions instead of jumping.
        key={`${screen}:${variant}`}
        props={{
          view: viewFor(screen, state, go),
          busy,
          submit,
          stateKey: `${screen}:${state}:${variant}`,
        }}
        seal={seal}
        align={align}
        scene={scene}
      />
    );
  }

  return (
    <>
      {body}
      <aside
        aria-label="Fake state"
        className="fixed top-3 right-3 z-50 grid max-w-80 gap-1 rounded-panel bg-[#1b1033]/95 p-3 font-mono text-[11px] leading-4 text-fuchsia-100 shadow-lg ring-2 ring-fuchsia-400"
      >
        <span className="font-sans text-caption font-[700] text-fuchsia-300 uppercase">
          Fake state{busy ? ' · request in flight' : ''}
        </span>
        <span>screen: {screen}</span>
        <span>state: {state}</span>
        {Object.entries(fake).map(([name, value]) => (
          <span key={name}>
            {name}: {String(value)}
          </span>
        ))}
      </aside>
      <PrototypeSwitcher
        screens={screens.map(({ key, label }) => ({ key, label }))}
        screen={screen}
        states={definition.states.map(({ key, label }) => ({ key, label }))}
        state={state}
        variants={options}
        variant={variant}
        onChange={navigate}
      />
    </>
  );
}
