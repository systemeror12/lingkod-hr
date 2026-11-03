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
