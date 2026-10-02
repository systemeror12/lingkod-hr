'use client';

// PROTOTYPE (#398). Variant D: the form lies like a document on a woven banig mat. The dyed weave
// advances down the mat one band per step, so the pattern completes as the user does; lockouts
// and expired links fade the dye. Throwaway; do not import.

import { LetterheadContent } from './letterhead-variant';
import type { VariantProps } from './public-variants';
import { captionOf, gloomOf, LingkodMark, progressOf, useArrived } from './sunrise-variant';

const CELL = 28;
const TILE = 12;
const DYED = ['#9b2f35', '#d9a441', '#2f6b4f', '#5b3a78', '#e7d3a2', '#c4552f'];
const PANDAN = ['#d7c79c', '#cbb98a', '#e0d3ad', '#c2ae7c', '#d2c194', '#c8b483'];

/** Concentric diamonds, the commonest Basey banig motif, as a palette index per cell. */
function motif(i: number, j: number) {
  const d = Math.abs(i - TILE / 2 + 0.5) + Math.abs(j - TILE / 2 + 0.5);
  return Math.floor(d) % DYED.length;
}

function Tile({ id, palette }: { id: string; palette: string[] }) {
  return (
    <pattern
      id={id}
      width={CELL * TILE}
      height={CELL * TILE}
      patternUnits="userSpaceOnUse"
      patternTransform="rotate(45)"
    >
      {Array.from({ length: TILE }, (_, i) =>
        Array.from({ length: TILE }, (_, j) => (
          <rect
            key={`${i}:${j}`}
            x={i * CELL}
            y={j * CELL}
            width={CELL}
            height={CELL}
            fill={palette[motif(i, j)]}
          />
        )),
      )}
    </pattern>
  );
}

function BanigScene({ progress, gloom }: { progress: number; gloom: boolean }) {
  const arrived = useArrived();
  // The weave starts under the header band, reaches mid-mat on the first screen, and covers the
  // whole mat when the user is in. `edge` is where dyed strands give way to raw pandan.
  const edge = arrived ? 520 + 600 * progress : 0;

  return (
    <svg
      viewBox="0 0 1600 1000"
      preserveAspectRatio="xMidYMin slice"
      className="lh-scene absolute inset-0 size-full"
      aria-hidden="true"
    >
      <defs>
        <Tile id="bn-dyed" palette={DYED} />
        <Tile id="bn-raw" palette={PANDAN} />
        {/* Over-under shading: every other strip sits slightly lower, so the cells read as woven. */}
        <pattern
          id="bn-weave"
          width={CELL * 2}
          height={CELL * 2}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width={CELL} height={CELL} fill="#000" opacity="0.13" />
          <rect x={CELL} y={CELL} width={CELL} height={CELL} fill="#000" opacity="0.13" />
          <path
            d={`M0 0 H${CELL * 2} M0 ${CELL} H${CELL * 2}`}
            stroke="#fff"
            strokeOpacity="0.12"
            strokeWidth="1.5"
          />
        </pattern>
        <linearGradient id="bn-edge" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.46" stopColor="#fff" />
          <stop offset="0.54" stopColor="#000" />
        </linearGradient>
        <mask id="bn-progress" maskUnits="userSpaceOnUse" x="0" y="0" width="1600" height="1000">
          <rect
            x="0"
            y="-1100"
            width="1600"
            height="2200"
            fill="url(#bn-edge)"
            style={{
              transform: `translateY(${edge}px)`,
              transition: 'transform 1600ms cubic-bezier(.3,.6,.2,1)',
            }}
          />
        </mask>
      </defs>

      <rect width="1600" height="1000" fill="url(#bn-raw)" />
      <g
        mask="url(#bn-progress)"
        style={{
          filter: gloom ? 'saturate(0.2) brightness(0.8)' : 'none',
          transition: 'filter 900ms ease',
        }}
      >
        <rect width="1600" height="1000" fill="url(#bn-dyed)" />
      </g>
      <rect width="1600" height="1000" fill="url(#bn-weave)" />
    </svg>
  );
}

export function Banig(props: VariantProps) {
  const caption = captionOf(props);

  return (
    <main className="relative min-h-dvh text-ink">
      <div className="fixed inset-0 overflow-hidden bg-[#d7c79c]">
        <BanigScene progress={progressOf(props)} gloom={gloomOf(props)} />
      </div>

      {/* The mat's solid border band, where a weaver would put a name. */}
      <header className="relative grid gap-3 border-b-4 border-[#d9a441] bg-[#7d2329] px-6 pt-6 pb-24 text-[#fbeee0] min-[621px]:px-10">
        <LingkodMark className="flex items-center gap-2.5" />
        <div className="lh-caption mx-auto grid w-full max-w-[560px] gap-1.5">
          <p className="m-0 text-[2.25rem] leading-[1.06] font-[700] tracking-[-0.02em] [text-wrap:balance]">
            {caption.title}
          </p>
          <p className="m-0 max-w-[50ch] text-small text-[#f1d6c4]">{caption.body}</p>
        </div>
      </header>

      <div className="relative -mt-16 grid justify-items-center px-4 pb-28">
        <section
          aria-labelledby="proto-title"
          className="grid w-full max-w-[560px] gap-0 rounded-panel bg-surface px-6 pt-8 pb-7 shadow-[0_28px_60px_-28px_rgb(60_25_10/70%)] min-[621px]:px-12"
        >
          <LetterheadContent key={props.stateKey} {...props} align="start" />
        </section>
      </div>
    </main>
  );
}
