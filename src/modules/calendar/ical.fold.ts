const MAX_LINE_LENGTH = 75;

export function foldIcalLine(line: string): string[] {
  if (line.length <= MAX_LINE_LENGTH) {
    return [line];
  }

  const lines: string[] = [];
  let remaining = line;

  lines.push(remaining.slice(0, MAX_LINE_LENGTH));
  remaining = remaining.slice(MAX_LINE_LENGTH);

  while (remaining.length > 0) {
    lines.push(` ${remaining.slice(0, MAX_LINE_LENGTH - 1)}`);
    remaining = remaining.slice(MAX_LINE_LENGTH - 1);
  }

  return lines;
}

export function foldIcalContent(content: string): string {
  const rawLines = content.split('\r\n');
  const folded: string[] = [];

  for (const line of rawLines) {
    folded.push(...foldIcalLine(line));
  }

  return folded.join('\r\n');
}
