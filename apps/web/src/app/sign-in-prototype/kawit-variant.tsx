'use client';

// PROTOTYPE (#398). Variant B: the Aguinaldo Shrine in Kawit, Cavite, where independence was
// proclaimed from the balcony on 12 June 1898. The flag climbs its pole one step at a time and
// reaches the top when the user is in; lockouts and expired links cloud the sky. Throwaway.

import { LetterheadContent } from './letterhead-variant';
import type { VariantProps } from './public-variants';
import { captionOf, gloomOf, progressOf, useArrived } from './sunrise-variant';

const IVORY = '#f1e8d6';
const WOOD = '#4a2e1c';
const ROOF = '#7a3b2a';
const POLE_X = -24;
const POLE_TOP = 250;
const POLE_FOOT = 800;

/** A sliding window: dark wood frame around a grid of pale panes. */
function Window({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={WOOD} />
      {[0, 1].map((col) =>
        [0, 1, 2].map((row) => (
          <rect
            key={`${col}:${row}`}
            x={x + 3 + col * ((w - 3) / 2)}
            y={y + 3 + row * ((h - 3) / 3)}
            width={(w - 3) / 2 - 3}
            height={(h - 3) / 3 - 3}
            fill="#e9dcc0"
          />
        )),
      )}
    </g>
  );
}

function Palm({
  x,
  y,
  lean = 1,
  scale = 1,
}: {
  x: number;
  y: number;
  lean?: number;
  scale?: number;
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${lean * scale} ${scale})`} fill="#2f5a2c">
      <path d="M-4 0 C 6 -120 18 -220 34 -300 L40 -298 C 28 -220 14 -120 6 0 Z" fill="#6b5236" />
      {[-150, -110, -60, -20, 20, 60].map((angle) => (
        <path
          key={angle}
          d="M0 0 C 30 -20 70 -16 110 12 C 70 0 34 2 0 8 Z"
          transform={`translate(37 -298) rotate(${angle})`}
        />
      ))}
    </g>
  );
}

function Flag({ y }: { y: number }) {
  return (
    <g transform={`translate(${POLE_X + 3} ${y})`}>
      <rect width="90" height="26" fill="#0038a8" />
      <rect y="26" width="90" height="26" fill="#ce1126" />
      <path d="M0 0 L45 26 L0 52 Z" fill="#fff" />
      <circle cx="14" cy="26" r="6" fill="#fcd116" />
      {[
        [5, 7],
        [5, 45],
        [37, 26],
      ].map(([cx, cy]) => (
        <circle key={`${cx}:${cy}`} cx={cx} cy={cy} r="2" fill="#fcd116" />
      ))}
    </g>
  );
}

function KawitScene({ progress, gloom }: { progress: number; gloom: boolean }) {
  const arrived = useArrived();
  // The flag starts a quarter of the way up and is at the top when the user is in.
  const height = arrived ? 0.25 + 0.75 * progress : 0;
  const flagY = POLE_FOOT - 70 - height * (POLE_FOOT - 70 - POLE_TOP);

  return (
    <svg
      viewBox="-110 110 1010 800"
      preserveAspectRatio="xMidYMid slice"
      className="lh-scene absolute inset-0 size-full"
      role="img"
      aria-label="The Aguinaldo Shrine in Kawit, Cavite, with the flag rising"
    >
      <defs>
        <linearGradient id="kw-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3f8fd0" />
          <stop offset="0.55" stopColor="#9fd0ee" />
          <stop offset="0.8" stopColor="#f4ecd6" />
        </linearGradient>
      </defs>
      <rect x="-200" width="1200" height="1000" fill="url(#kw-sky)" />
      <g fill="#fff" opacity="0.85">
        <ellipse cx="620" cy="200" rx="90" ry="22" />
        <ellipse cx="680" cy="185" rx="60" ry="24" />
        <ellipse cx="240" cy="140" rx="70" ry="16" />
      </g>

      {/* Tower: five tiers over the house, as added in 1919–1921. */}
      <g>
        <path d="M420 150 L466 220 L374 220 Z" fill={ROOF} />
        {[
          [374, 220, 92, 60],
          [364, 280, 112, 80],
          [354, 360, 132, 90],
          [344, 450, 152, 110],
        ].map(([x, y, w, h], index) => (
          <g key={index}>
            <rect x={x} y={y} width={w} height={h} fill={IVORY} />
            <rect x={x! - 6} y={y! + h! - 8} width={w! + 12} height={8} fill={WOOD} />
            <Window x={x! + w! / 2 - 14} y={y! + 12} w={28} h={h! - 32} />
          </g>
        ))}
      </g>

      {/* The house: hipped roof, wooden upper floor with sliding windows, stone ground floor. */}
      <path d="M90 560 L170 500 L670 500 L750 560 Z" fill={ROOF} />
      <rect x="110" y="560" width="620" height="130" fill={IVORY} />
      {[140, 210, 280, 500, 570, 640].map((x) => (
        <Window key={x} x={x} y={580} w={50} h={88} />
      ))}
      <rect x="110" y="690" width="620" height="110" fill="#e2d4b6" />
      {[150, 230, 570, 650].map((x) => (
        <path key={x} d={`M${x} 800 V748 a20 20 0 0 1 40 0 V800 Z`} fill={WOOD} />
      ))}

      {/* The Independence balcony, projecting over the entrance. */}
      <rect x="330" y="560" width="180" height="150" fill="#f7f0e2" />
      {[350, 400, 450].map((x) => (
        <path key={x} d={`M${x} 690 V610 a20 20 0 0 1 40 0 V690 Z`} fill={WOOD} />
      ))}
      <rect x="320" y="690" width="200" height="10" fill={WOOD} />
      {Array.from({ length: 11 }, (_, i) => (
        <rect key={i} x={326 + i * 18} y="664" width="3" height="26" fill={WOOD} />
      ))}
      <rect x="320" y="660" width="200" height="5" fill={WOOD} />
      <path d="M380 800 V740 a40 40 0 0 1 80 0 V800 Z" fill={WOOD} />

      <rect x="-200" y="800" width="1200" height="200" fill="#5f8f3e" />
      <path d="M340 1000 L380 800 L460 800 L500 1000 Z" fill="#d9c9a4" />

      <Palm x={720} y={830} lean={-1} scale={1.1} />
      <Palm x={-100} y={880} scale={0.9} />

      <rect
        x={POLE_X}
        y={POLE_TOP - 10}
        width="5"
        height={POLE_FOOT - POLE_TOP + 20}
        fill="#cfd3d6"
      />
      <circle cx={POLE_X + 2.5} cy={POLE_TOP - 12} r="6" fill="#d9b44a" />
      <g
        style={{
          transform: `translateY(${flagY}px)`,
          transition: 'transform 1400ms cubic-bezier(.3,.7,.2,1)',
        }}
      >
        <Flag y={0} />
      </g>

      <rect
        x="-200"
        width="1200"
        height="1000"
        fill="#56606b"
        style={{ opacity: gloom ? 0.5 : 0, transition: 'opacity 900ms ease' }}
      />
    </svg>
  );
}

export function Kawit(props: VariantProps) {
  const caption = captionOf(props);

  return (
    <main className="grid min-h-dvh bg-surface text-ink min-[960px]:grid-cols-[minmax(460px,1fr)_minmax(0,1fr)]">
      <div className="grid place-items-center px-6 py-10 min-[621px]:px-14">
        <section aria-labelledby="proto-title" className="grid w-full max-w-[440px] gap-0">
          <LetterheadContent key={props.stateKey} {...props} align="start" />
        </section>
      </div>

      <div className="order-first grid grid-rows-[minmax(0,1fr)_auto] bg-[#f1e8d6] min-[960px]:sticky min-[960px]:top-0 min-[960px]:order-last min-[960px]:h-dvh">
        <div className="relative h-64 overflow-hidden min-[960px]:h-auto">
          <KawitScene progress={progressOf(props)} gloom={gloomOf(props)} />
        </div>
        <div className="lh-caption hidden gap-2 border-t-4 border-[#ce1126] px-10 pt-6 pb-12 text-[#3b2616] min-[960px]:grid">
          <p className="m-0 max-w-[20ch] text-[2.25rem] leading-[1.06] font-[700] tracking-[-0.02em] [text-wrap:balance]">
            {caption.title}
          </p>
          <p className="m-0 max-w-[46ch] text-body text-[#5c4632]">{caption.body}</p>
          <p className="m-0 mt-2 text-caption text-[#7a6450]">Aguinaldo Shrine, Kawit, Cavite</p>
        </div>
      </div>
    </main>
  );
}
