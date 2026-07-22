/**
 * `openspec coverage` — aggregated enforcement-coverage views over the governed
 * pair engine (add-spec-coverage-tool, design decisions 3-4). Three views:
 * repository summary (no target), per-spec drill-down (locator or stable spec
 * ID), and orphan detection (`--orphans`, plus the opt-in `--evidence` scan).
 * Read-only reporting: exit 0 unless `--strict` finds rot, and the legacy flat
 * model is rejected with an explanatory error (coverage requires pairing).
 *
 * JSON is the agent contract: a stable top-level shape
 * `{ summary: { totals, planes, states, strengths }, specs, orphans, strict,
 * valid, root }` with every array deterministically sorted by locator/ID, so
 * agents can join records against `validate` and `show` output. Evolution is
 * additive-only.
 */
import path from 'node:path';
import {
  resolveRootForCommand,
  toRootOutput,
  type ResolvedOpenSpecRoot,
} from '../core/root-selection.js';
import { resolveProjectSpecModel } from '../core/shared/skill-generation.js';
import {
  computeRepoCoverage,
  type CoverageRollup,
  type RepoCoverage,
  type SpecCoverageRecord,
} from '../core/artifact-graph/governed-coverage.js';
import {
  resolveGovernedShowTarget,
  reportGovernedResolutionError,
  type GovernedBindingView,
  type GovernedPairAnalysis,
} from '../core/artifact-graph/governed-show.js';

export interface CoverageCommandOptions {
  orphans?: boolean;
  evidence?: string[];
  json?: boolean;
  strict?: boolean;
}

const LEGACY_MODEL_MESSAGE =
  'coverage requires the governed spec model (schema with specModel.kind: governed)';

/** One requirement's covering evidence in the drill-down views. */
interface RequirementCoverageDetail {
  id: string;
  title: string;
  state: string;
  coveredBy: GovernedBindingView[];
  scenarios: Array<{
    id: string;
    title: string;
    state: string;
    coveredBy: string[];
  }>;
}

/** The per-requirement/binding drill-down detail attached to one spec. */
interface DrillDownDetail {
  requirements: RequirementCoverageDetail[];
  bindings: GovernedBindingView[];
}

export class CoverageCommand {
  async execute(
    target: string | undefined,
    options: CoverageCommandOptions = {}
  ): Promise<void> {
    const root = await resolveRootForCommand({}, { json: options.json });
    if (!root) return;

    // Coverage is a governed-model view: flat legacy specs have no enforcement
    // pairing, so there is nothing to aggregate. Legacy output stays untouched.
    if (resolveProjectSpecModel(root.path).kind !== 'governed') {
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              status: [
                {
                  severity: 'error',
                  code: 'governed_model_required',
                  message: LEGACY_MODEL_MESSAGE,
                },
              ],
            },
            null,
            2
          )
        );
      } else {
        console.error(LEGACY_MODEL_MESSAGE);
      }
      process.exitCode = 1;
      return;
    }

    const coverage = await computeRepoCoverage(
      path.join(root.path, 'openspec'),
      root.path,
      { evidenceGlobs: options.evidence ?? [] }
    );

    // Resolve the drill-down target (plane-qualified locator, stable spec ID,
    // or unique unqualified basename) before rendering anything.
    let targetAnalysis: GovernedPairAnalysis | undefined;
    if (target) {
      const resolution = resolveGovernedShowTarget(coverage.repository, target);
      if (resolution.kind !== 'resolved') {
        reportGovernedResolutionError(target, resolution, options);
        process.exitCode = 1;
        return;
      }
      targetAnalysis = coverage.analyses.get(resolution.record.locator);
    }

    // The rot/validity rule is owned by the aggregator (isRotState + valid);
    // the CLI only renders and applies the exit code.
    const { failingSpecs, valid } = coverage;
    const strict = !!options.strict;

    if (options.json) {
      this.printJson(coverage, { strict, valid, targetAnalysis, root });
    } else if (targetAnalysis) {
      this.printDrillDown(coverage, targetAnalysis);
    } else {
      this.printSummary(coverage, {
        orphans: !!options.orphans || (options.evidence ?? []).length > 0,
        evidence: (options.evidence ?? []).length > 0,
      });
    }

    if (strict && !valid) {
      if (!options.json) this.printStrictFailures(coverage, failingSpecs);
      process.exitCode = 1;
      return;
    }
    process.exitCode = 0;
  }

  /**
   * Per-requirement/scenario drill-down detail: covering bindings (mechanism,
   * strength, status, targets, limitations) resolved by pair-local ID. Binding
   * views come from the shared `buildGovernedSpecView` merge (analysis.view),
   * so `show`, `spec`, and `coverage` cannot disagree on drift state.
   */
  private requirementDetail(analysis: GovernedPairAnalysis): DrillDownDetail {
    const bindings = analysis.view.bindings;
    const bindingById = new Map(bindings.map((b) => [b.id, b]));
    const coverage = analysis.analysis.coverage;
    const scenariosByRequirement = new Map<string, typeof coverage.scenarios>();
    for (const scenario of coverage.scenarios) {
      const bucket = scenariosByRequirement.get(scenario.requirementId) ?? [];
      bucket.push(scenario);
      scenariosByRequirement.set(scenario.requirementId, bucket);
    }
    const titleById = new Map<string, string>();
    for (const requirement of analysis.spec.requirements) {
      if (requirement.id) titleById.set(requirement.id, requirement.title);
      for (const scenario of requirement.scenarios) {
        if (scenario.id) titleById.set(scenario.id, scenario.title);
      }
    }

    const requirements = coverage.requirements.map((requirement) => ({
      id: requirement.id,
      title: titleById.get(requirement.id) ?? requirement.id,
      state: requirement.state,
      coveredBy: requirement.coveredBy
        .map((id) => bindingById.get(id))
        .filter((b): b is GovernedBindingView => b !== undefined),
      scenarios: (scenariosByRequirement.get(requirement.id) ?? []).map(
        (scenario) => ({
          id: scenario.id,
          title: titleById.get(scenario.id) ?? scenario.id,
          state: scenario.state,
          coveredBy: [...scenario.coveredBy],
        })
      ),
    }));

    return { requirements, bindings };
  }

  private specJson(
    record: SpecCoverageRecord,
    detail: DrillDownDetail | undefined
  ): Record<string, unknown> {
    const base: Record<string, unknown> = {
      locator: record.locator,
      specId: record.specId,
      plane: record.plane,
      state: record.state,
      counts: record.counts,
      coveredRequirementIds: record.coveredRequirementIds,
      hangingRequirementIds: record.hangingRequirementIds,
      uncoveredScenarioIds: record.uncoveredScenarioIds,
      weaklyCoveredRequirementIds: record.weaklyCoveredRequirementIds,
      strengths: record.strengths,
    };
    if (detail) {
      base.requirements = detail.requirements;
      base.bindings = detail.bindings;
    }
    return base;
  }

  private printJson(
    coverage: RepoCoverage,
    context: {
      strict: boolean;
      valid: boolean;
      targetAnalysis: GovernedPairAnalysis | undefined;
      root: ResolvedOpenSpecRoot;
    }
  ): void {
    const { strict, valid, targetAnalysis, root } = context;
    // Decide the drill-down target ONCE: filter and detail-attachment share the
    // same locator, so the documented shape cannot lose its detail keys.
    const targetLocator = targetAnalysis?.analysis.record.locator;
    const detail = targetAnalysis
      ? this.requirementDetail(targetAnalysis)
      : undefined;
    const records =
      targetLocator === undefined
        ? coverage.specs
        : coverage.specs.filter((spec) => spec.locator === targetLocator);

    const rollupJson = (rollup: CoverageRollup) => ({
      specs: rollup.specs,
      states: rollup.states,
      counts: rollup.counts,
      strengths: rollup.strengths,
    });

    const output = {
      summary: {
        totals: { specs: coverage.totals.specs, ...coverage.totals.counts },
        planes: {
          behavior: rollupJson(coverage.planes.behavior),
          architecture: rollupJson(coverage.planes.architecture),
        },
        states: coverage.totals.states,
        strengths: coverage.totals.strengths,
      },
      specs: records.map((record) =>
        this.specJson(record, record.locator === targetLocator ? detail : undefined)
      ),
      orphans: coverage.orphans,
      strict,
      valid,
      root: toRootOutput(root),
    };
    console.log(JSON.stringify(output, null, 2));
  }

  private formatStrengths(strengths: SpecCoverageRecord['strengths']): string {
    return `automated ${strengths.automated}, review ${strengths.review}, manual ${strengths.manual}`;
  }

  private printSummary(
    coverage: RepoCoverage,
    view: { orphans: boolean; evidence: boolean }
  ): void {
    if (coverage.specs.length === 0) {
      console.log('No governed specs found.');
    } else {
      console.log('Coverage:');
      const locatorWidth = Math.max(...coverage.specs.map((s) => s.locator.length));
      const idWidth = Math.max(...coverage.specs.map((s) => (s.specId ?? '-').length));
      for (const spec of coverage.specs) {
        const locator = spec.locator.padEnd(locatorWidth);
        const id = (spec.specId ?? '-').padEnd(idWidth);
        console.log(
          `  ${locator}   id ${id}   requirements ${spec.counts.coveredRequirements}/${spec.counts.requirements}` +
            `   [${this.formatStrengths(spec.strengths)}]   ${spec.state}`
        );
      }

      console.log('');
      console.log('Planes:');
      for (const plane of ['behavior', 'architecture'] as const) {
        const rollup = coverage.planes[plane];
        console.log(
          `  ${plane.padEnd('architecture'.length)}   specs ${rollup.specs}` +
            `   requirements ${rollup.counts.coveredRequirements}/${rollup.counts.requirements}` +
            `   [${this.formatStrengths(rollup.strengths)}]`
        );
      }

      const t = coverage.totals;
      const stateSummary = (Object.entries(t.states) as [string, number][])
        .filter(([, count]) => count > 0)
        .map(([state, count]) => `${state} ${count}`)
        .join(', ');
      console.log('');
      console.log(
        `Repository: specs ${t.specs}   requirements ${t.counts.coveredRequirements}/${t.counts.requirements}` +
          `   scenarios ${t.counts.coveredScenarios}/${t.counts.scenarios}` +
          `   states: ${stateSummary || '(none)'}`
      );
    }

    if (view.orphans) this.printOrphans(coverage, view.evidence);
  }

  private printOrphans(coverage: RepoCoverage, evidence: boolean): void {
    const { orphans } = coverage;
    console.log('');
    console.log('Orphans (prune candidates - nothing is deleted):');

    console.log('  Stale bindings:');
    if (orphans.staleBindings.length === 0) console.log('    (none)');
    for (const stale of orphans.staleBindings) {
      console.log(
        `    - ${stale.locator} binding ${stale.bindingId} covers removed: ${stale.removedCoveredIds.join(', ')}`
      );
    }

    console.log('  Enforcement-only pairs:');
    if (orphans.enforcementOnlyPairs.length === 0) console.log('    (none)');
    for (const pair of orphans.enforcementOnlyPairs) {
      console.log(`    - ${pair.locator} (${pair.plane})`);
    }

    console.log('  Broken targets:');
    if (orphans.brokenTargets.length === 0) console.log('    (none)');
    for (const broken of orphans.brokenTargets) {
      console.log(
        `    - ${broken.locator} binding ${broken.bindingId} missing: ${broken.missingTargets.join(', ')}`
      );
    }

    if (evidence) {
      console.log('  Unbound evidence (informational, never gates):');
      if (orphans.unboundEvidence.length === 0) console.log('    (none)');
      for (const file of orphans.unboundEvidence) {
        console.log(`    - ${file}`);
      }
    }
  }

  private printDrillDown(
    coverage: RepoCoverage,
    analysis: GovernedPairAnalysis
  ): void {
    const locator = analysis.analysis.record.locator;
    const record = coverage.specs.find((spec) => spec.locator === locator);
    if (!record) return;
    const detail = this.requirementDetail(analysis);

    console.log(`Coverage: ${locator}`);
    console.log(`  spec id: ${record.specId ?? '(none)'}`);
    console.log(`  plane:   ${record.plane}`);
    console.log(`  state:   ${record.state}`);
    console.log(
      `  requirements ${record.counts.coveredRequirements}/${record.counts.requirements}` +
        `   scenarios ${record.counts.coveredScenarios}/${record.counts.scenarios}` +
        `   [${this.formatStrengths(record.strengths)}]`
    );

    console.log('');
    if (detail.requirements.length === 0) {
      console.log('Requirements: (none)');
    } else {
      console.log('Requirements:');
      for (const requirement of detail.requirements) {
        console.log(`  - ${requirement.id} (${requirement.title}) [${requirement.state}]`);
        for (const binding of requirement.coveredBy) {
          const targets =
            binding.targets.length > 0
              ? `  targets ${binding.targets.join(', ')}`
              : '';
          console.log(
            `      covered by ${binding.id} [${binding.mechanism}/${binding.strength}/${binding.status}]${targets}`
          );
          if (binding.limitations) {
            console.log(`        limitations: ${binding.limitations}`);
          }
        }
        for (const scenario of requirement.scenarios) {
          const by =
            scenario.coveredBy.length > 0
              ? ` by ${scenario.coveredBy.join(', ')}`
              : '';
          console.log(
            `      scenario ${scenario.id} (${scenario.title}) [${scenario.state}${by}]`
          );
        }
      }
    }

    console.log('');
    console.log(
      `Hanging requirements: ${record.hangingRequirementIds.join(', ') || '(none)'}`
    );
    console.log(
      `Uncovered scenarios: ${record.uncoveredScenarioIds.join(', ') || '(none)'}`
    );
  }

  /** Name every offending spec and binding when `--strict` fails (CI rot gate). */
  private printStrictFailures(
    coverage: RepoCoverage,
    failingSpecs: SpecCoverageRecord[]
  ): void {
    console.error('');
    console.error('Strict: coverage rot detected.');
    for (const spec of failingSpecs) {
      const detail: string[] = [];
      if (spec.hangingRequirementIds.length > 0) {
        detail.push(`hanging requirements: ${spec.hangingRequirementIds.join(', ')}`);
      }
      console.error(
        `  - ${spec.locator}: ${spec.state}${detail.length > 0 ? ` (${detail.join('; ')})` : ''}`
      );
    }
    for (const stale of coverage.orphans.staleBindings) {
      console.error(
        `  - stale binding ${stale.bindingId} in ${stale.locator} covers removed: ${stale.removedCoveredIds.join(', ')}`
      );
    }
    for (const pair of coverage.orphans.enforcementOnlyPairs) {
      console.error(`  - enforcement-only pair ${pair.locator}`);
    }
    for (const broken of coverage.orphans.brokenTargets) {
      console.error(
        `  - broken binding ${broken.bindingId} in ${broken.locator} missing: ${broken.missingTargets.join(', ')}`
      );
    }
  }
}
