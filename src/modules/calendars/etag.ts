/** True when If-None-Match matches the current strong ETag (Apple/Google style). */
export function etagMatches(
  ifNoneMatch: string | string[] | undefined,
  etag: string,
): boolean {
  if (!ifNoneMatch) {
    return false;
  }
  const raw = Array.isArray(ifNoneMatch) ? ifNoneMatch.join(',') : ifNoneMatch;
  return raw
    .split(',')
    .map((part) => part.trim())
    .some((tag) => tag === '*' || tag === etag || tag === `W/${etag}`);
}
