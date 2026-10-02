'use client';

// PROTOTYPE (#398). Variant D: Calle Crisologo in Vigan at dusk, brick-and-wood ancestral houses
// along a stone street with a kalesa. The capiz windows light house by house, near to far, as the
// user moves through the flow; lockouts and expired links put them out. Throwaway; do not import.

import { LetterheadContent } from './letterhead-variant';
import type { VariantProps } from './public-variants';
import { captionOf, gloomOf, progressOf, useArrived } from './sunrise-variant';

const VP = { x: 1000, y: 560 };
const HOUSES = 9;
const NEAR_HEIGHT = 640;

/** Depth 1 is the picture plane; depth shrinks toward the vanishing point. */
function depth(k: number) {
  return 1 / (1 + k * 0.35);
}

function at(nearX: number, t: number) {
  return {
    x: VP.x + (nearX - VP.x) * t,
    ground: VP.y + (1000 - VP.y) * t,
    eave: VP.y - (NEAR_HEIGHT - (1000 - VP.y)) * t,
  };
}

const quad = (a: number[], b: number[], c: number[], d: number[]) =>
  `M${a.join(' ')} L${b.join(' ')} L${c.join(' ')} L${d.join(' ')} Z`;

/** One ancestral house between depths `k` and `k + 1` on the side whose near edge is `nearX`. */
function House({ k, nearX, lit }: { k: number; nearX: number; lit: boolean }) {
  const near = at(nearX, depth(k));
  const far = at(nearX, depth(k + 1));
  const split = (p: ReturnType<typeof at>) => p.ground - (p.ground - p.eave) * 0.45;
  const mix = (p: number, q: number, f: number) => p + (q - p) * f;
  const pane = (f0: number, f1: number) =>
    quad(
      [
        mix(near.x, far.x, f0),
        mix(split(near) - 8 * depth(k), split(far), f0) -
          (mix(split(near), split(far), f0) - mix(near.eave, far.eave, f0)) * 0.15,
      ],
      [
        mix(near.x, far.x, f1),
        mix(split(near) - 8 * depth(k), split(far), f1) -
          (mix(split(near), split(far), f1) - mix(near.eave, far.eave, f1)) * 0.15,
      ],
      [
        mix(near.x, far.x, f1),
        mix(near.eave, far.eave, f1) +
          (mix(split(near), split(far), f1) - mix(near.eave, far.eave, f1)) * 0.2,
      ],
      [
        mix(near.x, far.x, f0),
        mix(near.eave, far.eave, f0) +
          (mix(split(near), split(far), f0) - mix(near.eave, far.eave, f0)) * 0.2,
      ],
    );

  return (
    <g>
      <path
        d={quad(
          [near.x, near.ground],
          [far.x, far.ground],
          [far.x, split(far)],
          [near.x, split(near)],
        )}
        fill={k % 2 ? '#8f4630' : '#9c5236'}
      />
      <path
        d={quad([near.x, split(near)], [far.x, split(far)], [far.x, far.eave], [near.x, near.eave])}
        fill={k % 2 ? '#4a2e1f' : '#563624'}
      />
      <path
        d={quad(
          [near.x, near.eave],
          [far.x, far.eave],
          [far.x, far.eave - 30 * depth(k + 1)],
          [near.x, near.eave - 30 * depth(k)],
        )}
        fill="#7c2f20"
      />
      {[
        [0.18, 0.46],
        [0.56, 0.84],
      ].map(([f0, f1]) => (
        <path
          key={f0}
          d={pane(f0!, f1!)}
          fill={lit ? '#ffd27a' : '#3b2a26'}
          style={{ transition: `fill 700ms ease ${k * 150}ms` }}
        />
      ))}
      {/* The arched street door of the brick ground floor. */}
      <path
        d={quad(
          [mix(near.x, far.x, 0.35), mix(near.ground, far.ground, 0.35)],
          [mix(near.x, far.x, 0.62), mix(near.ground, far.ground, 0.62)],
          [
            mix(near.x, far.x, 0.62),
            mix(near.ground, far.ground, 0.62) -
              (mix(near.ground, far.ground, 0.62) - mix(split(near), split(far), 0.62)) * 0.7,
          ],
          [
            mix(near.x, far.x, 0.35),
            mix(near.ground, far.ground, 0.35) -
              (mix(near.ground, far.ground, 0.35) - mix(split(near), split(far), 0.35)) * 0.7,
          ],
        )}
        fill="#2e1d16"
      />
    </g>
  );
}

function ViganScene({ progress, gloom }: { progress: number; gloom: boolean }) {
  const arrived = useArrived();
  // The three nearest houses glow on the first screen; the whole street glows once the user is in.
  const lit = gloom || !arrived ? 0 : Math.round(3 + progress * (HOUSES - 3));

  return (
    <svg
      viewBox="0 0 1600 1000"
      preserveAspectRatio="xMaxYMax slice"
      className="lh-scene absolute inset-0 size-full"
      role="img"
      aria-label="Calle Crisologo in Vigan at dusk"
    >
      <defs>
        <linearGradient id="vg-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2b2a52" />
          <stop offset="0.35" stopColor="#5d4775" />
          <stop offset="0.56" stopColor="#e39a72" />
        </linearGradient>
        <radialGradient id="vg-lamp" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffc867" stopOpacity="0.6" />
          <stop offset="1" stopColor="#ffc867" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="1600" height="1000" fill="url(#vg-sky)" />

      {/* The cobbled street, with courses converging on the far end. */}
      <path
        d={`M${VP.x - 6} ${VP.y} L${VP.x + 6} ${VP.y} L1760 1000 L-200 1000 Z`}
        fill="#5d4c45"
      />
      <g stroke="#463831" strokeWidth="2">
        {Array.from({ length: 9 }, (_, i) => {
          const t = depth(i * 0.8);
          const y = VP.y + (1000 - VP.y) * t;
          return (
            <path key={i} d={`M${VP.x + (-200 - VP.x) * t} ${y} H${VP.x + (1760 - VP.x) * t}`} />
          );
        })}
      </g>

      {[-200, 1760].map((nearX) =>
        Array.from({ length: HOUSES }, (_, i) => HOUSES - 1 - i).map((k) => (
          <House key={`${nearX}:${k}`} k={k} nearX={nearX} lit={k < lit} />
        )),
      )}

      {/* Lamp glows on the house fronts, lit with their windows. */}
      {[-200, 1760].map((nearX) =>
        Array.from({ length: HOUSES }, (_, k) => {
          const p = at(nearX, depth(k + 0.5));
          return (
            <circle
              key={`${nearX}:${k}:glow`}
              cx={p.x}
              cy={p.ground - (p.ground - p.eave) * 0.5}
              r={140 * depth(k)}
              fill="url(#vg-lamp)"
              style={{ opacity: k < lit ? 1 : 0, transition: `opacity 700ms ease ${k * 150}ms` }}
            />
          );
        }),
      )}

      {/* A kalesa coming up the street. */}
      <g transform="translate(1010 760) scale(0.9)" fill="#1d1411">
        <path d="M0 0 h120 v-70 q -60 -40 -120 0 Z" />
        <circle cx="30" cy="10" r="30" fill="none" stroke="#1d1411" strokeWidth="6" />
        <circle cx="100" cy="14" r="26" fill="none" stroke="#1d1411" strokeWidth="6" />
        <path d="M120 -20 L180 -24" stroke="#1d1411" strokeWidth="5" />
        <path d="M170 -40 q 20 -40 50 -40 l 14 -30 l 10 6 l -6 30 q 0 20 -18 34 v60 h-8 v-50 h-30 v50 h-8 Z" />
      </g>

      <rect
        width="1600"
        height="1000"
        fill="#1a1830"
        style={{ opacity: gloom ? 0.45 : 0, transition: 'opacity 900ms ease' }}
      />
    </svg>
  );
}

export function Vigan(props: VariantProps) {
  const caption = captionOf(props);

  return (
    <main className="relative min-h-dvh text-ink">
      <div className="fixed inset-0 overflow-hidden bg-[#2b2a52]">
        <ViganScene progress={progressOf(props)} gloom={gloomOf(props)} />
      </div>

      <div className="relative grid min-h-dvh min-[960px]:grid-cols-[minmax(460px,540px)_minmax(0,1fr)]">
        <div className="grid content-center gap-3 px-4 pt-[34vh] pb-24 min-[960px]:px-8 min-[960px]:py-8">
          <section
            aria-labelledby="proto-title"
            className="grid gap-0 rounded-panel bg-surface px-6 py-8 shadow-[0_30px_70px_-30px_rgb(20_10_20/70%)] min-[621px]:px-10 min-[621px]:py-10"
          >
            <LetterheadContent key={props.stateKey} {...props} align="start" />
          </section>
          <p className="m-0 text-caption text-[#f3d9c4]">Calle Crisologo, Vigan, Ilocos Sur</p>
        </div>

        <div className="lh-caption hidden content-start justify-items-end gap-2 p-10 pt-28 text-right text-[#fff4e8] min-[960px]:grid">
          <p className="m-0 max-w-[16ch] text-[2.5rem] leading-[1.05] font-[700] tracking-[-0.025em] [text-wrap:balance]">
            {caption.title}
          </p>
          <p className="m-0 max-w-[40ch] text-body text-[#f3d9c4]">{caption.body}</p>
        </div>
      </div>
    </main>
  );
}
