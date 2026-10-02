'use client';

// PROTOTYPE (#398). Variant C: the form sits in the opening of a bahay na bato window, between
// two sliding capiz sashes. Light comes through the shells one row per step, bottom up; when the
// user is in, the sashes slide open. Lockouts and expired links dim the shells. Throwaway.

import { LetterheadContent } from './letterhead-variant';
import type { VariantProps } from './public-variants';
import { captionOf, gloomOf, LingkodMark, progressOf, useArrived } from './sunrise-variant';

const PANE = 34;
const BAR = 4;
const SHELLS = ['#f3ece0', '#efe9e4', '#f4e8d8', '#ece8e2', '#f1e6dc'];

/** A capiz sash: a narra frame around a lattice of shell panes. `lit` counts rows from the bottom. */
function Sash({ cols, rows, lit, dim }: { cols: number; rows: number; lit: number; dim: boolean }) {
  const width = cols * (PANE + BAR) + BAR;
  const height = rows * (PANE + BAR) + BAR;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid slice"
      className="lh-scene size-full"
      aria-hidden="true"
    >
      <defs>
        {/* Capiz is translucent: brighter at the centre of each shell, like mother-of-pearl. */}
        <radialGradient id="cz-pearl" cx="0.4" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#fff" stopOpacity="0.7" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={width} height={height} fill="#4a2e1b" />
      {Array.from({ length: rows }, (_, row) =>
        Array.from({ length: cols }, (_, col) => {
          const fromBottom = rows - 1 - row;
          const on = fromBottom < lit;
          return (
            <g
              key={`${row}:${col}`}
              transform={`translate(${BAR + col * (PANE + BAR)} ${BAR + row * (PANE + BAR)})`}
            >
              <rect width={PANE} height={PANE} fill={SHELLS[(row * 7 + col * 3) % SHELLS.length]} />
              <rect width={PANE} height={PANE} fill="url(#cz-pearl)" />
              <rect
                width={PANE}
                height={PANE}
                fill="#ffcf6e"
                style={{
                  opacity: on ? 0.55 : 0,
                  transition: `opacity 700ms ease ${fromBottom * 45}ms`,
                }}
              />
              <rect
                width={PANE}
                height={PANE}
                fill="#2a170b"
                style={{ opacity: dim ? 0.55 : on ? 0 : 0.14, transition: 'opacity 900ms ease' }}
              />
            </g>
          );
        }),
      )}
    </svg>
  );
}

export function Capiz(props: VariantProps) {
  const arrived = useArrived();
  const progress = progressOf(props);
  const gloom = gloomOf(props);
  const open = props.view.outcome?.tone === 'success';
  const rows = 24;
  // A third of the panes glow on the first screen; the rest light one band per step.
  const lit = gloom || !arrived ? 0 : Math.round((0.34 + 0.66 * progress) * rows);
  const caption = captionOf(props);
  const slide = 'transform 1200ms cubic-bezier(.2,.7,.2,1)';

  return (
    <main className="relative min-h-dvh bg-[#3a2416] bg-[repeating-linear-gradient(90deg,rgb(0_0_0/0%)_0_38px,rgb(0_0_0/12%)_38px_40px,rgb(255_255_255/3%)_40px_90px)] text-ink">
      <div className="h-24 overflow-hidden min-[960px]:hidden">
        <Sash cols={30} rows={3} lit={lit ? 3 : 0} dim={gloom} />
      </div>

      <div className="grid min-h-dvh min-[960px]:grid-cols-[minmax(0,1fr)_minmax(460px,560px)_minmax(0,1fr)]">
        <div
          aria-hidden="true"
          className="relative hidden overflow-hidden border-r-[14px] border-[#2a170b] bg-[radial-gradient(ellipse_at_right,#ffe2a1,#f3b94f_40%,#3a2416_80%)] min-[960px]:block"
        >
          <div
            className="absolute inset-0"
            style={{ transform: open ? 'translateX(-62%)' : 'none', transition: slide }}
          >
            <Sash cols={8} rows={rows} lit={lit} dim={gloom} />
          </div>
        </div>

        <div className="grid content-center gap-6 px-4 py-10 min-[621px]:px-8">
          <LingkodMark className="flex items-center gap-2.5 text-[#f3dfc0]" />
          <div className="lh-caption grid gap-2 text-[#fbf1df]">
            <p className="m-0 text-[2.25rem] leading-[1.06] font-[700] tracking-[-0.02em] [text-wrap:balance]">
              {caption.title}
            </p>
            <p className="m-0 max-w-[48ch] text-small text-[#e9d6b8]">{caption.body}</p>
          </div>
          <section
            aria-labelledby="proto-title"
            className="grid gap-0 rounded-panel border-b-[10px] border-[#2a170b] bg-surface px-6 pt-8 pb-7 min-[621px]:px-10"
          >
            <LetterheadContent key={props.stateKey} {...props} align="start" />
          </section>
        </div>

        <div
          aria-hidden="true"
          className="relative hidden overflow-hidden border-l-[14px] border-[#2a170b] bg-[radial-gradient(ellipse_at_left,#ffe2a1,#f3b94f_40%,#3a2416_80%)] min-[960px]:block"
        >
          <div
            className="absolute inset-0"
            style={{ transform: open ? 'translateX(62%)' : 'none', transition: slide }}
          >
            <Sash cols={8} rows={rows} lit={lit} dim={gloom} />
          </div>
        </div>
      </div>
    </main>
  );
}
