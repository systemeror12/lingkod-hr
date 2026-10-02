'use client';

// PROTOTYPE (#399). The Civic sunrise screens from #398 with an Agency's own seal and photo.
// Throwaway; do not import.

import type { ReactNode } from 'react';
import { agency } from '../sign-in-prototype/fake-states';
import { LetterheadContent, type SealOverride } from '../sign-in-prototype/letterhead-variant';
import {
  inviteView,
  resetView,
  signInView,
  type Go,
  type StepView,
} from '../sign-in-prototype/public-flows';
import type { VariantProps } from '../sign-in-prototype/public-variants';
import {
  CivicScene,
  LingkodMark,
  NAVY,
  captionOf,
  gloomOf,
  progressOf,
  useArrived,
} from '../sign-in-prototype/sunrise-variant';
import { PHOTO_SRC, SEAL_SRC } from './fake-states';

export type SceneKind = 'drawn' | 'photo-replaces' | 'photo-inside' | 'pediment';

const ease = 'cubic-bezier(.2,.7,.2,1)';

/** The Agency photo fills the panel. Progress can only lift a dawn tint; errors desaturate it. */
function PhotoScene({ progress, gloom }: { progress: number; gloom: boolean }) {
  const arrived = useArrived();
  return (
    <div className="lh-scene absolute inset-0">
      <img
        src={PHOTO_SRC}
        alt="The Agency's building"
        className="size-full object-cover"
        style={{
          filter: gloom ? 'grayscale(0.85) brightness(0.6)' : 'none',
          transition: 'filter 900ms ease',
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(180deg, ${NAVY} 0%, #1d3d73d0 45%, #e2a65070 100%)`,
          opacity: arrived ? (1 - progress) * 0.8 : 0.95,
          transition: `opacity 1400ms ${ease}`,
        }}
      />
      {/* Keeps the LingkodHR mark readable on a bright sky. */}
      <div
        className="absolute inset-x-0 top-0 h-32"
        style={{ background: 'linear-gradient(180deg, rgb(0 0 0 / 45%), transparent)' }}
      />
    </div>
  );
}

/** The photo in an arched frame where the drawn building stood; lamps below take over the windows. */
function archedPhoto(lit: number) {
  const arch = 'M150 704 L150 470 A170 170 0 0 1 490 470 L490 704 Z';
  return (
    <g>
      <defs>
        <clipPath id="agency-arch">
          <path d={arch} />
        </clipPath>
      </defs>
      <image
        href={PHOTO_SRC}
        x="20"
        y="300"
        width="600"
        height="404"
        preserveAspectRatio="xMidYMid slice"
        clipPath="url(#agency-arch)"
      />
      <path d={arch} fill="none" stroke="#e8eef7" strokeWidth="10" />
      {Array.from({ length: 5 }, (_, index) => (
        <circle
          key={index}
          cx={200 + index * 60}
          cy="728"
          r="7"
          fill={index < lit ? '#f6d27a' : '#1d3a68'}
          style={{ transition: `fill 600ms ease ${index * 140}ms` }}
        />
      ))}
    </g>
  );
}

/** Sunrise layout from #398, with the letterhead seal and the scene as inputs. */
export function BrandedSunrise({
  props,
  seal,
  align = 'start',
  scene = 'drawn',
}: {
  props: VariantProps;
  seal?: SealOverride;
  align?: 'start' | 'center';
  scene?: SceneKind;
}) {
  const caption = captionOf(props);
  const progress = progressOf(props);
  const gloom = gloomOf(props);
  let art: ReactNode;
  if (scene === 'photo-replaces') art = <PhotoScene progress={progress} gloom={gloom} />;
  else
    art = (
      <CivicScene
        progress={progress}
        gloom={gloom}
        {...(scene === 'photo-inside' ? { building: archedPhoto } : {})}
        pedimentSeal={scene === 'pediment' ? SEAL_SRC : undefined}
      />
    );

  return (
    <main className="grid min-h-dvh bg-surface text-ink min-[960px]:grid-cols-[minmax(0,1.1fr)_minmax(460px,1fr)]">
      <div className="grid grid-rows-[minmax(0,1fr)_auto] bg-[#0b1a33] min-[960px]:sticky min-[960px]:top-0 min-[960px]:h-dvh">
        <div className="relative h-60 overflow-hidden bg-nav min-[960px]:h-auto">
          {art}
          <LingkodMark className="absolute inset-x-0 top-0 flex items-center gap-2.5 p-6 text-nav-ink min-[960px]:p-10" />
        </div>
        <div className="lh-caption hidden gap-2 px-10 pt-2 pb-12 text-white min-[960px]:grid">
          <p className="m-0 max-w-[18ch] text-[2.5rem] leading-[1.05] font-[700] tracking-[-0.025em] [text-wrap:balance]">
            {caption.title}
          </p>
          <p className="m-0 max-w-[46ch] text-body text-nav-ink/80">{caption.body}</p>
        </div>
      </div>

      <div className="grid place-items-center px-6 py-10 min-[621px]:px-14">
        <section aria-labelledby="proto-title" className="grid w-full max-w-[440px] gap-0">
          <LetterheadContent
            key={props.stateKey}
            {...props}
            align={align}
            {...(seal ? { seal } : {})}
          />
        </section>
      </div>
    </main>
  );
}

const signedIn = (go: Go): StepView => ({
  ...signInView('totp', go),
  outcome: {
    tone: 'success',
    kicker: 'Signed in',
    title: `Welcome back to ${agency.acronym}`,
    body: `You’re signed in to ${agency.name}.`,
    action: { label: 'Open workspace', go: () => go('sign-in') },
  },
});

/** Step views for each fake state, borrowed from the #398 flows. */
export function viewFor(screen: string, state: string, go: Go): StepView {
  if (screen === 'before-agency') {
    if (state === 'signed-in') return signedIn(go);
    if (state === 'reset-request') return resetView('request', go);
    if (state === 'reset-done') return resetView('done', go);
    return signInView('password', go);
  }
  const invite: Record<string, string> = {
    'no-seal': 'first-time',
    seal: 'first-time',
    codes: 'codes',
    stamped: 'done',
    'no-seal-stamped': 'done',
    'step-1': 'first-time',
    'step-2': 'enroll',
    'step-3': 'codes',
    done: 'done',
    expired: 'link-expired',
  };
  return inviteView(invite[state] ?? 'first-time', go);
}

/** Where a #398 flow step lands among this prototype's states, per screen. */
export const stateFrom: Record<string, Record<string, string>> = {
  letterhead: { enroll: 'codes', codes: 'codes', done: 'stamped', 'first-time': 'seal' },
  scene: { 'first-time': 'step-1', enroll: 'step-2', codes: 'step-3', done: 'done' },
  'before-agency': {
    totp: 'signed-in',
    password: 'sign-in',
    'request-sent': 'reset-done',
    request: 'reset-request',
  },
};

/** How each variant of each public screen places the seal and the scene. */
export function brandFor(
  screen: string,
  state: string,
  variant: string,
): { seal: SealOverride; align: 'start' | 'center'; scene: SceneKind } {
  if (screen === 'letterhead') {
    const hasSeal = !state.startsWith('no-seal');
    return variant === 'B'
      ? { seal: hasSeal ? { src: SEAL_SRC } : { textOnly: true }, align: 'center', scene: 'drawn' }
      : { seal: hasSeal ? { src: SEAL_SRC } : {}, align: 'start', scene: 'drawn' };
  }
  if (screen === 'before-agency') {
    const fromAgency = variant === 'B' || (variant === 'C' && state === 'signed-in');
    return {
      seal: fromAgency ? { src: SEAL_SRC, fromAgency: true } : { fromAgency: false },
      align: 'start',
      scene: 'drawn',
    };
  }
  const scene = ({ A: 'photo-replaces', B: 'photo-inside', C: 'pediment' } as const)[
    variant as 'A' | 'B' | 'C'
  ];
  return { seal: { src: SEAL_SRC }, align: 'start', scene: scene ?? 'drawn' };
}
