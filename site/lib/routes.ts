// The site's routes: `#/<section>`, `#/<language>` and `#/<language>/<section>`. A language in the address wins over
// the saved and the browser's preference, so a shared deep link opens in the language it was copied in.
// VERIFIED: the e2e opens #/de/perf in German, and the language chooser rewrites the address to #/en/perf.
// Hash routes, not paths: GitHub Pages has no fallback that serves index.html for a deep path.

export const LOCALES = ["en", "de"] as const;
export type SiteLocale = (typeof LOCALES)[number];
export const SECTIONS = ["demo", "how", "services", "perf", "use"] as const;
export type Section = (typeof SECTIONS)[number];

export const ROUTES = [
  { id: "home", path: "/" },
  { id: "one", path: "/:first" },
  { id: "two", path: "/:lang/:section" },
  { id: "missing", path: "*" },
];

export interface Place {
  locale?: SiteLocale;
  section?: Section;
}

const isLocale = (s: string | undefined): s is SiteLocale => LOCALES.includes(s as SiteLocale);
const isSection = (s: string | undefined): s is Section => SECTIONS.includes(s as Section);

/** What a matched route names; unknown parts are ignored, so a stale link still opens the page. */
export function place(routeId: string | null | undefined, params: Record<string, string>): Place {
  if (routeId === "one") {
    if (isLocale(params.first)) return { locale: params.first };
    return isSection(params.first) ? { section: params.first } : {};
  }
  if (routeId === "two") {
    return {
      ...(isLocale(params.lang) ? { locale: params.lang } : {}),
      ...(isSection(params.section) ? { section: params.section } : {}),
    };
  }
  return {};
}

/**
 * The hash route of a section in a language. Links in the static page carry no language (`#/demo`) and open in the
 * visitor's; once the script runs, every link and the address name the current one, so a copied link keeps it.
 */
export function href(locale: SiteLocale, section?: Section): string {
  return section ? `#/${locale}/${section}` : `#/${locale}`;
}

/** The first of the browser's languages that the site has, else English. */
export function preferred(languages: readonly string[]): SiteLocale {
  for (const tag of languages) {
    const base = tag.toLowerCase().split("-")[0];
    if (isLocale(base)) return base;
  }
  return "en";
}
