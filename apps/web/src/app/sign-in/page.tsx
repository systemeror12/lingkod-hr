import type { Metadata } from 'next';
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

  return <SignInForm membershipId={requestedMembershipId} />;
}
