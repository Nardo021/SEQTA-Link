export function redactCalendarPath(url: string): string {
  return url.replace(/\/calendar\/[^/?]+\.ics/i, '/calendar/[REDACTED].ics');
}

export function redactAuthorizationHeader(
  headers: Record<string, unknown>,
): Record<string, unknown> {
  const clone = { ...headers };
  if ('authorization' in clone) {
    clone.authorization = '[REDACTED]';
  }
  if ('Authorization' in clone) {
    clone.Authorization = '[REDACTED]';
  }
  return clone;
}
