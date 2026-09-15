import { notFound } from 'next/navigation';
import { LeavePrototype } from '../../../components/leave-prototype';

export default function LeavePrototypePage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <LeavePrototype />;
}
