import type { Metadata } from 'next';
import {
  InvitationKicker,
  InvitationLayout,
  InvitationTitle,
} from '../../components/invitation-layout';
import { SignInForm } from '../../components/sign-in-form';

export const metadata: Metadata = { title: 'Sign in' };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ membershipId?: string | string[] }>;
}) {
  const { membershipId } = await searchParams;
  const requestedMembershipId =
    typeof membershipId === 'string' && UUID_PATTERN.test(membershipId) ? membershipId : null;

  return (
    <InvitationLayout labelledBy="sign-in-title" showMark>
      <div className="grid gap-2">
        <InvitationKicker>LingkodHR</InvitationKicker>
        <InvitationTitle id="sign-in-title">Sign in to your Agency workspace</InvitationTitle>
      </div>
      <SignInForm membershipId={requestedMembershipId} />
    </InvitationLayout>
  );
}
