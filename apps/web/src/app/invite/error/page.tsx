import type { Metadata } from 'next';
import {
  InvitationKicker,
  InvitationLayout,
  InvitationTitle,
} from '../../../components/invitation-layout';

export const metadata: Metadata = { title: 'Invitation unavailable' };

export default function InvitationErrorPage() {
  return (
    <InvitationLayout labelledBy="invitation-error-title">
      <InvitationKicker>Invitation</InvitationKicker>
      <InvitationTitle id="invitation-error-title">
        This invitation is no longer available
      </InvitationTitle>
      <p className="m-0 text-body text-ink-muted">
        The link may be expired, already used, cancelled, or not valid. Request a new invitation
        from your Agency Administrator. No access was granted.
      </p>
    </InvitationLayout>
  );
}
