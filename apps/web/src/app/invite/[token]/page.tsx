import type { Metadata } from 'next';
import { getConfig } from '@lingkod-hr/config';
import {
  InvitationKicker,
  InvitationLayout,
  InvitationTitle,
} from '../../../components/invitation-layout';
import { buttonVariants } from '../../../components/ui/button';
import { cn } from '../../../lib/class-names';

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
    <InvitationLayout labelledBy="invitation-title" showMark>
      <div className="grid gap-2">
        <InvitationKicker>LingkodHR invitation</InvitationKicker>
        <InvitationTitle id="invitation-title">
          You’re about to continue to secure sign-in
        </InvitationTitle>
        <p className="m-0 text-body text-ink-muted">
          LingkodHR will now hand you to the approved identity provider. Use the verified email
          address that received this invitation. Your Agency access takes effect only after the
          invitation is accepted.
        </p>
      </div>
      <a
        className={cn(buttonVariants({ variant: 'primary' }), 'min-h-11')}
        href={apiLoginUrl.toString()}
      >
        Continue to secure sign-in
      </a>
      <p className="m-0 text-caption text-ink-muted">
        This page does not collect credentials. The identity provider handles authentication and
        verification.
      </p>
    </InvitationLayout>
  );
}

function RecoverySurface() {
  return (
    <InvitationLayout labelledBy="invitation-recovery-title">
      <InvitationKicker>Invitation</InvitationKicker>
      <InvitationTitle id="invitation-recovery-title">
        This invitation could not be opened
      </InvitationTitle>
      <p className="m-0 text-body text-ink-muted">
        Request a new invitation from your Agency Administrator. No access was granted.
      </p>
    </InvitationLayout>
  );
}
