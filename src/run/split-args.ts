/**
 * Split a typed console command into the executable and its arguments (whitespace-separated; single or double
 * quotes group, a backslash escapes the next character).
 * @adr 0670
 */

/** `npm run "my script"` ⇒ `["npm", "run", "my script"]`. */
export function splitArgs(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  let has = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === "\\" && i + 1 < line.length) {
      cur += line[++i];
      has = true;
    } else if (quote) {
      if (c === quote) quote = null;
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      has = true;
    } else if (/\s/.test(c)) {
      if (has) out.push(cur);
      cur = "";
      has = false;
    } else {
      cur += c;
      has = true;
    }
  }
  if (has) out.push(cur);
  return out;
}
