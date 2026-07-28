export function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function daysBetween(start, end) {
  const startDate = parseDate(start);
  const endDate = parseDate(end);
  if (!startDate || !endDate) return null;
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.ceil((endDate - startDate) / oneDay);
}

export function daysFromToday(date, referenceDate) {
  const hasExplicitReferenceDate = referenceDate !== undefined;
  const today = parseDate(hasExplicitReferenceDate ? referenceDate : new Date());
  if (!today) return null;
  today.setHours(0, 0, 0, 0);

  if (!hasExplicitReferenceDate) {
    return daysBetween(today, date);
  }

  const targetDate = parseDate(date);
  if (!targetDate) return null;
  targetDate.setHours(0, 0, 0, 0);
  return daysBetween(today, targetDate);
}

export function formatDate(value) {
  const date = parseDate(value);
  if (!date) return "-";
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}
