// Highlights the one-line call the demos show ("what ran") with the token colours of the build's Shiki themes
// (github-light / github-dark), so it matches the highlighted code elsewhere on the page without loading Shiki,
// which would cost a large download for one line. VERIFIED: site.test.ts checks the text and both colours.

const COLORS = {
  keyword: ["#d73a49", "#f97583"],
  function: ["#6f42c1", "#b392f0"],
  number: ["#005cc5", "#79b8ff"],
  string: ["#032f62", "#9ecbff"],
  plain: ["#24292e", "#e1e4e8"],
} as const;
type Kind = keyof typeof COLORS;

const TOKEN = /("[^"]*"|'[^']*')|(\b\d+(?:\.\d+)?\b)|\b(await|new|const|true|false)\b|([A-Za-z_$][\w$]*)(?=\()|([^"'\w]+|[\w$]+)/g;
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** One line of JavaScript as spans that carry both theme colours. */
export function highlightCall(code: string): string {
  let html = "";
  for (const m of code.matchAll(TOKEN)) {
    const kind: Kind = m[1] ? "string" : m[2] ? "number" : m[3] ? "keyword" : m[4] ? "function" : "plain";
    const [light, dark] = COLORS[kind];
    html += `<span style="--code-example-light:${light};--code-example-dark:${dark}">${escape(m[0])}</span>`;
  }
  return html;
}
