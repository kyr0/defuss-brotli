"""Project-local verifier policy. Agents MAY extend it; every gate executes it fail-closed."""

CONFIG = {
    "coverage_min": 60,
    "lint_command": None,          # None → `make lint` (uv run ruff check . | bunx oxlint --deny-warnings).
    "test_command": None,          # None → `make test`. Commands run in the repo root.
    "coverage_command": None,      # None → `make coverage`; output needs `TOTAL <n>%` or an `All files |…|` table.
    "integration_commands": [],    # [] → `make integration` if present.
    "e2e_commands": [],            # [] → `make e2e`: build + consume the publishable artifact.
    "e2e_paths": [],               # globs e2e depends on, e.g. ["web/*"]: e2e reruns only when one (or a build file) changed; [] → any code file.
    "timeout_s": 180,
    # `init` on a GitHub remote writes .github/workflows/verify.yml (uv/bun via their official setup actions) unless a
    # workflow already runs `make verify`, these commands or every verify verb. None → make setup, make verify.
    "ci": None,                    # None | False (no CI workflow) | ["make setup", "make ci"] (one step each)
    "layout": True,                # Makefile verbs + gitignored secrets, runtime state, dist/, caches and package folders.
    "strict": True,               # docs.pages, gitignore and package block; False makes them warnings (a project created before 0.6.0 has False).
    "gitignore_exempt": [],        # required ignore lines this project may skip, e.g. ["dist/"] for a GitHub Action that commits its build.
    "toolchain": True,             # new (sub)projects start on bun (JS/TS) / uv (Python): newly added npm/yarn/pnpm/poetry/pipenv/pdm/pip lockfiles fail.
    # Static check of every changed doc page (*.md|*.mdx|*.markdown); False disables it.
    # allow: {glob: characters a page may use as house style}, e.g. {"docs/de/*.md": "\u201e\u201c"} for German quotes.
    # phrases: extra slop regexes (any language), case-insensitive, flagged as findings.
    # html: globs of HTML pages that are prose (a project site, e.g. ["docs/*.html"]), checked in their text and
    # reader-facing attributes; other HTML files (templates, reports) are code.
    # HYPOTHESIS: most projects need no allow entry; add one only for a page whose house style needs a flagged character.
    # README.md covers the root and each package with a changed CLI|API; ARCH.md each package with changed production code
    # or deployment|schema files. A page covers the folders below it up to the next package manifest; tests, examples,
    # docs, config and data need none.
    # rust/ holds two internal crates (publish = false) whose only consumer is src/; the npm API is documented in the
    # root README.md and both crates' design in the root ARCH.md ("Rust crates"), so per-crate pages would only repeat it.
    "readme": {"exclude": ["rust", "rust/*"]},
    "arch": {"exclude": ["rust", "rust/*"]},
    # Changed package.json: packageManager, description, license, author; new packages also type, linter, library build.
    # Published package (0.1.3) built by scripts/build.ts: wasm-pack, wasm-opt, base64 inlining, then bun build + tsc.
    # pkgroll cannot run the WASM steps, and an existing package keeps its build unless the human approves migrating.
    "package": {"manager": "bun", "type": "module", "lint": "oxlint", "library_build": None},
    # Optional for edit runs (references/EDIT.md): "guidelines" (textsorte, zielgruppe, kommunikationsziel, hausstil,
    # geschuetzte_begriffe: terms a replacement must keep) and "edit" (max_part_chars, heading_depth, attempts, the
    # budgets, tool_scope, trace, max_tokens_total); unset keys keep pro-edit's defaults.
    # AGENTS.md's managed block is written in VAE-DIALECT, which defines `→` as its sequence|result operator.
    # docs/index.html is the website (built from site/page.html); its German templates are checked by site/e2e.mjs,
    # which scans the rendered text in both languages.
    "prose": {"allow": {"AGENTS.md": "\u2192"}, "phrases": [], "html": ["docs/index.html"]},
}

# Deterministic invariants only; no semantic guesses.
# kinds: command | file_exists | contains | regex | not_regex
# When none of these can express an invariant (it needs parsing, several files, a running program or project
# semantics), plan the check like a test: write .vae/checks/<id>.py (stdlib, exits non-zero and prints what to fix)
# and add {"id": "<id>", "kind": "command", "command": "python3 .vae/checks/<id>.py", "claim": "..."}.
# scope: "path" = one exact file; "glob" = every changed code file matching (fnmatch); "glob" + "docs": True = every
# changed doc page matching, e.g. {"id": "docs.arch.diagram", "kind": "contains", "path": "docs/ARCHITECTURE.md",
# "text": "```mermaid", "claim": "architecture page keeps its diagram"}.
RULES = [{
    "id": "package.files-exist",
    "kind": "command",
    # npm pack silently skips missing `files` entries; dist/ is build output and checked by e2e instead.
    "command": "python3 -c \"import json,os,sys; m=[f for f in json.load(open('package.json'))['files'] if f != 'dist' and not os.path.exists(f)]; print('package.json files entries missing:', m) if m else None; sys.exit(1 if m else 0)\"",
    "claim": "every package.json files entry ships (license notices included)",
}, {
    "id": "build.tools-without-mise-activation",
    "kind": "contains",
    "path": "scripts/build.ts",
    "text": ".local/share/mise/shims",
    "claim": "bun run build (npm prepublishOnly) finds the mise-pinned wasm-pack and wasm-opt without an activated mise",
}, {
    "id": "tests.no-mocks",
    "kind": "not_regex",
    "glob": "*",
    # Every alternative contains an escape, so this file never matches its own pattern.
    "pattern": r"unittest\.mock|from\s+unittest\s+import\s+mock|MagicMock\(|mock\.patch|mocker\.|"
               r"jest\.(?:mock|fn|spyOn)\(|vi\.(?:mock|fn|spyOn)\(|sinon\.|gomock\.|mock\.Mock\b|Mockito\.|@Mock\s|mockk\(|"
               r"@Mock(?:ito)?Bean\b|new\s+Mock<|Mock\.Of<|Substitute\.For<|A\.Fake<|mockall:{2}|#\[automock\]",
    "claim": "tests exercise real subsystems, not mock frameworks",
}, {
    "id": "build.no-hardcoded-wasm-bindgen-shims",
    "kind": "not_regex",
    "glob": "scripts/*",
    # Hashed shim names change with every wasm-bindgen release and Rust signature; pass the glue namespace instead.
    "pattern": r"__wbindgen_cast_[0-9]|__wbg_[A-Za-z0-9]+_[0-9a-f]{16}",
    "claim": "the build wires WASM imports from the glue namespace, never by hashed shim name",
}, {
    "id": "src.no-hardcoded-wasm-bindgen-shims",
    "kind": "not_regex",
    "glob": "src/*",
    "pattern": r"__wbindgen_cast_[0-9]|__wbg_[A-Za-z0-9]+_[0-9a-f]{16}",
    "claim": "the TS entry points wire WASM imports from the glue namespace, never by hashed shim name",
}, {
    "id": "ci.lint-builds-first",
    "kind": "regex",
    "path": "Makefile",
    # VERIFIED 2026-11-09: CI failed from 0.3.0 to 0.4.0 at `tsc` in a clean checkout, because lint ran before the
    # build that generates wasm/pkg and dist/; locally both always existed, so the gate never saw it.
    "pattern": r"(?m)^lint: \$\(STAMP\)",
    "claim": "lint depends on the build, so tsc finds the generated modules in a clean CI checkout",
}, {
    "id": "ci.llvm-cov-pinned",
    "kind": "regex",
    "path": "mise.toml",
    # VERIFIED 2026-11-10: CI failed at `cargo llvm-cov` ("no such command"), which existed only in this Mac's
    # ~/.cargo/bin from a manual `cargo install`; `make setup` (mise install) now installs it in every checkout.
    "pattern": r'(?m)^"github:taiki-e/cargo-llvm-cov" = "',
    "claim": "the cargo-llvm-cov that `make coverage` runs is pinned in mise.toml, so `make setup` installs it in CI",
}]
