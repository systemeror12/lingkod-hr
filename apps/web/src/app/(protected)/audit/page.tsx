import type { Metadata } from 'next';
import { AuthorizedPlaceholder } from '../../../components/authorized-placeholder';

export const metadata: Metadata = { title: 'Audit Log' };

export default function AuditPage() {
  return (
    <AuthorizedPlaceholder
      permission="audit.events.read"
      code="Audit Log"
      title="No activity selected"
      message="Authorized Agency activity will be available for read-only review from this workspace."
    />
  );
}
