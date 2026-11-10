# Episodes

<!-- Newest last. The gate appends FAIL|DONE|FINDING; past 100 entries it trims only its own oldest DONE|FAIL|learned
FINDING (git keeps them). Leads (LESSON, FINDING learn=none) stay until wrap settles them; doctor fails above 30.
Agents append `<UTC ISO> s=<session> LESSON <VAE-DIALECT>` only for a falsified HYPOTHESIS, a dead end, or a root cause.
Session start injects the 3 newest open entries: LESSON, FINDING learn=none, FAIL without a later DONE.
Wrap: EVERY lead becomes a test | .vae/VERIFY.py rule | one MEMORY line with BC, then delete; OR delete BC evidence. -->

2026-11-08T20:51:38Z s=698894d0 FINDING scripts/build.ts:wasm-opt step learn=none: build fails loudly on recurrence (wasm-opt exits non-zero), no silent path left
2026-11-08T20:51:38Z s=698894d0 FINDING package.json:files learn=none: packed contents are exercised by make e2e
2026-11-08T20:51:38Z s=698894d0 FINDING bench/*.ts + README.md:Benchmarks learn=none: label text, not mechanically checkable without coupling to fixture size
2026-11-08T20:51:38Z s=698894d0 FINDING README.md:Limits learn=none: prose review
2026-11-08T21:02:26Z s=698894d0 FINDING src/*-slim.ts:init JSDoc learn=none: doc wording, not mechanically checkable
2026-11-08T21:02:26Z s=698894d0 FINDING ARCH.md:Security and privacy learn=none: prose review
2026-11-08T21:02:26Z s=698894d0 FINDING README.md:Inlined or separate .wasm learn=none: prose review against make metrics
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
2026-11-09T09:08:49Z s=698894d0 DONE fp=ae9da35c5f82 cov=100.0% paths=scripts/build.ts
2026-11-09T09:08:49Z s=698894d0 FINDING scripts/build.ts:run (child process PATH) learn=verifier: .vae/VERIFY.py rule build.tools-without-mise-activation
2026-11-09T10:38:51Z s=698894d0 DONE fp=aca1737d4967 cov=100.0% paths=ARCH.md,README.md,package.json,scripts/build.ts
2026-11-09T10:38:51Z s=698894d0 FINDING package.json:files THIRD_PARTY_NOTICES.md learn=verifier: .vae/VERIFY.py rule package.files-exist (fails on the old entry)
2026-11-09T10:38:51Z s=698894d0 FINDING package.json:version 0.1.3 learn=none: release decision, not a recurring defect
2026-11-09T11:59:52Z s=698894d0 DONE fp=44e28770f52a cov=100.0% paths=ARCH.md,Makefile,README.md,e2e/cli.mjs(+7)
2026-11-09T11:59:52Z s=698894d0 FINDING src/cli.ts:processFile learn=none: no public behavior differs (init is idempotent); only the redundant read, which a test could observe only through a spy
2026-11-09T11:59:52Z s=698894d0 FINDING src/cli-args.ts:parseCli learn=test: cli.test.ts rejects ["-o","-x"] with the one-line message
2026-11-09T11:59:52Z s=698894d0 FINDING README.md:80 B learn=none: doc claim corrected against the probe output
2026-11-09T11:59:52Z s=698894d0 FINDING README.md:82 B learn=none: doc claim narrowed to the measured set
2026-11-09T11:59:52Z s=698894d0 FINDING ARCH.md:31 B learn=memory: .vae/MEMORY.md brotli 1.2.0 CLI line
2026-11-09T12:13:42Z s=698894d0 DONE fp=6d84d32a3394 cov=100.0% paths=ARCH.md,Makefile,README.md,e2e/cli.mjs(+9)
2026-11-09T12:13:42Z s=698894d0 FINDING ARCH.md:74 B learn=none: doc corrected from a measurement; memory figures are machine-independent but input-dependent, so no test pins them
2026-11-09T12:13:42Z s=698894d0 FINDING ARCH.md:38 B01 learn=verifier: vae prose B01 already rejects it
2026-11-09T12:13:42Z s=698894d0 FINDING src/compressor-core.ts:DEFAULT_QUALITY learn=test: compressor normalizeOptions default test
2026-11-09T13:20:37Z s=698894d0 DONE fp=87a468ec57c6 cov=96.7% paths=ARCH.md,CHANGELOG.md,Makefile,README.md(+22)
2026-11-09T13:20:37Z s=698894d0 FINDING src/compressor-core.ts:compressParallel learn=test: compressor.test.ts 'leaves a Buffer input intact'
2026-11-09T13:20:37Z s=698894d0 FINDING src/bin.ts:process.exit learn=memory: .vae/MEMORY.md Bun exit line; timing is not a stable test contract
2026-11-09T13:20:37Z s=698894d0 FINDING README.md:161 B, src/workers.ts:3, src/compressor-core.ts:compressParallel, ARCH.md:42 B learn=memory: .vae/MEMORY.md Deno line
2026-11-09T13:20:37Z s=698894d0 FINDING README.md:3-12 P learn=none: doc numbers corrected to the medians
2026-11-09T13:20:37Z s=698894d0 FINDING ARCH.md:40 B learn=none: doc corrected against the probe output
2026-11-09T13:20:37Z s=698894d0 FINDING src/compressor.test.ts:compressParallel learn=none: tests assert verified requirements only
2026-11-09T13:20:37Z s=698894d0 FINDING CHANGELOG.md:27 B learn=none: release notes state only what the history shows
2026-11-09T14:59:29Z s=698894d0 FAIL coverage
2026-11-09T15:06:24Z s=698894d0 DONE fp=ef5fd9d0c01d cov=96.1% paths=ARCH.md,CHANGELOG.md,Makefile,README.md(+35)
2026-11-09T15:06:24Z s=698894d0 FINDING src/compressor-core.ts:partRanges learn=test: src/compressor.test.ts 'compresses the SVG fixture at every quality' and the site e2e quality-5 check
2026-11-09T15:06:24Z s=698894d0 FINDING src/compressor-encode.ts:encodeWith learn=none: a trap cannot be produced on demand without the upstream bug; covered indirectly
2026-11-09T15:06:24Z s=698894d0 FINDING site/ui/demos.ts:runCompress learn=test: site/e2e.mjs 'compress demo: File without a file uses the sample'
2026-11-09T15:06:24Z s=698894d0 FINDING site/ui/demos.ts:RUNNERS learn=test: site/e2e.mjs race check counts exactly one busy period despite Ctrl+Enter
2026-11-09T15:06:24Z s=698894d0 FINDING site/ui/perf.ts:render learn=none: UI state; low risk, no deterministic check worth its cost
2026-11-09T15:06:24Z s=698894d0 FINDING site/ui/perf.ts:mount learn=test: site/e2e.mjs German run switches languages and asserts no console errors
2026-11-09T15:06:24Z s=698894d0 FINDING site/ui/shared.ts:countUp learn=none: visual; the e2e runs with reduced motion
2026-11-09T15:06:24Z s=698894d0 FINDING site/assets/site.css:.run-btn .kbd learn=test: site/e2e.mjs axe WCAG 2.1 AA in light and dark
2026-11-09T15:06:24Z s=698894d0 FINDING site/code.ts:CONTRAST learn=test: axe contrast in site/e2e.mjs
2026-11-09T15:06:24Z s=698894d0 FINDING site/page.html:usps learn=none: prose review; facts traced to README/probes
2026-11-09T15:06:24Z s=698894d0 FINDING site/build.ts:fonts learn=none: license hygiene
2026-11-09T15:06:24Z s=698894d0 FINDING CHANGELOG.md:Fixed (T/P precision) learn=none: page precision
2026-11-09T17:03:31Z s=698894d0 DONE fp=9d9d9be6eb53 cov=96.1% paths=ARCH.md,CHANGELOG.md,Makefile,README.md(+35)
2026-11-09T17:24:01Z s=698894d0 DONE fp=079f743d2ec4 cov=96.1% paths=ARCH.md,CHANGELOG.md,Makefile,README.md(+35)
2026-11-09T17:24:01Z s=698894d0 FINDING site/assets/site.css:.hero-title learn=test: site/e2e.mjs 'hero box, footnote, six cards, services without anchor' asserts the title box ends left of the hero box
2026-11-09T17:24:01Z s=698894d0 FINDING site/page.html hero copy learn=test: site/e2e.mjs asserts the footnote text 'Files from 1 MiB at quality 11'
2026-11-09T17:24:01Z s=698894d0 FINDING site/ui/demos.ts:renderCompress learn=none: wording only; the e2e language switch covers re-rendering of script-written text
2026-11-09T17:24:01Z s=698894d0 FINDING site/assets/site.css:.pack learn=test: site/e2e.mjs hero check and the axe-core check
2026-11-09T20:04:43Z s=698894d0 FAIL hygiene.probes
2026-11-09T20:22:19Z s=698894d0 FAIL lint
2026-11-09T21:06:24Z s=698894d0 DONE fp=3e916d6cdc99 cov=95.8% paths=ARCH.md,CHANGELOG.md,README.md,docs/assets/lib/compressor-slim.js(+19)
2026-11-09T21:06:24Z s=698894d0 FINDING site/lib/callcode.ts:TOKEN learn=test: site/lib/site.test.ts 'the call lines the demos print get Shiki's colours on every character'
2026-11-09T21:06:24Z s=698894d0 FINDING site/build.ts:CALL learn=test: site/e2e.mjs 'page opened from disk' check
2026-11-09T21:06:24Z s=698894d0 FINDING src/compressor-core.ts:partRanges learn=test: src/compressor.test.ts layout test pins 8 parts to 64 MiB, 9 above, 16 x 8 MiB at 128 MiB, 32 KiB floor at window 10
2026-11-09T21:06:24Z s=698894d0 FINDING src/workers.ts:runParts dispatch learn=none: allocation failure is not reproducible in a test without mocks; the path is a two-line catch
2026-11-09T21:06:24Z s=698894d0 FINDING src/compressor-core.ts:compressParallel learn=none: documented contract; the CLI awaits each file and never reuses the buffer
2026-11-09T21:06:24Z s=698894d0 FINDING site/measure.mjs:timed learn=none: comment in site/measure.mjs records the measurement; a timing threshold test would pin env values
2026-11-09T21:06:24Z s=698894d0 FINDING site/lib/charts.ts:KEYS learn=verifier: make lint in the gate
2026-11-09T21:06:24Z s=698894d0 FINDING README.md:threads learn=none: one-off unit slip
2026-11-09T21:20:55Z s=698894d0 DONE fp=52dba3bd1fc1 cov=95.8% paths=ARCH.md,CHANGELOG.md,README.md,docs/assets/lib/compressor-slim.js(+20)
2026-11-09T21:20:55Z s=698894d0 FINDING package.json:version learn=none: release metadata, no code path changed
2026-11-09T21:23:30Z s=698894d0 DONE fp=a091d6acb1f4 cov=95.9% paths=ARCH.md,CHANGELOG.md,README.md,docs/assets/lib/compressor-slim.js(+20)
2026-11-09T21:23:30Z s=698894d0 FINDING site/lib/charts.ts:CHART_FROM_QUALITY learn=test: site/lib/site.test.ts speed view test
2026-11-09T21:32:48Z s=698894d0 DONE fp=028eafe1e90e cov=95.9% paths=Makefile
2026-11-09T21:32:48Z s=698894d0 FINDING Makefile:lint learn=verifier: .vae/VERIFY.py rule ci.lint-builds-first; it does not match the previous Makefile
2026-11-09T21:51:40Z s=698894d0 DONE fp=a9b9af7dd4ed cov=95.9% paths=README.md,docs/assets/site.js,docs/index.html,site/e2e.mjs(+2)
2026-11-09T21:51:40Z s=698894d0 FINDING site/ui/demos.ts:MAX_FILE learn=test: site/e2e.mjs compresses an 80 MiB file (above the former limit) and checks the .br download
2026-11-09T21:51:40Z s=698894d0 FINDING site/ui/demos.ts:gzip learn=none: memory behaviour; covered functionally by the e2e runs that show the gzip bar
2026-11-09T21:51:40Z s=698894d0 FINDING site/ui/demos.ts:equal learn=none: performance detail, observed in the 1 GiB run
2026-11-09T21:51:40Z s=698894d0 FINDING site/ui/demos.ts:runDecompress learn=test: the e2e decompresses the 80 MiB result as 'last compress result'
2026-11-09T21:51:40Z s=698894d0 FINDING site/ui/demos.ts:autoRun learn=test: site/e2e.mjs checks the idle state, no result before a click, and that choosing a file starts a run
2026-11-09T21:51:40Z s=698894d0 FINDING site/ui/demos.ts:runCompress status learn=none: UI text, seen in the 1 GiB run
2026-11-09T21:51:40Z s=698894d0 FINDING site/page.html:51 KB learn=none: wording
2026-11-10T00:00:56Z s=698894d0 DONE fp=30b93cb6bc4b cov=95.9% paths=README.md,docs/assets/site.js,docs/index.html,mise.toml(+3)
2026-11-10T00:00:56Z s=698894d0 FINDING mise.toml:github:taiki-e/cargo-llvm-cov learn=verifier: .vae/VERIFY.py ci.llvm-cov-pinned requires the pin in mise.toml
2026-11-10T00:02:45Z s=698894d0 DONE fp=a9b9af7dd4ed cov=95.9% paths=README.md,docs/assets/site.js,docs/index.html,site/e2e.mjs(+2)
2026-11-10T00:11:44Z s=698894d0 DONE fp=8aaf7b9b7fb1 cov=95.9% paths=README.md,docs/assets/site.js,docs/index.html,site/e2e.mjs(+2)
2026-11-10T00:11:44Z s=698894d0 FINDING site/page.html (edit run page-2026-11-10T00-03-27-470Z-54c5b4) learn=test: site/e2e.mjs asserts the hero footnote and the perf lead in their new wording
2026-11-10T00:27:29Z s=698894d0 DONE fp=bf6dbbac9040 cov=95.9% paths=README.md,docs/assets/site.js,docs/index.html,site/e2e.mjs(+3)
2026-11-10T00:27:29Z s=698894d0 FINDING site/page.html:141,217,475,542,653; site/ui/perf.ts:setupPerf learn=none: wording decided by the human; the open question about the 5.3x claim goes to the review page, no mechanical check applies
