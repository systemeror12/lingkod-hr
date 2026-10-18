import { useEffect, useState } from 'react';
import { parseEvidenceOptions } from './helpers';
import type { EvidenceOption } from './types';

/**
 * Loads the agency's Document Versions while `enabled` is true, for the evidence picker in an
 * activation form. Pass a stable `onError`, such as a state setter.
 */
export function useEvidenceOptions(
  agencyId: string,
  enabled: boolean,
  onError: (message: string) => void,
): { evidenceOptions: EvidenceOption[]; evidenceLoading: boolean } {
  const [evidenceOptions, setEvidenceOptions] = useState<EvidenceOption[]>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setEvidenceLoading(true);
    void fetch('/api/v1/agencies/' + agencyId + '/documents/versions', { credentials: 'include' })
      .then(async (response) => {
        const value: unknown = await response.json().catch(() => null);
        if (!response.ok) throw new Error('Agency Document Versions could not be loaded.');
        if (active) setEvidenceOptions(parseEvidenceOptions(value));
      })
      .catch((caught: unknown) => {
        if (active) {
          onError(
            caught instanceof Error
              ? caught.message
              : 'Agency Document Versions could not be loaded.',
          );
        }
      })
      .finally(() => {
        if (active) setEvidenceLoading(false);
      });
    return () => {
      active = false;
    };
  }, [agencyId, enabled, onError]);

  return { evidenceOptions, evidenceLoading };
}
