import type { ReactNode } from 'react';
import { cn } from '../lib/class-names';
import { Button } from './ui/button';

/**
 * The remaining-codes prompt, shown once after a Recovery Code proves a sign-in, a Password Reset,
 * or an Invitation Activation: the codes left and the advice to replace the authenticator. The
 * caller's `title` says what the code proved.
 */
export function RecoveryCodePrompt({
  title,
  email,
  remaining,
  continueLabel,
  onContinue,
}: {
  title: ReactNode;
  email: string;
  remaining: number;
  continueLabel: string;
  onContinue: () => void;
}) {
  return (
    <>
      <div className="grid gap-2">
        {title}
        <p className="m-0 max-w-[60ch] text-body text-ink-muted">
          {remaining > 0
            ? 'We signed you out of your other sessions and emailed you a notice. If you lost your authenticator, replace it and generate new Recovery Codes.'
            : 'We signed you out of your other sessions and emailed you a notice. That was your last code: replace your authenticator and generate new Recovery Codes, because without them only a Security Administrator can reset it.'}
        </p>
        <p className="m-0 text-small text-ink-muted">
          Account: <span className="text-ink">{email}</span>
        </p>
      </div>
      <p className="m-0 text-body">
        You have{' '}
        <strong className={cn('font-[700]', remaining === 0 && 'text-danger')}>
          {remaining === 0 ? 'no' : remaining} Recovery Code{remaining === 1 ? '' : 's'}
        </strong>{' '}
        left.
      </p>
      <Button
        variant="primary"
        className="min-h-11 justify-self-start px-6"
        type="button"
        onClick={onContinue}
      >
        {continueLabel}
      </Button>
    </>
  );
}
