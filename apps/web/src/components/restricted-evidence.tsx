import { StatusTag } from './ui/status-tag';

/**
 * Stands in for evidence the reader lacks `documents.evidence.read_sensitive` to identify. The
 * API sends only the marker, so this shows that evidence exists and nothing about which one.
 */
export function RestrictedEvidence() {
  return <StatusTag tone="neutral">Restricted evidence</StatusTag>;
}
