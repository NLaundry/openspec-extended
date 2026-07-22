## 1. Coverage Aggregator

- [x] 1.1 Add `src/core/artifact-graph/governed-coverage.ts`: `computeRepoCoverage` over `loadGovernedRepository` + `analyzeGovernedPair` — per-spec records (counts, strength histogram, derived state with priority incomplete-pair > broken > stale > hanging > degraded > complete), per-plane and repo rollups, deterministic ordering
- [x] 1.2 Build the reverse target→binding index and derive orphan classes: stale bindings (with removed covered IDs), enforcement-only pairs, broken targets
- [x] 1.3 Add opt-in unbound-evidence detection: fast-glob over `--evidence` patterns, normalized project-relative comparison against all binding targets
- [x] 1.4 Unit tests: state derivation per class, degraded semantics, histogram, orphans, unbound evidence, byte-deterministic output

## 2. Coverage Command

- [x] 2.1 Add `src/commands/coverage.ts` and register `openspec coverage [target]` in `src/cli/index.ts` with `--orphans`, `--evidence <glob>` (repeatable), `--json`, `--strict`
- [x] 2.2 Summary and drill-down rendering (target resolved by locator or stable ID via `resolvePair`); orphan view; documented stable JSON shape
- [x] 2.3 Exit semantics: 0 by default; `--strict` non-zero on non-complete/degraded states or non-evidence orphans; legacy model → explanatory error, exit non-zero
- [x] 2.4 Command tests: text + JSON views, strict exit codes, legacy error, determinism, drill-down by stable ID

## 3. Explore Flow and Workflow Integration

- [x] 3.1 Rewrite `GOVERNED_EXPLORE_GUIDANCE` into the staged behavior → architecture → enforcement flow with the dual-plane classifier and the coverage-first health check
- [x] 3.2 Add one-line `openspec coverage` pointers to `GOVERNED_VERIFY_GUIDANCE` and `GOVERNED_APPLY_GUIDANCE`
- [x] 3.3 Guidance tests: governed-presence and legacy-absence for the staged flow, classifier, and coverage pointers across skill and command projections; hash-locked parity test passes unchanged

## 4. Verification

- [x] 4.1 `pnpm build`, `pnpm test`, `pnpm lint` green; legacy output byte-identical
- [x] 4.2 Exercise the command against `test-project/` (complete/degraded/orphan fixtures) and confirm the Kairos-style views render sensibly
