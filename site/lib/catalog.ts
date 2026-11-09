// Turns the bilingual page source into defuss-i18n markup. The source keeps both languages side by side, which is
// easier to review than two catalogs: an element with `data-t` holds the English content plus a last child
// `<template lang="de">` with the German one, and an attribute `de-aria-label` (title, placeholder, alt) sits next to
// its English attribute. The output is what defuss-i18n reads: `data-i18n-target` regions with their English
// content live, one `<template data-i18n-for data-i18n-locale>` per language, and `data-i18n-<attr>-<locale>` variants.
// VERIFIED: site.test.ts expands the whole page source, and validateI18n reports 0 issues on the built page (e2e).
// Regular expressions over a parser: the source follows three rules (no nested data-t, the German template last,
// no `>` in attributes), and `expand` throws on anything it leaves unexpanded.

export interface Entry {
  name: string;
  en: string;
  de: string;
}

const TRANSLATED_ATTRIBUTES = ["aria-label", "title", "placeholder", "alt"];

// An element with data-t (optionally named), its English content, then the German template as its last child.
// Rules the source follows, checked by `expand`: no data-t inside another, the template is the last child.
const TARGET = /<([a-z][a-z0-9]*)(\s[^>]*?)?\sdata-t(?:="([^"]*)")?(?=[\s>])([^>]*)>([\s\S]*?)<template lang="de">([\s\S]*?)<\/template>\s*<\/\1>/g;
const HEADING_ANCHOR = /<(h[1-6])([^>]*?)\sdata-anchor="([a-z-]+)"([^>]*)>(\s*<span data-t[^>]*>)([\s\S]*?)<template lang="de">([\s\S]*?)<\/template>/g;
const ATTRIBUTE_PAIR = new RegExp(`\\sde-(${TRANSLATED_ATTRIBUTES.join("|")})="([^"]*)"`, "g");

/** Text content of an HTML fragment, for labels built from it. */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const attr = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/**
 * Puts a heading-anchor link (the § permalink of defuss-shadcn) in front of every heading with `data-anchor`, whose
 * text must be a `<span data-t>`. The link points at the section's route, `#/<anchor>`, and carries its label in
 * both languages.
 */
export function addHeadingAnchors(html: string): string {
  return html.replace(HEADING_ANCHOR, (_m, tag, before, anchor, after, span, en, de) => {
    const label = (prefix: string, text: string) => `${prefix}${plainText(text)}`;
    const enLabel = attr(label("Link to section: ", en));
    const deLabel = attr(label("Link zum Abschnitt: ", de));
    const link =
      `<a class="heading-anchor" href="#/${anchor}" data-router-link data-route="${anchor}" aria-label="${enLabel}"` +
      ` data-i18n-aria-label-en="${enLabel}" data-i18n-aria-label-de="${deLabel}">§</a>`;
    return `<${tag}${before}${after}>${link}${span}${en}<template lang="de">${de}</template>`;
  });
}

/** Rewrites `de-<attr>` next to `<attr>` into the two defuss-i18n attribute variants. */
export function expandAttributes(html: string): string {
  return html.replace(/<[a-z][a-z0-9-]*(?:\s[^>]*)?\sde-[a-z-]+="[^"]*"[^>]*>/g, (tag) =>
    tag.replace(ATTRIBUTE_PAIR, (_m, name: string, de: string) => {
      const en = new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
      if (en === undefined) throw new Error(`de-${name} without ${name} in ${tag.slice(0, 80)}`);
      return ` data-i18n-${name}-en="${en}" data-i18n-${name}-de="${de}"`;
    }),
  );
}

/**
 * Expands every `data-t` element into a defuss-i18n target with its English content and returns the entries for
 * the template block. Unnamed targets get `t1`, `t2`, ... in document order.
 */
export function expandTargets(html: string): { html: string; entries: Entry[] } {
  const entries: Entry[] = [];
  const names = new Set<string>();
  const out = html.replace(TARGET, (_m, tag, before = "", given, after, en, de) => {
    if (/\sdata-t[\s=>]/.test(en) || /<template/.test(en)) throw new Error(`nested data-t in <${tag}${before}>`);
    const name = given || `t${entries.length + 1}`;
    if (names.has(name)) throw new Error(`duplicate i18n target ${name}`);
    names.add(name);
    entries.push({ name, en, de });
    return `<${tag}${before} data-i18n-target="${name}"${after}>${en}</${tag}>`;
  });
  return { html: out, entries };
}

/** The template block: one template per entry and language, as defuss-i18n expects them beside the targets. */
export function templates(entries: Entry[]): string {
  return entries
    .map(({ name, en, de }) =>
      [`<template data-i18n-for="${name}" data-i18n-locale="en">${en}</template>`,
        `<template data-i18n-for="${name}" data-i18n-locale="de">${de}</template>`].join("\n"),
    )
    .join("\n");
}

/** All three steps over a page source. */
export function expand(html: string): { html: string; entries: Entry[] } {
  const anchored = addHeadingAnchors(html);
  const { html: targeted, entries } = expandTargets(anchored);
  const out = expandAttributes(targeted);
  const left = /\sdata-t[\s=>]|<template lang="de">|\sde-[a-z-]+="/.exec(out);
  if (left) throw new Error(`untranslated source left: ${out.slice(left.index, left.index + 120)}`);
  return { html: out, entries };
}
