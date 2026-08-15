import { getActiveSession, hasPermission } from '../lib/session';
import { ShellState } from './shell-state';

export async function AuthorizedPlaceholder({
  permission,
  code,
  title,
  message,
}: {
  permission: string;
  code: string;
  title: string;
  message: string;
}) {
  const session = await getActiveSession();
  if (!hasPermission(session, permission)) {
    return (
      <ShellState
        code="403"
        title="You can’t open this page"
        message="Your active Agency Membership does not permit this work. Return to the Dashboard to continue."
      />
    );
  }
  return <ShellState code={code} title={title} message={message} />;
}
