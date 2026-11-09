// Number formatting shared by the demos, the charts and the build. Pure; the locale decides the decimal separator.
// VERIFIED: site.test.ts checks English and German output; Intl.NumberFormat beats hand-written separators.

export type Locale = "en" | "de";

const number = (locale: Locale, digits: number) =>
  new Intl.NumberFormat(locale === "de" ? "de-DE" : "en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Bytes in the decimal units the README uses: B, KB (1000 B) and MB, with 3 significant digits. */
export function bytes(n: number, locale: Locale = "en"): string {
  if (n < 1000) return `${number(locale, 0).format(n)} B`;
  const [unit, value] = n < 1e6 ? ["KB", n / 1e3] : ["MB", n / 1e6];
  const digits = value < 10 ? 2 : value < 100 ? 1 : 0;
  return `${number(locale, digits).format(value)} ${unit}`;
}

/** Milliseconds below 1 s ("0.42 ms", "189 ms"), seconds above ("1.67 s"). */
export function duration(ms: number, locale: Locale = "en"): string {
  if (ms >= 1000) return `${number(locale, 2).format(ms / 1000)} s`;
  const digits = ms < 1 ? 2 : ms < 10 ? 1 : 0;
  return `${number(locale, digits).format(ms)} ms`;
}

/** A factor such as "4.3" for "4.3 times". */
export function factor(value: number, locale: Locale = "en"): string {
  return number(locale, value >= 10 ? 0 : 1).format(value);
}

/** A percentage with the given digits, "+0.05 %" style when `signed`. */
export function percent(value: number, locale: Locale = "en", digits = 1, signed = false): string {
  const text = `${number(locale, digits).format(Math.abs(value))} %`;
  return signed ? `${value < 0 ? "-" : "+"}${text}` : value < 0 ? `-${text}` : text;
}

/** The window of `lgwin`, as the encoder uses it: 2**lgwin - 16 bytes, shown as KiB or MiB. */
export function windowSize(lgwin: number): string {
  const size = 2 ** lgwin;
  return size >= 1 << 20 ? `${size >> 20} MiB` : `${size >> 10} KiB`;
}

/** Replaces `{name}` placeholders of a message with values. */
export function fill(message: string, values: Record<string, string | number>): string {
  return message.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}
