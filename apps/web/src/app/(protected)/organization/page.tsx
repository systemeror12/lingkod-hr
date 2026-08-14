import type { Metadata } from 'next';
import { AuthorizedPlaceholder } from '../../../components/authorized-placeholder';

export const metadata: Metadata = { title: 'Organization' };

export default function OrganizationPage() {
  return (
    <AuthorizedPlaceholder
      permission="organization.units.read"
      code="Organization"
      title="No Organization Units yet"
      message="Draft Organization Units created in this Agency Context will appear here."
    />
  );
}
