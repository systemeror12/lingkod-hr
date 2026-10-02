'use client';

import { useEffect, useState, type ReactNode } from 'react';

// The public auth screens' design, chosen in #398: a government building at sunrise beside a
// letterhead form. The sun's height and the lit windows show progress through the flow. Every
// Agency sees the same scene until #399 decides otherwise.

const SUN = '#f2c14e';
const NAVY = '#0f2240';
const SEAL_GOLD = '#b8901f';
const WINDOWS = 5;
const EASE = 'cubic-bezier(.2,.7,.2,1)';

/** False for the first frames after mount, so the scene plays its one sunrise. */
function useArrived() {
  const [arrived, setArrived] = useState(false);
  useEffect(() => {
    const frame = setTimeout(() => setArrived(true), 60);
    return () => clearTimeout(frame);
  }, []);
  return arrived;
}

/** Eight rays, each a long beam flanked by two short ones, as on the flag's sun. */
function Rays() {
  return (
    <g fill={SUN}>
      {Array.from({ length: 8 }, (_, index) => (
        <g key={index} transform={`rotate(${index * 45 + 22.5} 320 330)`}>
          <path d="M314 245 L320 120 L326 245 Z" />
          <path d="M303 248 L296 175 L309 247 Z" opacity="0.8" />
          <path d="M337 248 L344 175 L331 247 Z" opacity="0.8" />
        </g>
      ))}
    </g>
  );
}

function Tree({ x, scale = 1 }: { x: number; scale?: number }) {
  return (
    <g transform={`translate(${x} 760) scale(${scale})`} fill="#0a1830">
      <rect x="-5" y="-80" width="10" height="80" />
      <circle cx="-34" cy="-104" r="38" />
      <circle cx="30" cy="-110" r="42" />
      <circle cx="-2" cy="-146" r="46" />
      <circle cx="-56" cy="-70" r="24" />
      <circle cx="54" cy="-74" r="26" />
    </g>
  );
}

function CivicScene({ progress, gloom }: { progress: number; gloom: boolean }) {
  const risen = useArrived();
  const sunDrop = risen ? (1 - progress) * 190 : 340;
  const lit = Math.round(progress * WINDOWS);

  return (
    <svg
      viewBox="-130 110 900 680"
      preserveAspectRatio="xMidYMax slice"
      className="lh-scene absolute inset-0 size-full"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="civic-dawn" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={NAVY} />
          <stop offset="0.45" stopColor="#1d3d73" />
          <stop offset="0.72" stopColor="#8a6a5a" />
          <stop offset="0.84" stopColor="#e2a650" />
        </linearGradient>
        <linearGradient id="civic-day" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#24508f" />
          <stop offset="0.6" stopColor="#5f8fc9" />
          <stop offset="0.84" stopColor="#f3d79b" />
        </linearGradient>
        <radialGradient id="civic-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={SUN} stopOpacity="0.55" />
          <stop offset="1" stopColor={SUN} stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect x="-200" width="1040" height="1000" fill="url(#civic-dawn)" />
      <rect
        x="-200"
        width="1040"
        height="1000"
        fill="url(#civic-day)"
        style={{ opacity: risen ? progress * 0.85 : 0, transition: `opacity 1400ms ${EASE}` }}
      />

      <g
        style={{
          transform: `translateY(${sunDrop}px)`,
          opacity: gloom ? 0.45 : 1,
          transition: `transform 1400ms ${EASE}, opacity 900ms ease`,
        }}
      >
        <circle cx="320" cy="330" r="230" fill="url(#civic-glow)" />
        <g
          style={{
            transformOrigin: '320px 330px',
            transform: risen ? 'rotate(0deg) scale(1)' : 'rotate(-20deg) scale(0.6)',
            opacity: risen ? 0.6 : 0,
            transition: `transform 1800ms ${EASE} 200ms, opacity 1400ms ease 200ms`,
          }}
        >
          <Rays />
        </g>
        <circle cx="320" cy="330" r="74" fill={SUN} />
      </g>

      <path
        d="M-200 680 C -80 660 0 690 90 670 C 170 655 250 668 330 660 C 420 650 500 668 580 655 C 660 645 740 662 840 650 L840 1000 L-200 1000 Z"
        fill="#16305a"
      />

      <g>
        {/* Flagpole and flag above the pediment. */}
        <rect x="318" y="372" width="3" height="70" fill={NAVY} />
        <g transform="translate(321 374)">
          <rect width="40" height="10" fill="#0038a8" />
          <rect y="10" width="40" height="10" fill="#ce1126" />
          <path d="M0 0 L17 10 L0 20 Z" fill="#fff" />
          <circle cx="6" cy="10" r="2.4" fill="#fcd116" />
        </g>
        <path d="M140 500 L320 438 L500 500 Z" fill={NAVY} />
        <path d="M188 492 L320 452 L452 492 Z" fill="#1a3566" />
        <rect x="132" y="500" width="376" height="22" fill={NAVY} />
        <rect x="150" y="522" width="340" height="122" fill="#12284c" />
        {Array.from({ length: WINDOWS }, (_, index) => (
          <rect
            key={index}
            x={176 + index * 62}
            y="548"
            width="26"
            height="72"
            rx="13"
            fill={index < lit ? '#f6d27a' : '#1d3a68'}
            style={{ transition: `fill 600ms ease ${index * 140}ms` }}
          />
        ))}
        {Array.from({ length: 6 }, (_, index) => (
          <g key={index}>
            <rect x={151 + index * 62} y="522" width="18" height="122" fill="#d9e2ef" />
            <rect x={148 + index * 62} y="522" width="24" height="7" fill="#e8eef7" />
            <rect x={148 + index * 62} y="637" width="24" height="7" fill="#e8eef7" />
          </g>
        ))}
        <rect x="128" y="644" width="384" height="18" fill="#e8eef7" />
        <rect x="112" y="662" width="416" height="14" fill="#cfd8e6" />
        <rect x="96" y="676" width="448" height="14" fill="#b9c5d8" />
        <rect x="80" y="690" width="480" height="14" fill="#a3b2c9" />
      </g>

      <path d="M-200 704 L840 704 L840 1000 L-200 1000 Z" fill="#0b1a33" />
      <Tree x={-70} scale={0.9} />
      <Tree x={40} scale={1.15} />
      <Tree x={600} scale={1.05} />
      <Tree x={710} scale={0.85} />
      <rect
        x="-200"
        width="1040"
        height="1000"
        fill="#3b4558"
        style={{ opacity: gloom ? 0.5 : 0, transition: 'opacity 900ms ease' }}
      />
    </svg>
  );
}

/** LingkodHR's own letterhead, for screens no Agency speaks on: sign-in and password reset. */
function LingkodLetterhead() {
  return (
    <>
      <header className="flex items-center gap-3.5">
        <svg viewBox="0 0 64 64" className="size-11 shrink-0" aria-hidden="true">
          <circle cx="32" cy="32" r="30" fill="none" stroke={SEAL_GOLD} strokeWidth="2" />
          <circle
            cx="32"
            cy="32"
            r="25"
            fill="none"
            stroke={SEAL_GOLD}
            strokeWidth="1"
            strokeDasharray="2 2.5"
          />
          <text x="32" y="39" textAnchor="middle" fontSize="20" fontWeight="700" fill={NAVY}>
            L
          </text>
        </svg>
        <div className="grid gap-0.5">
          <p className="m-0 text-small text-ink">LingkodHR</p>
          <p className="m-0 text-[1.0625rem] leading-snug font-[650] text-nav">
            Personnel records for government agencies
          </p>
        </div>
      </header>
      <div
        aria-hidden="true"
        className="mt-5 mb-7 h-[6px] border-t-2 border-b"
        style={{ borderColor: SEAL_GOLD }}
      />
    </>
  );
}

/**
 * Split screen with the scene beside a letterhead column. `progress` runs from 0 at the first
 * step to 1 once the User is in; `gloom` overcasts it when the flow ends in a refusal.
 * `labelledBy` must match the id of the heading in `children`.
 */
export function CivicSunriseLayout({
  progress,
  gloom = false,
  labelledBy,
  children,
}: {
  progress: number;
  gloom?: boolean;
  labelledBy: string;
  children: ReactNode;
}) {
  return (
    <main className="grid min-h-dvh bg-surface text-ink min-[960px]:grid-cols-[minmax(0,1.1fr)_minmax(460px,1fr)]">
      <div className="grid grid-rows-[minmax(0,1fr)_auto] bg-[#0b1a33] min-[960px]:sticky min-[960px]:top-0 min-[960px]:h-dvh">
        <div className="relative h-60 overflow-hidden bg-nav min-[960px]:h-auto">
          <CivicScene progress={progress} gloom={gloom} />
          <div className="absolute inset-x-0 top-0 flex items-center gap-2.5 p-6 text-nav-ink min-[960px]:p-10">
            <span className="grid size-8 place-items-center rounded-control bg-white/15 text-small font-bold">
              L
            </span>
            <span className="text-small font-[650]">LingkodHR</span>
          </div>
        </div>
        {/* The caption sits on the scene's ground colour, below the art, so it never covers the building. */}
        <div className="lh-caption hidden gap-2 px-10 pt-2 pb-12 text-white min-[960px]:grid">
          <p className="m-0 max-w-[18ch] text-[2.5rem] leading-[1.05] font-[700] tracking-[-0.025em] [text-wrap:balance]">
            Para sa mga lingkod-bayan
          </p>
          <p className="m-0 max-w-[46ch] text-body text-nav-ink/80">
            Your service record, leave, and payroll, kept by your agency from appointment to
            retirement.
          </p>
        </div>
      </div>

      <div className="grid place-items-center px-6 py-10 min-[621px]:px-14">
        <section aria-labelledby={labelledBy} className="grid w-full max-w-[440px]">
          <LingkodLetterhead />
          {children}
        </section>
      </div>
    </main>
  );
}

/** "Step n of m: …" under the form, with an optional `note` such as when the step expires. */
export function StepFooter({
  step,
  of,
  label,
  note,
}: {
  step: number;
  of: number;
  label: string;
  note?: string;
}) {
  return (
    <footer className="mt-8 flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-border-subtle pt-3 text-caption text-ink-muted print:hidden">
      <span>
        Step {step} of {of}: {label}
      </span>
      {note ? <span>{note}</span> : null}
    </footer>
  );
}

/** Under the primary action; shows a moving bar only while a request is in flight. */
export function BusyBar({ busy }: { busy: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="absolute -bottom-2.5 left-0 h-0.5 w-full overflow-hidden rounded-full"
    >
      {busy ? <span className="lh-busy block h-full w-2/5 bg-primary" /> : null}
    </span>
  );
}
