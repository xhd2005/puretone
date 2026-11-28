const pad = (n: number) => String(n).padStart(2, '0');

export function formatLocalDate(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatSecondsDate(sec: number): string {
  const d = new Date(sec * 1000);
  if (Number.isNaN(d.getTime())) return '';
  return formatLocalDate(d);
}
