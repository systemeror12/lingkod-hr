import { notFound } from 'next/navigation';
import { AppointmentCasePrototype } from './appointment-case-prototype';

export const metadata = { title: 'Appointment Case prototype' };

export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <AppointmentCasePrototype />;
}
