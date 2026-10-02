'use client';

// PROTOTYPE (#398). Variant D: the promenade at Luneta before dawn, lamps running toward the Rizal
// Monument. One more pair of lamps lights per step, near to far; when the user is in, dawn
// breaks over the bay. Lockouts and expired links put the lamps out. Throwaway; do not import.

import { LetterheadContent } from './letterhead-variant';
import type { VariantProps } from './public-variants';
import {
  NAVY,
  SUN,
  captionOf,
  gloomOf,
  LingkodMark,
  progressOf,
  useArrived,
} from './sunrise-variant';

const VP = { x: 1060, y: 560 };
const LAMPS = 7;
const STARS = Array.from({ length: 70 }, (_, i) => ({
  x: (i * 617) % 1600,
  y: (i * 283) % 480,
  r: i % 5 ? 1 : 1.8,
}));

/** Lamp `k` (0 nearest) on the side whose nearest lamp stands at `nearX`. */
function lamp(k: number, nearX: number) {
  const s = 1 / (1 + k * 0.6);
  return { x: VP.x + (nearX - VP.x) * s, y: VP.y + (1000 - VP.y) * s, s };
}

function LunetaScene({
  progress,
  done,
  gloom,
}: {
  progress: number;
  done: boolean;
  gloom: boolean;
}) {
  const arrived = useArrived();
  // The nearest two pairs are lit on the first screen; the path to the monument lights step by step.
  const lit = gloom || !arrived ? 0 : Math.round(2 + progress * (LAMPS - 2));

  return (
    <svg
      viewBox="0 0 1600 1000"
      preserveAspectRatio="xMidYMax slice"
      className="lh-scene absolute inset-0 size-full"
      role="img"
      aria-label="Lamps along the Luneta promenade toward the Rizal Monument"
    >
      <defs>
        <linearGradient id="ln-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0b1a33" />
          <stop offset="0.45" stopColor={NAVY} />
          <stop offset="0.56" stopColor="#1d3d73" />
        </linearGradient>
        <radialGradient id="ln-dawn" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={SUN} stopOpacity="0.85" />
          <stop offset="0.5" stopColor="#e2a650" stopOpacity="0.25" />
          <stop offset="1" stopColor="#e2a650" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="ln-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={SUN} stopOpacity="0.7" />
          <stop offset="1" stopColor={SUN} stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="1600" height="1000" fill="url(#ln-sky)" />
      <g fill="#d6e4ff">
        {STARS.map(({ x, y, r }) => (
          <circle
            key={`${x}:${y}`}
            cx={x}
            cy={y}
            r={r}
            style={{ opacity: done ? 0 : 0.5, transition: 'opacity 1600ms ease' }}
          />
        ))}
      </g>
      <ellipse
        cx={VP.x}
        cy={VP.y}
        rx="900"
        ry="300"
        fill="url(#ln-dawn)"
        style={{ opacity: done ? 1 : 0, transition: 'opacity 1800ms ease' }}
      />

      {/* The bay, then the park lawn and the promenade converging on the monument. */}
      <rect y={VP.y} width="1600" height="440" fill="#0d1f3b" />
      <path d={`M0 ${VP.y + 10} L1600 ${VP.y + 10} L1600 1000 L0 1000 Z`} fill="#0b1a33" />
      <path
        d={`M${VP.x - 8} ${VP.y + 10} L${VP.x + 8} ${VP.y + 10} L1600 1000 L520 1000 Z`}
        fill="#132a4d"
      />

      {/* The Rizal Monument: pedestal, figure, obelisk. */}
      <g fill="#081426">
        <rect x={VP.x - 22} y={VP.y - 8} width="44" height="20" />
        <rect x={VP.x - 14} y={VP.y - 30} width="28" height="24" />
        <path
          d={`M${VP.x - 6} ${VP.y - 30} L${VP.x - 3} ${VP.y - 118} L${VP.x + 3} ${VP.y - 118} L${VP.x + 6} ${VP.y - 30} Z`}
        />
        <path
          d={`M${VP.x - 3} ${VP.y - 118} L${VP.x} ${VP.y - 126} L${VP.x + 3} ${VP.y - 118} Z`}
        />
      </g>

      {[600, 1560].map((nearX) =>
        Array.from({ length: LAMPS }, (_, k) => {
          const { x, y, s } = lamp(k, nearX);
          const on = k < lit;
          const top = y - 320 * s;
          return (
            <g key={`${nearX}:${k}`}>
              <circle
                cx={x}
                cy={top}
                r={110 * s}
                fill="url(#ln-glow)"
                style={{ opacity: on ? 1 : 0, transition: `opacity 700ms ease ${k * 160}ms` }}
              />
              <rect x={x - 4 * s} y={top} width={8 * s} height={320 * s} fill="#081426" />
              <rect x={x - 22 * s} y={top - 2 * s} width={44 * s} height={5 * s} fill="#081426" />
              {[-18, 18].map((dx) => (
                <circle
                  key={dx}
                  cx={x + dx * s}
                  cy={top - 14 * s}
                  r={12 * s}
                  fill={on ? '#ffe7a3' : '#2a3d5c'}
                  style={{ transition: `fill 700ms ease ${k * 160}ms` }}
                />
              ))}
            </g>
          );
        }),
      )}
    </svg>
  );
}

export function Luneta(props: VariantProps) {
  const caption = captionOf(props);

  return (
    <main className="relative min-h-dvh text-ink">
      <div className="fixed inset-0 overflow-hidden bg-[#0b1a33]">
        <LunetaScene
          progress={progressOf(props)}
          done={props.view.outcome?.tone === 'success'}
          gloom={gloomOf(props)}
        />
      </div>

      <LingkodMark className="absolute top-0 left-0 z-10 flex items-center gap-2.5 p-6 text-nav-ink min-[960px]:p-8" />
      <div className="relative grid min-h-dvh min-[960px]:grid-cols-[minmax(460px,540px)_minmax(0,1fr)]">
        <div className="grid content-start gap-6 px-4 pt-6 pb-24 min-[960px]:content-center min-[960px]:px-8 min-[960px]:py-8">
          <section
            aria-labelledby="proto-title"
            className="mt-[22vh] grid gap-0 rounded-panel bg-surface px-6 py-8 min-[621px]:px-10 min-[621px]:py-10 min-[960px]:mt-0"
          >
            <LetterheadContent key={props.stateKey} {...props} align="start" />
          </section>
        </div>

        <div className="lh-caption hidden content-start justify-items-end gap-2 p-10 pt-40 text-right text-white min-[960px]:grid">
          <p className="m-0 max-w-[16ch] text-[2.5rem] leading-[1.05] font-[700] tracking-[-0.025em] [text-wrap:balance]">
            {caption.title}
          </p>
          <p className="m-0 max-w-[40ch] text-body text-nav-ink/80">{caption.body}</p>
        </div>
      </div>
    </main>
  );
}
