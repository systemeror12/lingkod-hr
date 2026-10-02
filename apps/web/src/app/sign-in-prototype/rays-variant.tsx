'use client';

// PROTOTYPE (#398). Variant B: the flag's sun and three stars, drawn in gold line on navy. One
// more ray is drawn per step; when the user is in, the sun and stars fill with gold. Lockouts
// and expired links dim the drawing. Throwaway; do not import.

import { LetterheadContent } from './letterhead-variant';
import type { VariantProps } from './public-variants';
import { SUN, captionOf, gloomOf, LingkodMark, progressOf, useArrived } from './sunrise-variant';

const CX = 330;
const CY = 470;
const ease = 'cubic-bezier(.4,0,.2,1)';

/** A five-point star centred on (x, y). */
function star(x: number, y: number, r: number) {
  const points = Array.from({ length: 10 }, (_, i) => {
    const radius = i % 2 ? r * 0.42 : r;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    return `${(x + radius * Math.cos(angle)).toFixed(1)} ${(y + radius * Math.sin(angle)).toFixed(1)}`;
  });
  return `M${points.join(' L')} Z`;
}

function draw(on: boolean, delay = 0) {
  return {
    strokeDasharray: '1 1',
    strokeDashoffset: on ? 0 : 1,
    transition: `stroke-dashoffset 900ms ${ease} ${delay}ms, fill-opacity 700ms ease`,
  };
}

function RaysScene({ progress, done, gloom }: { progress: number; done: boolean; gloom: boolean }) {
  const arrived = useArrived();
  // Two rays on the first screen; all eight once the user is in.
  const rays = arrived ? Math.round(2 + progress * 6) : 0;
  const fill = done ? 1 : 0;

  return (
    <svg
      viewBox="60 40 800 860"
      preserveAspectRatio="xMidYMid meet"
      className="lh-scene absolute inset-0 size-full p-10"
      role="img"
      aria-label="The sun and three stars of the Philippine flag"
    >
      <g
        fill={SUN}
        stroke={SUN}
        strokeLinejoin="round"
        style={{ opacity: gloom ? 0.3 : 1, transition: 'opacity 900ms ease' }}
      >
        <path
          d="M130 130 L730 470 L130 810 Z"
          pathLength={1}
          fillOpacity={0}
          strokeWidth={1.5}
          strokeOpacity={0.3}
          style={draw(arrived)}
        />
        {[
          [190, 230],
          [190, 710],
          [640, 470],
        ].map(([x, y], index) => (
          <path
            key={index}
            d={star(x!, y!, 30)}
            pathLength={1}
            fillOpacity={fill}
            strokeWidth={2}
            style={draw(arrived, 300 + index * 150)}
          />
        ))}
        <circle
          cx={CX}
          cy={CY}
          r={92}
          pathLength={1}
          fillOpacity={fill}
          strokeWidth={2.5}
          style={draw(arrived, 200)}
        />
        {Array.from({ length: 8 }, (_, index) => (
          <g key={index} transform={`rotate(${index * 45} ${CX} ${CY})`}>
            {[
              `M${CX - 7} ${CY - 112} L${CX} ${CY - 290} L${CX + 7} ${CY - 112} Z`,
              `M${CX - 18} ${CY - 110} L${CX - 30} ${CY - 210} L${CX - 9} ${CY - 112} Z`,
              `M${CX + 18} ${CY - 110} L${CX + 30} ${CY - 210} L${CX + 9} ${CY - 112} Z`,
            ].map((d) => (
              <g key={d}>
                {/* Every ray is faintly sketched from the start, so the sun never looks broken. */}
                <path d={d} fillOpacity={0} strokeWidth={1.2} strokeOpacity={0.22} />
                <path
                  d={d}
                  pathLength={1}
                  fillOpacity={fill}
                  strokeWidth={1.8}
                  style={draw(index < rays, 400 + index * 90)}
                />
              </g>
            ))}
          </g>
        ))}
      </g>
    </svg>
  );
}

export function Rays(props: VariantProps) {
  const caption = captionOf(props);

  return (
    <main className="grid min-h-dvh bg-surface text-ink min-[960px]:grid-cols-[minmax(460px,1fr)_minmax(0,1.1fr)]">
      <div className="grid place-items-center px-6 py-10 min-[621px]:px-14">
        <section aria-labelledby="proto-title" className="grid w-full max-w-[440px] gap-0">
          <LetterheadContent key={props.stateKey} {...props} align="start" />
        </section>
      </div>

      <div className="order-first grid grid-rows-[minmax(0,1fr)_auto] bg-[radial-gradient(circle_at_40%_45%,#1d3d73,#0f2240_55%,#0b1a33)] min-[960px]:sticky min-[960px]:top-0 min-[960px]:order-last min-[960px]:h-dvh">
        <div className="relative h-60 min-[960px]:h-auto">
          <RaysScene
            progress={progressOf(props)}
            done={props.view.outcome?.tone === 'success'}
            gloom={gloomOf(props)}
          />
          <LingkodMark className="absolute inset-x-0 top-0 flex items-center gap-2.5 p-6 text-nav-ink min-[960px]:p-10" />
        </div>
        <div className="lh-caption hidden gap-2 px-10 pt-2 pb-12 text-white min-[960px]:grid">
          <p className="m-0 max-w-[18ch] text-[2.25rem] leading-[1.05] font-[700] tracking-[-0.025em] [text-wrap:balance]">
            {caption.title}
          </p>
          <p className="m-0 max-w-[46ch] text-body text-nav-ink/80">{caption.body}</p>
        </div>
      </div>
    </main>
  );
}
