// Sample input that costs no download: JSON log lines from a seeded generator, the same bytes on every visit, so
// a result on this page can be compared with one from another browser or device. VERIFIED: the same bytes on every
// call (site.test.ts); compressParallel was 2.6 times faster than compress on it in the e2e (Chromium 158, 8 workers).

const ROUTES = ["/api/orders", "/api/items", "/api/users", "/api/search", "/health", "/assets/app.js"];
const LEVELS = ["info", "info", "info", "info", "warn", "debug"];
const STATUS = [200, 200, 200, 200, 201, 204, 304, 404, 500];

/** A 32-bit seeded generator (mulberry32): fast and plenty for sample data. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Whole log lines, `size` bytes or slightly fewer, the same for the same arguments. */
export function logLines(size: number, seed = 7): Uint8Array {
  const next = random(seed);
  const pick = <T>(list: T[]) => list[Math.floor(next() * list.length)]!;
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let length = 0;
  let time = Date.UTC(2026, 10, 9, 8, 0, 0);
  for (;;) {
    time += Math.floor(next() * 900);
    const route = pick(ROUTES);
    const id = route.startsWith("/api") ? `/${Math.floor(next() * 50000)}` : "";
    const line = `{"time":"${new Date(time).toISOString()}","level":"${pick(LEVELS)}","route":"${route}${id}","status":${pick(STATUS)},"ms":${Math.floor(next() * next() * 400)},"user":"u${Math.floor(next() * 5000)}"}\n`;
    if (length + line.length > size) break;
    lines.push(line);
    length += line.length;
  }
  return encoder.encode(lines.join(""));
}
