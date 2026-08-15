import type { Metadata } from 'next';
import { getConfig } from '@lingkod-hr/config';

export const metadata: Metadata = { title: 'Invitation handoff' };

const ACTIVATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export default async function InvitationTransitionPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!ACTIVATION_TOKEN_PATTERN.test(token)) return <RecoverySurface />;

  const apiLoginUrl = new URL('/api/v1/auth/login', getConfig().API_URL);
  apiLoginUrl.searchParams.set('invitation', token);

  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-5 py-10 text-ink">
      <section
        className="grid w-full max-w-[540px] gap-5 rounded-[5px] border border-line bg-paper p-7 shadow-[0_18px_55px_rgb(23_32_51/8%)] min-[621px]:p-10"
        aria-labelledby="invitation-title"
      >
        <div className="grid size-9 place-items-center rounded-[3px] bg-midnight text-sm font-bold text-paper">
          L
        </div>
        <div className="grid gap-2">
          <p className="m-0 text-[11px] font-bold tracking-[0.09em] text-cobalt uppercase">
            LingkodHR invitation
          </p>
          <h1
            className="m-0 text-[clamp(25px,4vw,34px)] leading-[1.12] font-[680] tracking-[-0.03em] text-midnight"
            id="invitation-title"
          >
            You’re about to continue to secure sign-in
          </h1>
          <p className="m-0 text-sm leading-[1.65] text-muted">
            LingkodHR will now hand you to the approved identity provider. Use the verified email
            address that received this invitation. Your Agency access takes effect only after the
            invitation is accepted.
          </p>
        </div>
        <a
          className="inline-flex min-h-11 items-center justify-center rounded-[3px] bg-cobalt px-4 text-sm font-[650] text-white no-underline hover:bg-[#365f96]"
          href={apiLoginUrl.toString()}
        >
          Continue to secure sign-in
        </a>
        <p className="m-0 text-xs leading-[1.55] text-muted">
          This page does not collect credentials. The identity provider handles authentication and
          verification.
        </p>
      </section>
    </main>
  );
}

function RecoverySurface() {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-5 py-10 text-ink">
      <section
        className="grid w-full max-w-[540px] gap-4 rounded-[5px] border border-line bg-paper p-7 min-[621px]:p-10"
        aria-labelledby="invitation-recovery-title"
      >
        <p className="m-0 text-[11px] font-bold tracking-[0.09em] text-cobalt uppercase">
          Invitation
        </p>
        <h1
          className="m-0 text-2xl font-[680] tracking-[-0.025em] text-midnight"
          id="invitation-recovery-title"
        >
          This invitation could not be opened
        </h1>
        <p className="m-0 text-sm leading-[1.65] text-muted">
          Request a new invitation from your Agency Administrator. No access was granted.
        </p>
      </section>
    </main>
  );
}
