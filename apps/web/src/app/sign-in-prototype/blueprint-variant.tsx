'use client';

// PROTOTYPE (#398). Variant C: a front elevation of a domed government building, drafted on a
// navy blueprint. One more part of the building is drawn per step, base to flag; when the user
// is in, the linework turns gold. The welcome sits in the drawing's title block. Throwaway.

import { LetterheadContent } from './letterhead-variant';
import type { VariantProps } from './public-variants';
import { SUN, captionOf, gloomOf, LingkodMark, progressOf, useArrived } from './sunrise-variant';

const rect = (x: number, y: number, w: number, h: number) => `M${x} ${y} h${w} v${h} h${-w} Z `;

/** The elevation, bottom up. Each entry is drawn as one stroke. */
const PARTS = [
  // Steps.
  rect(250, 806, 620, 16) + rect(270, 790, 580, 16) + rect(290, 774, 540, 16),
  // Podium and colonnade.
  rect(300, 600, 520, 174) +
    Array.from({ length: 8 }, (_, i) => rect(326 + i * 64, 622, 20, 152)).join('') +
    Array.from({ length: 7 }, (_, i) => rect(361 + i * 64, 660, 22, 70)).join(''),
  // Entablature and pediment.
  rect(280, 570, 560, 30) + 'M390 570 L560 506 L730 570 Z M430 562 L560 518 L690 562',
  // Drum and dome, with ribs.
  rect(470, 430, 180, 76) +
    'M470 430 A 90 96 0 0 1 650 430 M515 430 Q 525 360 560 334 M605 430 Q 595 360 560 334 M560 334 V430 ' +
    Array.from({ length: 5 }, (_, i) => rect(482 + i * 34, 448, 16, 40)).join(''),
  // Lantern and flag.
  rect(546, 300, 28, 34) + 'M560 300 V230 M560 230 h44 v26 h-44',
];

function BlueprintScene({
  progress,
  done,
  gloom,
}: {
  progress: number;
  done: boolean;
  gloom: boolean;
}) {
  const arrived = useArrived();
  // Base and colonnade on the first screen; the flag goes up when the user is in.
  const drawn = arrived ? Math.round(2 + progress * (PARTS.length - 2)) : 0;
  const ink = done ? SUN : '#d6e4ff';

  return (
    <svg
      viewBox="0 0 1600 1000"
      preserveAspectRatio="xMidYMid slice"
      className="lh-scene absolute inset-0 size-full"
      role="img"
      aria-label="A blueprint of a domed government building"
    >
      <defs>
        <pattern id="bp-minor" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0 H0 V20" fill="none" stroke="#9fc0ff" strokeOpacity="0.08" />
        </pattern>
        <pattern id="bp-major" width="100" height="100" patternUnits="userSpaceOnUse">
          <rect width="100" height="100" fill="url(#bp-minor)" />
          <path d="M100 0 H0 V100" fill="none" stroke="#9fc0ff" strokeOpacity="0.16" />
        </pattern>
      </defs>
      <rect width="1600" height="1000" fill="#12305a" />
      <rect width="1600" height="1000" fill="url(#bp-major)" />

      <g transform="translate(600 822) scale(0.82) translate(-560 -822)">
        {/* Ground line and overall dimension, always present like a sheet's frame. */}
        <g stroke="#9fc0ff" strokeOpacity="0.45" fill="none">
          <path d="M160 822 H960" />
          <path d="M250 870 H870 M250 860 V880 M870 860 V880" />
        </g>
        <text x="560" y="895" textAnchor="middle" fontSize="14" fill="#9fc0ff" fillOpacity="0.7">
          62.00 m
        </text>

        <g
          fill="none"
          strokeWidth="2"
          strokeLinejoin="round"
          style={{ opacity: gloom ? 0.3 : 1, transition: 'opacity 900ms ease' }}
        >
          {PARTS.map((d, index) => (
            <path
              key={index}
              d={d}
              pathLength={1}
              stroke={ink}
              strokeDasharray="1 1"
              style={{
                strokeDashoffset: index < drawn ? 0 : 1,
                transition: `stroke-dashoffset 1400ms cubic-bezier(.4,0,.2,1) ${index * 220}ms, stroke 900ms ease`,
              }}
            />
          ))}
          <path
            d="M560 230 h44 v26 h-44 Z"
            stroke="none"
            fill={SUN}
            style={{ opacity: done ? 1 : 0, transition: 'opacity 700ms ease 900ms' }}
          />
        </g>
      </g>
    </svg>
  );
}

export function Blueprint(props: VariantProps) {
  const caption = captionOf(props);

  return (
    <main className="relative min-h-dvh text-ink">
      <div className="fixed inset-0 overflow-hidden bg-[#12305a]">
        <BlueprintScene
          progress={progressOf(props)}
          done={props.view.outcome?.tone === 'success'}
          gloom={gloomOf(props)}
        />
      </div>

      <div className="relative grid min-h-dvh min-[960px]:grid-cols-[minmax(0,1fr)_minmax(460px,540px)]">
        <div className="grid content-start gap-8 p-6 min-[960px]:p-10">
          <LingkodMark className="flex items-center gap-2.5 text-nav-ink" />
          {/* The title block of the drawing. */}
          <div className="lh-caption hidden w-fit max-w-[30rem] grid-cols-[1fr] border border-[#9fc0ff]/50 text-white min-[960px]:grid">
            <p className="m-0 border-b border-[#9fc0ff]/50 px-5 py-4 text-[2.25rem] leading-[1.06] font-[700] tracking-[-0.02em] [text-wrap:balance]">
              {caption.title}
            </p>
            <p className="m-0 px-5 py-3 text-small text-[#d6e4ff]">{caption.body}</p>
          </div>
        </div>

        <div className="grid items-center px-4 pt-[30vh] pb-24 min-[960px]:px-8 min-[960px]:py-8">
          <section
            aria-labelledby="proto-title"
            className="grid gap-0 rounded-panel bg-surface px-6 py-8 min-[621px]:px-10 min-[621px]:py-10"
          >
            <LetterheadContent key={props.stateKey} {...props} align="start" />
          </section>
        </div>
      </div>
    </main>
  );
}
