import { notFound } from 'next/navigation';
import { RecruitmentCasePrototype } from './recruitment-case-prototype';

export const metadata = { title: 'Recruitment Case prototype' };

export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <RecruitmentCasePrototype />;
}
