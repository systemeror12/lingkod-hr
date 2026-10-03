import type { Metadata } from 'next';
import { getConfig } from '@lingkod-hr/config';
import {
  ActivationOutcome,
  InvitationActivationForm,
  invitationOutcome,
} from '../../../components/invitation-activation-form';

export const metadata: Metadata = { title: 'Activate your access' };

const ACTIVATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type Lookup =
  | {
      status: 'VALID';
      email: string;
      agency: { name: string; acronym: string | null; sealUrl?: string | null };
      roleNames: string[];
      existingUser: boolean;
      expiresAt: string;
    }
  | { status: 'EXPIRED' | 'INVALID' };

/** Looks the invitation up, which writes nothing, so opening the link is safe to repeat. */
async function lookUp(token: string): Promise<Lookup> {
  if (!ACTIVATION_TOKEN_PATTERN.test(token)) return { status: 'INVALID' };
  const response = await fetch(`${getConfig().API_URL}/api/v1/auth/invitations/${token}`, {
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Invitation lookup failed with ${response.status}.`);
  return (await response.json()) as Lookup;
}

export default async function InvitationActivationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invitation = await lookUp(token);
  if (invitation.status !== 'VALID') {
    return <ActivationOutcome outcome={invitationOutcome(invitation.status)} agency={null} />;
  }
  return <InvitationActivationForm invitation={{ ...invitation, token }} />;
}
