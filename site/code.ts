// The page's code examples, highlighted at build time with Shiki 3.0.0 and the github-light / github-dark themes,
// the highlighter and themes of defuss-shadcn's code-example component, with its `--code-example-` token variables.
// Highlighting at build time keeps the code coloured in a page opened from disk and costs visitors no download;
// runtime highlighting (code-example loads Shiki from esm.sh) would leave plain code until it loads. VERIFIED: the
// site e2e finds the token colours in docs/index.html opened from disk.
import { createHighlighter } from "shiki";

const RUNNERS = { bun: "bunx", pnpm: "pnpm dlx", npm: "npx", yarn: "yarn dlx" } as const;
const INSTALL = { bun: "bun add", pnpm: "pnpm add", npm: "npm install", yarn: "yarn add" } as const;
export type PackageManager = keyof typeof RUNNERS;
export const PACKAGE_MANAGERS = Object.keys(RUNNERS) as PackageManager[];

const cli = (run: string) => `# writes dist/app.js.br and keeps dist/app.js
${run} defuss-brotli compress dist/app.js
# several files, quality 11 by default
${run} defuss-brotli -v dist/*.html dist/*.css
# decompress to standard output
${run} defuss-brotli -d -c data.json.br | head`;

export interface Snippet {
  lang: "ts" | "html" | "shellscript";
  code: string;
  title: string;
  /** Shell lines get a `$` prompt; code gets line numbers. */
  prompt: boolean;
  /** One variant per package manager, switched by the page's toggle groups. */
  pm?: PackageManager;
}

export const SNIPPETS: Record<string, Snippet[]> = {
  install: PACKAGE_MANAGERS.map((pm) => ({
    lang: "shellscript",
    code: `${INSTALL[pm]} defuss-brotli`,
    title: "terminal",
    prompt: true,
    pm,
  })),
  cli: PACKAGE_MANAGERS.map((pm) => ({ lang: "shellscript", code: cli(RUNNERS[pm]), title: "terminal", prompt: true, pm })),
  quick: PACKAGE_MANAGERS.map((pm) => ({
    lang: "shellscript",
    code: `# writes dist/app.js.br, keeps dist/app.js\n${RUNNERS[pm]} defuss-brotli dist/app.js`,
    title: "terminal",
    prompt: true,
    pm,
  })),
  browser: [
    {
      lang: "ts",
      title: "app.ts",
      prompt: false,
      code: `import { init, decompressText } from "defuss-brotli/decompressor/slim";

await init(); // fetches decompressor.wasm
const response = await fetch("/data/catalog.json.br");
const bytes = new Uint8Array(await response.arrayBuffer());
const catalog = JSON.parse(decompressText(bytes));`,
    },
  ],
  server: [
    {
      lang: "ts",
      title: "precompress.ts",
      prompt: false,
      code: `import { readFile, writeFile } from "node:fs/promises";
import { init, compressParallel } from "defuss-brotli/compressor";

await init();
const input = await readFile("dist/app.js");
await writeFile("dist/app.js.br", await compressParallel(input));`,
    },
  ],
  cdn: [
    {
      lang: "html",
      title: "index.html",
      prompt: false,
      code: `<script type="importmap">
  { "imports": { "defuss-brotli/decompressor/slim":
    "https://cdn.jsdelivr.net/npm/defuss-brotli@0.3.1/dist/decompressor-slim.js" } }
</script>
<script type="module">
  import { init, decompress } from "defuss-brotli/decompressor/slim";
  await init();
</script>`,
    },
  ],
};

// VERIFIED: (WCAG contrast against this page's code cards, computed from the site.css tokens) github-dark's comment
// grey #6a737d reaches 3.7:1 on the dark card and github-light's orange #e36209 3.5:1 on the light one, below AA
// (4.5:1); github-light's #6a737d passes at 4.8:1. The replacements keep the hue at 7.2, 6.4 and 6.4:1.
const CONTRAST: Record<string, string> = {
  "light:#6a737d": "#57606a",
  "dark:#6a737d": "#9ea7b3",
  "light:#e36209": "#a04100",
};

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const attr = (s: string) => escape(s).replace(/"/g, "&quot;");

/** Renders every snippet as a defuss-shadcn mockup-code window; returns name to HTML. */
export async function renderSnippets(): Promise<Record<string, string>> {
  const highlighter = await createHighlighter({ themes: ["github-light", "github-dark"], langs: ["ts", "html", "shellscript"] });
  const out: Record<string, string> = {};
  for (const [name, variants] of Object.entries(SNIPPETS)) {
    out[name] = variants
      .map((snippet) => {
        const { tokens } = highlighter.codeToTokens(snippet.code, {
          lang: snippet.lang,
          themes: { light: "github-light", dark: "github-dark" },
          defaultColor: false,
          cssVariablePrefix: "--code-example-",
        });
        const lines = tokens.map((line) => {
          const html = line
            .map((token) => {
              const style = Object.entries(token.htmlStyle ?? {})
                .map(([key, value]) => {
                  const theme = key.endsWith("-dark") ? "dark" : "light";
                  return `${key}:${CONTRAST[`${theme}:${String(value).toLowerCase()}`] ?? value}`;
                })
                .join(";");
              return style ? `<span style="${style}">${escape(token.content)}</span>` : escape(token.content);
            })
            .join("");
          const comment = line.length > 0 && line.every((t) => /^\s*(#.*)?$/.test(t.content));
          const prefix = snippet.prompt ? (comment ? ' data-prefix="" data-tone="muted"' : ' data-prefix="$"') : "";
          return `<pre${prefix}><code>${html || " "}</code></pre>`;
        });
        const pm = snippet.pm ? ` data-pm="${snippet.pm}"${snippet.pm === "bun" ? "" : " hidden"}` : "";
        const numbers = snippet.prompt ? "" : " data-numbers";
        return (
          `<div class="mockup-code hl" data-variant="outline" data-wrap data-title="${attr(snippet.title)}"${numbers}${pm}` +
          ` data-source="${attr(snippet.prompt ? snippet.code.split("\n").filter((l) => !l.startsWith("#")).join("\n") : snippet.code)}">${lines.join("")}</div>`
        );
      })
      .join("");
  }
  return out;
}
