'use client';

// PROTOTYPE (#398). Variant C: Mayon Volcano from the Cagsawa Ruins in Daraga, Albay. Mayon is
// often hidden in cloud; the clouds part a little more each step and the cone stands clear when
// the user is in. Lockouts and expired links roll the clouds back in. Throwaway; do not import.

import { LetterheadContent } from './letterhead-variant';
import type { VariantProps } from './public-variants';
import { captionOf, gloomOf, progressOf, useArrived } from './sunrise-variant';

const APEX = { x: 700, y: 250 };

const CLOUDS = [
  { x: 560, y: 300, rx: 170, ry: 46, side: -1 },
  { x: 820, y: 290, rx: 180, ry: 50, side: 1 },
  { x: 680, y: 360, rx: 230, ry: 54, side: -1 },
  { x: 760, y: 410, rx: 260, ry: 50, side: 1 },
  { x: 520, y: 450, rx: 200, ry: 40, side: -1 },
];

/** The Cagsawa belfry: three stepped stages, arched openings, a moss-stained base. */
function Belfry() {
  return (
    <g transform="translate(250 900)">
      <path
        d="M-200 0 L-200 -90 L-180 -110 L-160 -84 L-140 -120 L-120 -70 L-100 -60 L-100 0 Z"
        fill="#7d6c55"
      />
      <rect x="-70" y="-190" width="140" height="190" fill="#9a876a" />
      <rect x="-70" y="-60" width="140" height="60" fill="#6f7a4c" opacity="0.55" />
      <rect x="-56" y="-300" width="112" height="110" fill="#a8957a" />
      <rect x="-42" y="-385" width="84" height="85" fill="#b3a084" />
      <path d="M-42 -385 Q 0 -440 42 -385 Z" fill="#8d7b60" />
      {[
        [-30, -160, 22, 70],
        [8, -160, 22, 70],
        [-14, -275, 28, 60],
        [-10, -365, 20, 44],
      ].map(([x, y, w, h]) => (
        <path
          key={`${x}:${y}`}
          d={`M${x} ${y! + h!} V${y! + w! / 2} a${w! / 2} ${w! / 2} 0 0 1 ${w} 0 V${y! + h!} Z`}
          fill="#3a3024"
        />
      ))}
      {[-190, -300, -385].map((y) => (
        <rect
          key={y}
          x={y === -190 ? -76 : y === -300 ? -62 : -48}
          y={y}
          width={y === -190 ? 152 : y === -300 ? 124 : 96}
          height="7"
          fill="#7d6c55"
        />
      ))}
    </g>
  );
}

function MayonScene({ progress, gloom }: { progress: number; gloom: boolean }) {
  const arrived = useArrived();
  // Half the cone shows on the first screen; it is clear once the user is in.
  const clear = gloom ? 0 : arrived ? 0.35 + 0.65 * progress : 0;

  return (
    <svg
      viewBox="0 0 1600 1000"
      preserveAspectRatio="xMinYMax slice"
      className="lh-scene absolute inset-0 size-full"
      role="img"
      aria-label="Mayon Volcano behind the Cagsawa belfry"
    >
      <defs>
        <linearGradient id="my-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5ea7dc" />
          <stop offset="0.7" stopColor="#cfe7f4" />
        </linearGradient>
        <linearGradient id="my-cone" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6d7079" />
          <stop offset="0.35" stopColor="#7c8379" />
          <stop offset="0.75" stopColor="#4f7353" />
        </linearGradient>
        <filter id="my-soft" x="-30%" y="-80%" width="160%" height="260%">
          <feGaussianBlur stdDeviation="10" />
        </filter>
      </defs>

      <rect width="1600" height="1000" fill="url(#my-sky)" />

      {/* The near-perfect cone: concave flanks rising to a narrow summit. */}
      <path
        d={`M-60 780 Q ${APEX.x - 140} 650 ${APEX.x - 22} ${APEX.y} L${APEX.x + 22} ${APEX.y} Q ${APEX.x + 140} 650 1460 780 Z`}
        fill="url(#my-cone)"
      />
      <g stroke="#a3a6ac" strokeOpacity="0.45" strokeWidth="3" fill="none">
        <path d={`M${APEX.x - 8} ${APEX.y + 10} Q ${APEX.x - 60} 470 ${APEX.x - 170} 700`} />
        <path d={`M${APEX.x + 6} ${APEX.y + 12} Q ${APEX.x + 40} 470 ${APEX.x + 120} 720`} />
        <path d={`M${APEX.x} ${APEX.y + 20} Q ${APEX.x - 10} 480 ${APEX.x - 40} 740`} />
      </g>
      <path
        d={`M${APEX.x - 6} ${APEX.y} C ${APEX.x - 20} ${APEX.y - 40} ${APEX.x + 30} ${APEX.y - 60} ${APEX.x + 70} ${APEX.y - 90}`}
        stroke="#fff"
        strokeOpacity="0.7"
        strokeWidth="14"
        strokeLinecap="round"
        fill="none"
        filter="url(#my-soft)"
      />

      <g filter="url(#my-soft)" fill="#fff">
        {CLOUDS.map(({ x, y, rx, ry, side }, index) => (
          <ellipse
            key={index}
            cx={x}
            cy={y}
            rx={rx}
            ry={ry}
            style={{
              opacity: 0.95 - clear * 0.85,
              transform: `translateX(${side * clear * 340}px)`,
              transition: `transform 1800ms cubic-bezier(.3,.6,.2,1) ${index * 80}ms, opacity 1500ms ease`,
            }}
          />
        ))}
      </g>

      {/* Fields and tree lines of Daraga below the volcano. */}
      <path
        d="M-60 760 C 300 730 700 760 1100 740 C 1300 730 1500 745 1660 735 L1660 1000 L-60 1000 Z"
        fill="#6f9f45"
      />
      <path d="M-60 830 C 400 800 900 830 1660 800 L1660 1000 L-60 1000 Z" fill="#5b8a37" />
      <g stroke="#82b356" strokeWidth="2" opacity="0.6">
        {[850, 880, 915, 955].map((y) => (
          <path key={y} d={`M-60 ${y} C 500 ${y - 25} 1000 ${y + 10} 1660 ${y - 20}`} fill="none" />
        ))}
      </g>
      <g fill="#2f5a2a">
        {[460, 520, 980, 1060, 1120].map((x, i) => (
          <circle key={x} cx={x} cy={752 - (i % 2) * 6} r={18 + (i % 3) * 6} />
        ))}
      </g>

      <Belfry />

      <rect
        width="1600"
        height="1000"
        fill="#5a6470"
        style={{ opacity: gloom ? 0.45 : 0, transition: 'opacity 900ms ease' }}
      />
    </svg>
  );
}

export function Mayon(props: VariantProps) {
  const caption = captionOf(props);

  return (
    <main className="relative min-h-dvh text-ink">
      <div className="fixed inset-0 overflow-hidden bg-[#cfe7f4]">
        <MayonScene progress={progressOf(props)} gloom={gloomOf(props)} />
      </div>

      <div className="relative grid min-h-dvh min-[960px]:grid-cols-[minmax(0,1fr)_minmax(460px,540px)]">
        <div className="lh-caption hidden content-start gap-2 p-10 pt-12 text-[#0f2a3d] min-[960px]:grid">
          <p className="m-0 max-w-[18ch] text-[2.5rem] leading-[1.05] font-[700] tracking-[-0.025em] [text-wrap:balance]">
            {caption.title}
          </p>
          <p className="m-0 max-w-[44ch] text-body text-[#24465c]">{caption.body}</p>
        </div>

        <div className="grid content-center gap-3 px-4 pt-[34vh] pb-24 min-[960px]:px-8 min-[960px]:py-8">
          <section
            aria-labelledby="proto-title"
            className="grid gap-0 rounded-panel bg-surface px-6 py-8 shadow-[0_30px_70px_-30px_rgb(15_42_61/50%)] min-[621px]:px-10 min-[621px]:py-10"
          >
            <LetterheadContent key={props.stateKey} {...props} align="start" />
          </section>
          <p className="m-0 text-right text-caption text-[#24465c]">
            Mayon Volcano from the Cagsawa Ruins, Daraga, Albay
          </p>
        </div>
      </div>
    </main>
  );
}
