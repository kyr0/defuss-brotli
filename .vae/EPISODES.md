# Episodes

<!-- Newest last. The gate appends FAIL|DONE|FINDING; past 100 entries it trims only its own oldest DONE|FAIL|learned
FINDING (git keeps them). Leads (LESSON, FINDING learn=none) stay until wrap settles them; doctor fails above 30.
Agents append `<UTC ISO> s=<session> LESSON <VAE-DIALECT>` only for a falsified HYPOTHESIS, a dead end, or a root cause.
Session start injects the 3 newest open entries: LESSON, FINDING learn=none, FAIL without a later DONE.
Wrap: EVERY lead becomes a test | .vae/VERIFY.py rule | one MEMORY line with BC, then delete; OR delete BC evidence. -->

2026-11-08T20:09:48Z s=698894d0 FAIL prose,layout,wiring,lint=?,tests.unit,tests.e2e=?,coverage=?
2026-11-08T20:29:59Z s=698894d0 FAIL docs.pages,prose,package
2026-11-08T20:51:38Z s=698894d0 DONE fp=583037436150 cov=96.4% paths=.github/workflows/verify.yml,AGENTS.md,ARCH.md,Makefile(+29)
2026-11-08T20:51:38Z s=698894d0 FINDING scripts/build.ts:wasm-opt step learn=none: build fails loudly on recurrence (wasm-opt exits non-zero), no silent path left
2026-11-08T20:51:38Z s=698894d0 FINDING rust/compressor/src/lib.rs:compress learn=test: rust fast_qualities_match_across_4k_chunks + src/compressor.test.ts 'fast qualities match repeats across 4 KiB chunks' fail on the old implementation
2026-11-08T20:51:38Z s=698894d0 FINDING src/decompressor.ts:decompress learn=test: src/decompressor.test.ts 'maxOutputSize above the 32-bit range is not wrapped'
2026-11-08T20:51:38Z s=698894d0 FINDING rust/*/src/lib.rs:compress_bytes|decompress_bytes learn=test: src/decompressor.test.ts Error-shape assertions for corrupt, truncated and over-limit input
2026-11-08T20:51:38Z s=698894d0 FINDING scripts/build.ts:buildInlinedModule learn=verifier: .vae/VERIFY.py rules build.no-hardcoded-wasm-bindgen-shims and src.no-hardcoded-wasm-bindgen-shims
2026-11-08T20:51:38Z s=698894d0 FINDING rust/Cargo.toml:profile.release learn=memory: .vae/MEMORY.md: wasm-opt -Oz raises gzip size; benchmark one build per process
2026-11-08T20:51:38Z s=698894d0 FINDING package.json:files learn=none: packed contents are exercised by make e2e
2026-11-08T20:51:38Z s=698894d0 FINDING bench/*.ts + README.md:Benchmarks learn=none: label text, not mechanically checkable without coupling to fixture size
2026-11-08T20:51:38Z s=698894d0 FINDING e2e/e2e.ts learn=verifier: gate tests.e2e.evidence requires fresh output/ files from make e2e
2026-11-08T20:51:38Z s=698894d0 FINDING README.md:Limits learn=none: prose review
2026-11-08T21:02:26Z s=698894d0 DONE fp=5fd2c5427c50 cov=94.0% paths=.github/workflows/verify.yml,AGENTS.md,ARCH.md,Makefile(+36)
2026-11-08T21:02:26Z s=698894d0 FINDING src/*-core.ts:initFrom learn=test: src/slim.test.ts 'rejects with the HTTP status ... and a later init() retries' fails with the reset removed (probe run)
2026-11-08T21:02:26Z s=698894d0 FINDING src/*-slim.ts:init JSDoc learn=none: doc wording, not mechanically checkable
2026-11-08T21:02:26Z s=698894d0 FINDING ARCH.md:Security and privacy learn=none: prose review
2026-11-08T21:02:26Z s=698894d0 FINDING README.md:Inlined or separate .wasm learn=none: prose review against make metrics
2026-11-08T21:10:10Z s=698894d0 FAIL env.example
2026-11-08T21:11:04Z s=698894d0 DONE fp=a866fc34b9ba cov=94.0% paths=.github/workflows/verify.yml,AGENTS.md,ARCH.md,Makefile(+39)
2026-11-08T21:11:04Z s=698894d0 FINDING e2e/web/vite-entry.mjs:expose learn=verifier: the gate's env.example check catches any new import.meta.env read
2026-11-08T21:11:04Z s=698894d0 FINDING src/*-slim.ts:init + README Bundlers learn=test: make e2e-vite and make e2e-bun fail unless both .wasm files are fetched with HTTP 200
2026-11-08T21:35:43Z s=698894d0 DONE fp=feee3e55c8d2 cov=94.0% paths=.github/workflows/verify.yml,AGENTS.md,ARCH.md,Makefile(+40)
2026-11-08T21:35:43Z s=698894d0 FINDING rust/decompressor/src/runtime.rs:Arena::reserve|bump learn=none: only reachable at the 4 GiB limit; a test would need 4 GiB of RAM, so the fix is reasoned, and the leak test exercises the out-of-memory path
2026-11-08T21:35:43Z s=698894d0 FINDING rust/decompressor/src/runtime.rs:Arena::dealloc learn=test: src/decompressor.test.ts leak test
2026-11-08T21:35:43Z s=698894d0 FINDING Makefile:lint learn=none: Makefile verb
2026-11-08T23:45:10Z s=698894d0 DONE fp=f1218cd35df8 cov=100.0% paths=.github/workflows/verify.yml,AGENTS.md,ARCH.md,Makefile(+52)
2026-11-08T23:45:10Z s=698894d0 FINDING README.md:Inlined or separate .wasm (B02) learn=verifier: make e2e (e2e-sizes) fails when an import exceeds size-budgets.json for any encoding
2026-11-08T23:45:10Z s=698894d0 FINDING src/*.ts uncovered paths learn=test: src/init.test.ts, src/slim.test.ts, src/slim.browser.test.ts, rust wasm_export_returns_the_core_result
2026-11-08T23:45:10Z s=698894d0 FINDING README examples (Quick Start, Decompression Options, init(source) forms, CDN, decompressor-only guarantee) learn=test: make e2e-runtime, e2e-cdn and the decompress-only apps in e2e-bun / e2e-vite (NO_ENCODER grep shown to flag the full bundles)
2026-11-08T23:45:10Z s=698894d0 FINDING vitest.config.ts:coverage.reporter learn=none: skipFull: false set; the gate output shows the row
2026-11-09T00:14:19Z s=698894d0 FAIL lint,tests.e2e.1
2026-11-09T00:15:16Z s=698894d0 FAIL tests.e2e.1
2026-11-09T04:19:01Z s=698894d0 DONE fp=05d69e847eb1 cov=100.0% paths=.github/workflows/verify.yml,AGENTS.md,ARCH.md,Makefile(+53)
2026-11-09T04:19:01Z s=698894d0 FINDING src/decompressor-core.ts, src/compressor-core.ts (whole-buffer wasm-bindgen calls) learn=test: src/memory.test.ts: a 64 MiB output and 32 MiB compress input need no more memory than 4 / 8 MiB ones; perf budgets in bench/perf-budgets.json cap wasm-memory-m
2026-11-09T04:19:01Z s=698894d0 FINDING rust/compressor/src/lib.rs:Encoder::new input chunk learn=test: chunked_output_matches_one_finish_call (all qualities, lgwin 10/16/22)
2026-11-09T04:19:01Z s=698894d0 FINDING size-budgets.json compressor/slim br11 learn=memory: MEMORY line [brotli q11 of compressor.wasm]
2026-11-09T04:19:01Z s=698894d0 FINDING README.md:5 'about 50 KB over Brotli HTTP' learn=none: both figures stated
2026-11-09T04:19:01Z s=698894d0 FINDING ARCH.md Security and privacy learn=none: documented with evidence
2026-11-09T04:19:01Z s=698894d0 FINDING src/memory.test.ts first draft learn=memory: MEMORY line [vitest toEqual on large typed arrays]
