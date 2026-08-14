import Link from 'next/link';
import { cn } from '../lib/class-names';
import { StateCode, StateSurface } from './state-surface';
import { buttonVariants } from './ui/button';

export function ShellState({
  code,
  title,
  message,
}: {
  code: string;
  title: string;
  message: string;
}) {
  return (
    <StateSurface labelledBy="shell-state-title">
      <StateCode>{code}</StateCode>
      <h1
        className="m-0 text-2xl font-[670] tracking-[-0.025em] text-midnight"
        id="shell-state-title"
      >
        {title}
      </h1>
      <p className="m-0 max-w-[500px] text-sm leading-[1.6] text-muted">{message}</p>
      <Link
        className={cn(buttonVariants({ variant: 'primary', size: 'default' }), 'mt-2 no-underline')}
        href="/dashboard"
      >
        Return to Dashboard
      </Link>
    </StateSurface>
  );
}
