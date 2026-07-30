/**
 * Timezone helpers. Job timestamps are stored internally as UTC ISO strings
 * (the universal, unambiguous format), and converted to Sri Lanka time only
 * at the edges -- for log lines and for the dashboard/history view -- per
 * the requirement that all scheduling and displayed job times read as SLST
 * (Asia/Colombo, UTC+5:30).
 */

const SRI_LANKA_TIMEZONE = 'Asia/Colombo';

const displayFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: SRI_LANKA_TIMEZONE,
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/**
 * Formats a Date (or ISO string) as a human-readable Sri Lanka local
 * timestamp, e.g. "30 Jul 2026, 18:00:05".
 */
export function formatSriLankaTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return `${displayFormatter.format(d)} SLST`;
}

/**
 * Returns the current time formatted for log lines, e.g.
 * "[30 Jul 2026, 18:00:05 SLST]".
 */
export function nowForLog(): string {
  return `[${formatSriLankaTime(new Date())}]`;
}
