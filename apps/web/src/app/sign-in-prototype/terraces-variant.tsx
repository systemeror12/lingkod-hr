'use client';

// PROTOTYPE (#398). Variant B: the form floats on a full-bleed morning over the rice terraces.
// Water flows down one terrace per step, so the hillside fills as the user gets closer to their
// workspace; lockouts and expired links roll the mist in. Throwaway; do not import.

import { LetterheadContent } from './letterhead-variant';
import type { VariantProps } from './public-variants';
import { captionOf, gloomOf, LingkodMark, progressOf, useArrived } from './sunrise-variant';

const TERRACES = 9;
const FIELD = ['#4f7d43', '#5f8b4b', '#46733d', '#6c9752', '#3d6837', '#55833f', '#365e31'];

/** Height of terrace edge `k` at `x`: wavy contours, spaced wider toward the viewer. */
function contourY(k: number, x: number) {
  const base = 430 + 600 * (k / TERRACES) ** 1.5;
  const amp = 16 + k * 7;
  return base + amp * (0.65 * Math.sin(x * 0.0042 + k * 0.9) + 0.3 * Math.sin(x * 0.011 + k * 2.3));
}

function contour(k: number) {
  const points = [];
  for (let x = -40; x <= 1640; x += 40) points.push(`${x} ${contourY(k, x).toFixed(1)}`);
  return points;
}

const edges = Array.from({ length: TERRACES + 1 }, (_, k) => contour(k));

function TerraceScene({ progress, gloom }: { progress: number; gloom: boolean }) {
  const arrived = useArrived();
  // Two terraces already hold water on the first screen; the rest fill one per step.
  const watered = arrived ? Math.round(2 + progress * (TERRACES - 2)) : 0;

  return (
    <svg
      viewBox="0 0 1600 1000"
      preserveAspectRatio="xMidYMax slice"
      className="lh-scene absolute inset-0 size-full"
      role="img"
      aria-label="Rice terraces in the morning mist"
    >
      <defs>
        <linearGradient id="tr-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a9c6c8" />
          <stop offset="0.5" stopColor="#dfe6d8" />
          <stop offset="0.75" stopColor="#f3e3bd" />
        </linearGradient>
        <radialGradient id="tr-sun" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff6dc" stopOpacity="0.95" />
          <stop offset="0.25" stopColor="#fbe8b4" stopOpacity="0.6" />
          <stop offset="1" stopColor="#fbe8b4" stopOpacity="0" />
        </radialGradient>
        <filter id="tr-blur" x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation="28" />
        </filter>
      </defs>

      <rect width="1600" height="1000" fill="url(#tr-sky)" />
      <circle cx="420" cy="250" r="260" fill="url(#tr-sun)" />

      <path
        d="M-40 470 C 120 360 240 330 380 380 C 500 420 600 300 760 290 C 900 282 1000 380 1140 350 C 1280 320 1420 240 1640 300 L1640 560 L-40 560 Z"
        fill="#8faaa0"
      />
      <path
        d="M-40 520 C 160 430 300 450 460 470 C 640 492 760 400 940 410 C 1120 420 1260 470 1640 400 L1640 600 L-40 600 Z"
        fill="#6f8f82"
      />

      {edges.slice(0, TERRACES).map((top, k) => {
        const bottom = [...edges[k + 1]!].reverse();
        return (
          <g key={k}>
            <path d={`M${top.join(' L')} L${bottom.join(' L')} Z`} fill={FIELD[k % FIELD.length]} />
            <path
              d={`M${top.join(' L')}`}
              fill="none"
              stroke="#2c4a28"
              strokeWidth={2 + k * 0.5}
              transform={`translate(0 ${3 + k})`}
            />
            {/* The water line: drawn left to right, one terrace after the other, like a flood. */}
            <path
              d={`M${top.join(' L')}`}
              pathLength={1}
              fill="none"
              stroke="#e4efe9"
              strokeWidth={3 + k * 0.9}
              strokeLinecap="round"
              strokeDasharray="1 1"
              style={{
                strokeDashoffset: k < watered ? 0 : 1,
                transition: `stroke-dashoffset 1100ms cubic-bezier(.4,0,.2,1) ${k * 160}ms`,
              }}
            />
          </g>
        );
      })}

      {/* An Ifugao house on stilts, on the third terrace. */}
      <g transform={`translate(1090 ${contourY(3, 1090) + 6})`} fill="#2b2016">
        <rect x="-26" y="-34" width="4" height="34" />
        <rect x="22" y="-34" width="4" height="34" />
        <rect x="-30" y="-58" width="60" height="24" />
        <path d="M-50 -56 L0 -118 L50 -56 Z" fill="#6b5132" />
        <path d="M-50 -56 L0 -118 L0 -56 Z" fill="#5a4329" />
      </g>

      <g
        filter="url(#tr-blur)"
        fill="#ffffff"
        style={{
          opacity: gloom ? 0.95 : arrived ? 0.55 : 0.85,
          transform: arrived ? 'none' : 'translateX(-60px)',
          transition: 'opacity 1600ms ease, transform 2400ms cubic-bezier(.2,.7,.2,1)',
        }}
      >
        <ellipse cx="380" cy="560" rx="520" ry="60" />
        <ellipse cx="1200" cy="520" rx="480" ry="50" />
        <ellipse cx="800" cy={gloom ? 760 : 640} rx="700" ry={gloom ? 220 : 40} />
      </g>
      <rect
        width="1600"
        height="1000"
        fill="#7d8b88"
        style={{ opacity: gloom ? 0.45 : 0, transition: 'opacity 900ms ease' }}
      />
    </svg>
  );
}

export function Terraces(props: VariantProps) {
  const caption = captionOf(props);

  return (
    <main className="relative min-h-dvh text-ink">
      <div className="fixed inset-0 overflow-hidden bg-[#dfe6d8]">
        <TerraceScene progress={progressOf(props)} gloom={gloomOf(props)} />
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#12200f]/70 to-transparent" />
      </div>

      <div className="relative grid min-h-dvh min-[960px]:grid-cols-[minmax(0,1fr)_minmax(460px,540px)]">
        <div className="grid content-between p-6 min-[960px]:p-10">
          <LingkodMark className="flex items-center gap-2.5 text-[#1f3320]" />
          <div className="lh-caption hidden gap-2 pb-16 text-white min-[960px]:grid">
            <p className="m-0 max-w-[16ch] text-[2.75rem] leading-[1.04] font-[700] tracking-[-0.025em] [text-wrap:balance]">
              {caption.title}
            </p>
            <p className="m-0 max-w-[44ch] text-body text-white/85">{caption.body}</p>
          </div>
        </div>

        <div className="grid items-center px-4 pt-[30vh] pb-24 min-[960px]:px-8 min-[960px]:py-8">
          <section
            aria-labelledby="proto-title"
            className="grid gap-0 rounded-panel bg-surface px-6 py-8 shadow-[0_30px_80px_-24px_rgb(18_32_15/55%)] min-[621px]:px-10 min-[621px]:py-10"
          >
            <LetterheadContent key={props.stateKey} {...props} align="start" />
          </section>
        </div>
      </div>
    </main>
  );
}
