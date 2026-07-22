## Why

The governed spec model (introduce-enforced-spec-planes) makes enforcement coverage computable per pair, but nothing aggregates it: there is no single view of how much of the spec surface is protected, by what strength of evidence, or where enforcement has rotted. The Kairos pilot showed both failure directions at scale — stale bindings pointing at removed requirements, review-only specs quietly accumulating, and evidence files no binding references. Agents also lack a machine-readable health signal, and the governed explore flow classifies insights but does not walk an idea through behavior → architecture → enforcement, so dual-plane ideas get captured in one plane only.

## What Changes

- Add an `openspec coverage` command (governed model only) with three views:
  - repo summary: per-plane and per-spec rollups — requirements covered/hanging, evidence-strength mix (automated/review/manual), and a deterministic per-spec state (`complete | degraded | hanging | stale | broken | incomplete-pair`);
  - drill-down by locator or stable spec id: per-requirement/scenario → covering bindings → targets, strengths, and limitations;
  - orphan detection (`--orphans`): stale bindings, enforcement-only pairs, broken targets, plus an opt-in unbound-evidence scan (`--evidence <glob>`) reporting evidence files no binding references.
- `--json` on every view with a stable, documented, deterministic shape for agents; `--strict` exits non-zero when rot or orphans exist (CI gate); read-only otherwise (validate remains the archival gate).
- Rework the governed explore guidance into a staged discussion — (1) desired behavior, (2) architecture to build it, (3) enforcement for each claim — with an explicit dual-plane classifier and a health-first habit (consult `openspec coverage --json` before adding to the spec surface). Capture the explore skill as a first-class capability spec.
- Add one-line coverage pointers to the governed verify and apply guidance so workflow agents consume the same health signal.
- Legacy flat projects: `openspec coverage` reports that coverage requires the governed model; all legacy output remains byte-unchanged (hash-locked parity preserved).

## Capabilities

### New Capabilities

- `cli-coverage`: Aggregated enforcement-coverage views (summary, drill-down, orphans), agent-consumable JSON, and CI gating over the governed pair engine.
- `opsx-explore-skill`: The explore skill's governed behavior — staged behavior→architecture→enforcement discussion, dual-plane classification, and coverage-informed health awareness.

### Modified Capabilities

<!-- None: the governed workflow guidance touched here (explore/verify/apply pointers) is specified under the two capabilities above; enforced-spec-workflow is still an unarchived delta of introduce-enforced-spec-planes. -->

## Impact

- **New core module**: `src/core/artifact-graph/governed-coverage.ts` — aggregation layer over `loadGovernedRepository` + `analyzePairDrift`, plus a reverse target→binding index for orphan/unbound-evidence detection. No changes to the drift engine itself.
- **New command**: `src/commands/coverage.ts`, registered in `src/cli/index.ts`.
- **Templates**: `GOVERNED_EXPLORE_GUIDANCE` rewritten to the staged flow; small additive pointers in `GOVERNED_VERIFY_GUIDANCE` and `GOVERNED_APPLY_GUIDANCE`. Skill and command projections stay in parity; legacy output byte-identical.
- **Tests**: unit tests for the aggregator (states, histogram, orphans, unbound evidence, determinism), command tests (text + JSON + strict exit codes + legacy error), and guidance tests (governed-presence / legacy-absence).
