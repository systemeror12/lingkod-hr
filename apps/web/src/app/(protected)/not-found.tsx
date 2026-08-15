import { ShellState } from '../../components/shell-state';

export default function NotFound() {
  return (
    <ShellState
      code="Not found"
      title="The record could not be found"
      message="It may no longer be available in your active Agency Context. No record details were disclosed."
    />
  );
}
