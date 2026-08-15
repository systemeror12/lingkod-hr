import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Invitation unavailable' };

export default function InvitationErrorPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-5 py-10 text-ink">
      <section
        className="grid w-full max-w-[540px] gap-4 rounded-[5px] border border-line bg-paper p-7 min-[621px]:p-10"
        aria-labelledby="invitation-error-title"
      >
        <p className="m-0 text-[11px] font-bold tracking-[0.09em] text-cobalt uppercase">
          Invitation
        </p>
        <h1
          className="m-0 text-2xl font-[680] tracking-[-0.025em] text-midnight"
          id="invitation-error-title"
        >
          This invitation is no longer available
        </h1>
        <p className="m-0 text-sm leading-[1.65] text-muted">
          The link may be expired, already used, cancelled, or not valid. Request a new invitation
          from your Agency Administrator. No access was granted.
        </p>
      </section>
    </main>
  );
}
