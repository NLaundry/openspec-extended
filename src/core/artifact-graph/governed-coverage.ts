/**
 * Repository-wide enforcement-coverage aggregation (add-spec-coverage-tool,
 * design decisions 1-2). This layers over the existing governed engine — one
 * `loadGovernedRepository` traversal plus `analyzeGovernedPair` per pair — and
 * only DERIVES: per-spec coverage records with a single deterministic state,
 * per-plane and repository rollups, a reverse target→binding index, and the
 * orphan classes (stale bindings, enforcement-only pairs, broken targets, and
 * the opt-in unbound-evidence scan). It never changes drift semantics and the
 * CLI renders from it without computing anything itself.
 */
import path from 'node:path';
import fg from 'fast-glob';
import {
  loadGovernedRepository,
  type GovernedRepository,
} from '../governed/index.js';
import { SPEC_PLANES, type SpecPlane } from './types.js';
import {
  analyzeGovernedPair,
  type GovernedPairAnalysis,
} from './governed-show.js';

/**
 * The single derived per-spec coverage state, in derivation priority order
 * `incomplete-pair > broken > stale > hanging > degraded > complete`.
 * `degraded` is factual, not judgmental: every requirement is covered, but at
 * least one requirement's only evidence is review or manual strength.
 */
export type SpecCoverageState =
  | 'complete'
  | 'degraded'
  | 'hanging'
  | 'stale'
  | 'broken'
  | 'incomplete-pair';

/** Complete-binding counts by evidence strength (unenforced never completes). */
export interface StrengthHistogram {
  automated: number;
  review: number;
  manual: number;
}

/** Requirement/scenario totals for one spec, plane, or the repository. */
export interface CoverageCounts {
  requirements: number;
  coveredRequirements: number;
  hangingRequirements: number;
  scenarios: number;
  coveredScenarios: number;
  uncoveredScenarios: number;
}

/** One governed pair's aggregated coverage record. */
export interface SpecCoverageRecord {
  locator: string;
  specId: string | null;
  plane: SpecPlane;
  state: SpecCoverageState;
  counts: CoverageCounts;
  /** Requirement IDs with at least one complete covering binding, sorted. */
  coveredRequirementIds: string[];
  /** Requirement IDs with no complete covering binding, sorted. */
  hangingRequirementIds: string[];
  /** Scenario IDs neither directly nor requirement-level covered, sorted. */
  uncoveredScenarioIds: string[];
  /**
   * Requirement IDs that are covered but whose covering bindings are all
   * review/manual strength (the degraded evidence set), sorted.
   */
  weaklyCoveredRequirementIds: string[];
  strengths: StrengthHistogram;
}

/** Rollup over a set of specs (one plane, or the whole repository). */
export interface CoverageRollup {
  specs: number;
  states: Record<SpecCoverageState, number>;
  counts: CoverageCounts;
  strengths: StrengthHistogram;
}

/** One entry of the reverse target→binding index. */
export interface TargetBindingRef {
  /** Project-relative, slash-normalized target path/selector. */
  target: string;
  locator: string;
  specId: string | null;
  bindingId: string;
}

/** A binding that still covers IDs removed from its paired spec. */
export interface StaleBindingOrphan {
  locator: string;
  specId: string | null;
  bindingId: string;
  /** Covered IDs no longer present in the paired spec, sorted. */
  removedCoveredIds: string[];
}

/** A pair with an enforcement.md but no spec.md (enforcement without truth). */
export interface EnforcementOnlyOrphan {
  locator: string;
  plane: SpecPlane;
}

/** An active binding whose declared targets are missing on disk. */
export interface BrokenTargetOrphan {
  locator: string;
  specId: string | null;
  bindingId: string;
  missingTargets: string[];
}

/** The prune-candidate classes. Reporting only — nothing is ever deleted. */
export interface RepoCoverageOrphans {
  staleBindings: StaleBindingOrphan[];
  enforcementOnlyPairs: EnforcementOnlyOrphan[];
  brokenTargets: BrokenTargetOrphan[];
  /**
   * Project-relative slash-normalized files matching the evidence globs that
   * appear in no binding's targets. Informational only: it never affects
   * `--strict`. Empty unless evidence globs were supplied.
   */
  unboundEvidence: string[];
}

export interface RepoCoverageOptions {
  /** Opt-in unbound-evidence scan: fast-glob patterns under the project root. */
  evidenceGlobs?: string[];
}

/** The full aggregated repository coverage view. */
export interface RepoCoverage {
  /** Per-spec records, sorted by locator. */
  specs: SpecCoverageRecord[];
  /** Repository rollup over every spec. */
  totals: CoverageRollup;
  /** Per-plane rollups (every plane present, even when empty). */
  planes: Record<SpecPlane, CoverageRollup>;
  /** Reverse index: sorted by target, then locator, then binding ID. */
  targetIndex: TargetBindingRef[];
  orphans: RepoCoverageOrphans;
  /** The loaded repository, for target resolution without a second traversal. */
  repository: GovernedRepository;
  /** Per-pair analyses by locator, for drill-down without re-analysis. */
  analyses: Map<string, GovernedPairAnalysis>;
  /** Specs whose state counts as rot (see {@link isRotState}), sorted by locator. */
  failingSpecs: SpecCoverageRecord[];
  /**
   * False when any spec state is rot or any non-evidence orphan class is
   * non-empty. Unbound evidence never affects validity. This is the single
   * owner of the strict-gate rule; the CLI only renders it.
   */
  valid: boolean;
}

/** All states, in derivation-priority order (highest priority first). */
export const SPEC_COVERAGE_STATES: readonly SpecCoverageState[] = [
  'incomplete-pair',
  'broken',
  'stale',
  'hanging',
  'degraded',
  'complete',
];

/**
 * True when a state counts as rot for strict gating. Owned here, next to the
 * state vocabulary, so every consumer (CLI, future gates) agrees: only
 * `complete` and `degraded` are non-rot.
 */
export function isRotState(state: SpecCoverageState): boolean {
  return state !== 'complete' && state !== 'degraded';
}

/**
 * Locale-independent codepoint comparison. The JSON contract promises
 * byte-identical output across runs AND machines; `localeCompare` collates by
 * host ICU locale, so it must not order contract arrays.
 */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Normalize a declared target to project-relative slash form for comparison. */
export function normalizeTargetPath(target: string): string {
  const slashed = target.replace(/\\/g, '/');
  const normalized = path.posix.normalize(slashed);
  return normalized.startsWith('./') ? normalized.slice(2) : normalized;
}

function emptyCounts(): CoverageCounts {
  return {
    requirements: 0,
    coveredRequirements: 0,
    hangingRequirements: 0,
    scenarios: 0,
    coveredScenarios: 0,
    uncoveredScenarios: 0,
  };
}

function emptyStrengths(): StrengthHistogram {
  return { automated: 0, review: 0, manual: 0 };
}

function emptyRollup(): CoverageRollup {
  const states = Object.fromEntries(
    SPEC_COVERAGE_STATES.map((state) => [state, 0])
  ) as Record<SpecCoverageState, number>;
  return { specs: 0, states, counts: emptyCounts(), strengths: emptyStrengths() };
}

function addToRollup(rollup: CoverageRollup, record: SpecCoverageRecord): void {
  rollup.specs += 1;
  rollup.states[record.state] += 1;
  rollup.counts.requirements += record.counts.requirements;
  rollup.counts.coveredRequirements += record.counts.coveredRequirements;
  rollup.counts.hangingRequirements += record.counts.hangingRequirements;
  rollup.counts.scenarios += record.counts.scenarios;
  rollup.counts.coveredScenarios += record.counts.coveredScenarios;
  rollup.counts.uncoveredScenarios += record.counts.uncoveredScenarios;
  rollup.strengths.automated += record.strengths.automated;
  rollup.strengths.review += record.strengths.review;
  rollup.strengths.manual += record.strengths.manual;
}

/**
 * Derive one pair's coverage record from its drift analysis. State priority is
 * `incomplete-pair > broken > stale > hanging > degraded > complete`, where
 * `degraded` means every requirement is covered but at least one only by
 * review/manual evidence.
 */
function deriveSpecRecord(analysis: GovernedPairAnalysis): SpecCoverageRecord {
  const { record } = analysis.analysis;
  const coverage = analysis.analysis.coverage;

  const strengthByBinding = new Map(
    coverage.bindings.map((b) => [b.id, b.strength])
  );

  const coveredRequirementIds: string[] = [];
  const weaklyCoveredRequirementIds: string[] = [];
  for (const requirement of coverage.requirements) {
    if (requirement.state !== 'covered') continue;
    coveredRequirementIds.push(requirement.id);
    const automated = requirement.coveredBy.some(
      (id) => strengthByBinding.get(id) === 'automated'
    );
    if (!automated) weaklyCoveredRequirementIds.push(requirement.id);
  }
  coveredRequirementIds.sort(compareStrings);
  weaklyCoveredRequirementIds.sort(compareStrings);

  const strengths = emptyStrengths();
  for (const binding of coverage.bindings) {
    if (!binding.complete) continue;
    if (binding.strength === 'automated') strengths.automated += 1;
    else if (binding.strength === 'review') strengths.review += 1;
    else if (binding.strength === 'manual') strengths.manual += 1;
  }

  const counts: CoverageCounts = {
    requirements: coverage.requirements.length,
    coveredRequirements: coveredRequirementIds.length,
    hangingRequirements: coverage.hangingRequirementIds.length,
    scenarios: coverage.scenarios.length,
    coveredScenarios:
      coverage.scenarios.length - coverage.uncoveredScenarioIds.length,
    uncoveredScenarios: coverage.uncoveredScenarioIds.length,
  };

  let state: SpecCoverageState;
  if (record.completeness !== 'complete') state = 'incomplete-pair';
  else if (coverage.brokenBindingIds.length > 0) state = 'broken';
  else if (coverage.staleBindingIds.length > 0) state = 'stale';
  else if (coverage.hangingRequirementIds.length > 0) state = 'hanging';
  else if (weaklyCoveredRequirementIds.length > 0) state = 'degraded';
  else state = 'complete';

  return {
    locator: record.locator,
    specId: analysis.analysis.specId,
    plane: record.plane,
    state,
    counts,
    coveredRequirementIds,
    hangingRequirementIds: [...coverage.hangingRequirementIds],
    uncoveredScenarioIds: [...coverage.uncoveredScenarioIds],
    weaklyCoveredRequirementIds,
    strengths,
  };
}

/**
 * The opt-in unbound-evidence scan: files under the project root matching the
 * evidence globs that appear in no binding's targets. Matching is by
 * project-relative slash-normalized path. Informational only.
 */
async function scanUnboundEvidence(
  projectRoot: string,
  globs: string[],
  boundTargets: ReadonlySet<string>
): Promise<string[]> {
  if (globs.length === 0) return [];
  const patterns = globs.map((glob) => glob.replace(/\\/g, '/'));
  const matches = await fg(patterns, {
    cwd: projectRoot,
    onlyFiles: true,
    dot: false,
  });
  const unbound = matches
    .map((match) => normalizeTargetPath(match))
    .filter((match) => !boundTargets.has(match));
  return [...new Set(unbound)].sort(compareStrings);
}

/**
 * Aggregate enforcement coverage across the whole governed repository: one
 * repository load, one `analyzeGovernedPair` per pair, pure derivation after
 * that. Every array in the result is deterministically sorted.
 */
export async function computeRepoCoverage(
  openspecRoot: string,
  projectRoot: string,
  options: RepoCoverageOptions = {}
): Promise<RepoCoverage> {
  const repository = await loadGovernedRepository(openspecRoot);

  const analyses = new Map<string, GovernedPairAnalysis>();
  const specs: SpecCoverageRecord[] = [];
  const staleBindings: StaleBindingOrphan[] = [];
  const enforcementOnlyPairs: EnforcementOnlyOrphan[] = [];
  const brokenTargets: BrokenTargetOrphan[] = [];
  const targetIndex: TargetBindingRef[] = [];

  // Pairs are independent; the only real I/O is each pair's target existence
  // checks, so analyze them concurrently. Deterministic ordering is restored by
  // the sorts below.
  const analyzed = await Promise.all(
    repository.discovery.pairs.map(async (record) => ({
      record,
      analysis: await analyzeGovernedPair({ repository, record, projectRoot }),
    }))
  );

  for (const { record, analysis } of analyzed) {
    analyses.set(record.locator, analysis);
    specs.push(deriveSpecRecord(analysis));

    if (record.completeness === 'enforcement-only') {
      enforcementOnlyPairs.push({ locator: record.locator, plane: record.plane });
    }

    for (const binding of analysis.analysis.coverage.bindings) {
      if (binding.staleCoveredIds.length > 0) {
        staleBindings.push({
          locator: record.locator,
          specId: analysis.analysis.specId,
          bindingId: binding.id,
          removedCoveredIds: [...binding.staleCoveredIds],
        });
      }
      if (binding.status === 'active' && binding.missingTargets.length > 0) {
        brokenTargets.push({
          locator: record.locator,
          specId: analysis.analysis.specId,
          bindingId: binding.id,
          missingTargets: [...binding.missingTargets],
        });
      }
    }

    for (const binding of analysis.enforcement.bindings) {
      for (const target of binding.targets) {
        targetIndex.push({
          target: normalizeTargetPath(target),
          locator: record.locator,
          specId: analysis.analysis.specId,
          bindingId: binding.id,
        });
      }
    }
  }

  specs.sort((a, b) => compareStrings(a.locator, b.locator));
  const byLocatorThenBinding = (
    a: { locator: string; bindingId: string },
    b: { locator: string; bindingId: string }
  ) =>
    compareStrings(a.locator, b.locator) ||
    compareStrings(a.bindingId, b.bindingId);
  staleBindings.sort(byLocatorThenBinding);
  brokenTargets.sort(byLocatorThenBinding);
  enforcementOnlyPairs.sort((a, b) => compareStrings(a.locator, b.locator));
  targetIndex.sort(
    (a, b) =>
      compareStrings(a.target, b.target) ||
      compareStrings(a.locator, b.locator) ||
      compareStrings(a.bindingId, b.bindingId)
  );

  const totals = emptyRollup();
  const planes = Object.fromEntries(
    SPEC_PLANES.map((plane) => [plane, emptyRollup()])
  ) as Record<SpecPlane, CoverageRollup>;
  for (const record of specs) {
    addToRollup(totals, record);
    addToRollup(planes[record.plane], record);
  }

  const boundTargets = new Set(targetIndex.map((entry) => entry.target));
  const unboundEvidence = await scanUnboundEvidence(
    projectRoot,
    options.evidenceGlobs ?? [],
    boundTargets
  );

  const failingSpecs = specs.filter((spec) => isRotState(spec.state));
  const valid =
    failingSpecs.length === 0 &&
    staleBindings.length === 0 &&
    enforcementOnlyPairs.length === 0 &&
    brokenTargets.length === 0;

  return {
    specs,
    totals,
    planes,
    targetIndex,
    orphans: { staleBindings, enforcementOnlyPairs, brokenTargets, unboundEvidence },
    repository,
    analyses,
    failingSpecs,
    valid,
  };
}
