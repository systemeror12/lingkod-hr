import { notFound } from 'next/navigation';
import { AttendancePrototype } from '../../../components/attendance-prototype';

export default function AttendancePrototypePage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <AttendancePrototype />;
}
