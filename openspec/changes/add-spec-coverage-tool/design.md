## Context

The governed engine already computes everything per pair (`analyzePairDrift`: coverage states, binding drift, target validation, readiness blockers). What is missing is the repo-level aggregation, the reverse view (evidence → bindings → specs), and the conversational scaffolding that keeps both planes and their enforcement maintained as ideas enter the system. Coverage must be additive: no changes to drift semantics, no new gate that competes with `validate`/archive readiness.

## Goals / Non-Goals

**Goals:**
- One command that answers: how covered is the spec surface, with what strength, and where is the rot?
- Deterministic, documented JSON so agents can consume health directly.
- Orphan detection in both directions: enforcement without truth (stale/enforcement-only/broken) and evidence without enforcement (unbound files).
- Explore flow that walks behavior → architecture → enforcement and flags dual-plane ideas.

**Non-Goals:**
- No opaque health score; only factual counts and named states.
- No new archive/verify gate (only the opt-in `--strict` exit code).
- No cross-spec relationship graph; no changes to the drift engine or validate semantics.
- No legacy-model coverage (flat specs have no enforcement pairing).

## Decisions

### 1. Aggregator module over the existing engine

`src/core/artifact-graph/governed-coverage.ts` exposes `computeRepoCoverage(openspecRoot, projectRoot, options)`:
loads the repository once, runs `analyzeGovernedPair` per pair, and derives:

- **Per-spec record**: locator, stable id, plane, requirement/scenario counts, covered/hanging lists, binding strength histogram, and a single derived state with priority `incomplete-pair > broken > stale > hanging > degraded > complete`, where `degraded` means every requirement is covered but at least one only by review/manual evidence.
- **Rollups**: per plane and repo totals (specs by state, requirements covered %, strength histogram, orphan counts).
- **Reverse index**: normalized target path → [(spec, binding)] built from all bindings; powers orphan and unbound-evidence views.

Rationale: one traversal, pure derivation, trivially testable; the CLI renders, never computes.

### 2. Orphans and unbound evidence

`--orphans` reports three prune-candidate classes straight from the engine (stale bindings with the removed IDs they cover; enforcement-only pairs; broken targets) and one new class: with `--evidence <glob>` (repeatable), files matching the glob(s) under the project root that appear in no binding's `targets`. Matching uses the existing `fast-glob` dependency; paths are normalized to project-relative slash form before comparison. Unbound evidence is informational — it never affects `--strict` (a test may legitimately protect nothing spec-shaped yet).

### 3. Command surface and exit semantics

`openspec coverage [target]` — no target: summary; target (locator or stable id, resolved via `resolvePair`): drill-down. Flags: `--orphans`, `--evidence <glob>` (implies orphan view for the evidence section), `--json`, `--strict`. Exit 0 always, except `--strict` exits 1 when any spec state is not `complete`/`degraded` or any orphan class is non-empty. Legacy model: print "coverage requires the governed spec model (schema with specModel.kind: governed)" and exit 1. Registered as a top-level command; shares the root-selection conventions of list/validate.

### 4. JSON shape (the agent contract)

Stable top-level: `{ summary: { totals, planes, states, strengths }, specs: [...], orphans: { staleBindings, enforcementOnlyPairs, brokenTargets, unboundEvidence }, strict, valid }` — arrays sorted by locator/id; every record carries stable ids so agents can join against `validate`/`show` output. Documented in the command's spec delta; additive-only evolution.

### 5. Staged explore flow

`GOVERNED_EXPLORE_GUIDANCE` is rewritten (governed model only) into three named stages the agent walks conversationally — Behavior ("what observable outcome do you want, in which behavioral spec?"), Architecture ("what structure must stay true to build it; which packages/boundaries?"), Enforcement ("how will each claim be proven — test, lint, review — and at what strength?") — with a dual-plane classifier: if the idea changes what the system does AND how it must be structured, plan a spec pair in each plane and say so explicitly. The guidance opens with health awareness: run `openspec coverage --json` and factor existing rot/hanging claims into the discussion. Verify and apply guidance each gain a one-line pointer to `openspec coverage` as the health source. The explore skill's behavior is captured as the new `opsx-explore-skill` capability so projections stay parity-checked.

### 6. Legacy isolation

All new behavior is gated on the resolved spec model exactly like list/show/validate; the hash-locked skill-template parity test must pass unchanged; legacy CLI output is byte-identical.

## Risks / Trade-offs

- **`degraded` naming could read as judgmental** → it is defined factually (covered, but weakest evidence is review/manual) and documented in both text and JSON.
- **Unbound-evidence globs can false-positive** (helpers, fixtures) → informational only, opt-in, never gates.
- **Overlap with `validate`** → coverage is read-only reporting; validate keeps diagnostics/gating. The two share the engine so they cannot disagree.
