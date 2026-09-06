export { inputClass as employeeInputClass, labelClass as employeeLabelClass } from './ui/field';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatEmployeeDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return value;
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

export function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

export function EmployeeStatus({ linked }: { linked: boolean }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[.06em] ${linked ? 'bg-[#e7f4eb] text-[#27633b]' : 'bg-[#fff2d9] text-[#82520d]'}`}
    >
      {linked ? 'LINKED' : 'UNLINKED'}
    </span>
  );
}

export function EmployeeInitials({ name, large = false }: { name: string; large?: boolean }) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full bg-pale-blue font-[720] text-cobalt ${large ? 'size-16 text-xl' : 'size-9 text-xs'}`}
    >
      {name
        .split(' ')
        .filter((part) => part.length > 1)
        .slice(0, 2)
        .map((part) => part[0])
        .join('')}
    </span>
  );
}

export function EmployeePageTitle({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div>
      <p className="mb-2 text-[10px] font-bold tracking-[.12em] text-cobalt uppercase">{eyebrow}</p>
      <h1 className="m-0 text-[30px] font-[700] tracking-[-.035em] text-midnight">{title}</h1>
      <p className="mt-2 max-w-[620px] text-sm leading-6 text-muted">{description}</p>
    </div>
  );
}
