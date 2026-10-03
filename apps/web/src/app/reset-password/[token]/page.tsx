import type { Metadata } from 'next';
import { getConfig } from '@lingkod-hr/config';
import { PasswordResetForm, ResetLinkInvalid } from '../../../components/password-reset-forms';

export const metadata: Metadata = { title: 'Choose a new password' };

const RESET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type Lookup =
  | { status: 'VALID'; email: string; secondFactor: boolean; expiresAt: string }
  | { status: 'INVALID' };

/** Looks the link up, which writes nothing, so opening it is safe to repeat. */
async function lookUp(token: string): Promise<Lookup> {
  if (!RESET_TOKEN_PATTERN.test(token)) return { status: 'INVALID' };
  const response = await fetch(`${getConfig().API_URL}/api/v1/auth/password-reset/${token}`, {
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Reset link lookup failed with ${response.status}.`);
  return (await response.json()) as Lookup;
}

export default async function PasswordResetPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const link = await lookUp(token);
  if (link.status !== 'VALID') return <ResetLinkInvalid />;
  return <PasswordResetForm link={{ token, email: link.email, secondFactor: link.secondFactor }} />;
}
