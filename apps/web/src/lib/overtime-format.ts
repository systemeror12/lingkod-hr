/** An hours value as the API sends it, without trailing zeros: `16.0000` reads `16`. */
export function hoursLabel(value: string | number): string {
  const text = typeof value === 'number' ? value.toFixed(4) : value;
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

/** A calendar date or instant as an Asia/Manila date, such as `Dec 14, 2026`. */
export function dateLabel(value: string): string {
  const date = new Date(value.includes('T') ? value : `${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Manila',
  });
}

/** A `YYYY-MM` or `YYYY-MM-DD` value as its calendar month, such as `March 2026`. */
export function monthLabel(value: string): string {
  const date = new Date(`${value.slice(0, 7)}-01T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', timeZone: 'UTC' });
}

/** Every calendar month, as `YYYY-MM`, from the month of `from` to the month of `to`. */
export function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const last = to.slice(0, 7);
  for (;;) {
    const current = `${year}-${String(month).padStart(2, '0')}`;
    if (current > last || months.length > 120) return months;
    months.push(current);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
}
