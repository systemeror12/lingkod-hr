// PROTOTYPE (#398). Keyframes for the letterhead variants. Every animation answers a user action
// or a step change and runs once; only the busy bar repeats, and only while a request is in flight.

const css = `
@keyframes lh-step-in { from { opacity: 0; transform: translateX(14px); } to { opacity: 1; transform: none; } }
@keyframes lh-nudge { 0%, 100% { transform: none; } 20% { transform: translateX(-7px); } 45% { transform: translateX(6px); } 70% { transform: translateX(-3px); } }
@keyframes lh-stamp { 0% { opacity: 0; transform: scale(1.5) rotate(-12deg); } 60% { opacity: 1; transform: scale(0.94) rotate(2deg); } 100% { transform: none; } }
@keyframes lh-code { from { opacity: 0; transform: translateY(4px); filter: blur(3px); } to { opacity: 1; transform: none; filter: none; } }
@keyframes lh-busy { from { transform: translateX(-100%); } to { transform: translateX(250%); } }
@keyframes lh-caption { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
.lh-step-in { animation: lh-step-in 280ms cubic-bezier(.2,.7,.2,1) both; }
.lh-nudge { animation: lh-nudge 360ms ease-out 120ms both; }
.lh-stamp { animation: lh-stamp 520ms cubic-bezier(.3,1.4,.5,1) 150ms both; transform-origin: center; }
.lh-code { animation: lh-code 320ms ease-out both; }
.lh-busy { animation: lh-busy 900ms cubic-bezier(.4,0,.6,1) infinite; }
.lh-caption { animation: lh-caption 700ms cubic-bezier(.2,.7,.2,1) 900ms both; }
@media (prefers-reduced-motion: reduce) {
  .lh-step-in, .lh-nudge, .lh-stamp, .lh-code, .lh-busy, .lh-caption { animation: none !important; }
  .lh-scene * { transition: none !important; }
}
`;

export function PrototypeMotion() {
  return <style>{css}</style>;
}
