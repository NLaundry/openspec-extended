import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { computeRepoCoverage } from '../../../src/core/artifact-graph/governed-coverage.js';

let tempDir: string;
let openspecRoot: string;

/** A valid governed spec.md declaring `id` plus one requirement/scenario. */
function specDoc(id: string): string {
  return `---\nid: ${id}\n---\n### Requirement: R\n**ID:** \`r\`\nThe system MUST do X.\n#### Scenario: S\n**ID:** \`s\`\n- **WHEN** a\n- **THEN** b\n`;
}

/** Enforcement covering requirement `r` with an active automated binding. */
function automatedEnforcement(id: string, target: string): string {
  return `# Enforcement\n\n\`\`\`yaml\nversion: 1\nspec: ${id}\nbindings:\n  - id: b\n    covers: [r]\n    mechanism: test\n    strength: automated\n    status: active\n    targets: [${target}]\n    run:\n      command: pnpm\n      args: [vitest, run, ${target}]\n      cwd: .\n\`\`\`\n`;
}

/** Enforcement covering `r` only with an active review binding. */
function reviewEnforcement(id: string): string {
  return `# Enforcement\n\n\`\`\`yaml\nversion: 1\nspec: ${id}\nbindings:\n  - id: rv\n    covers: [r]\n    mechanism: review\n    strength: review\n    status: active\n    review:\n      procedure: Inspect the module boundaries\n\`\`\`\n`;
}

/** Enforcement with no bindings — leaves requirement `r` hanging. */
function hangingEnforcement(id: string): string {
  return `# Enforcement\n\n\`\`\`yaml\nversion: 1\nspec: ${id}\nbindings: []\n\`\`\`\n`;
}

/** Enforcement whose binding also covers a nonexistent `gone` id (stale). */
function staleEnforcement(id: string, target: string): string {
  return `# Enforcement\n\n\`\`\`yaml\nversion: 1\nspec: ${id}\nbindings:\n  - id: b\n    covers: [r, gone]\n    mechanism: test\n    strength: automated\n    status: active\n    targets: [${target}]\n    run:\n      command: pnpm\n      args: [vitest, run, ${target}]\n      cwd: .\n\`\`\`\n`;
}

async function writePair(
  locator: string,
  opts: { spec?: string; enforcement?: string; target?: string }
): Promise<void> {
  const dir = path.join(tempDir, 'openspec', 'specs', ...locator.split('/'));
  await fs.mkdir(dir, { recursive: true });
  if (opts.spec !== undefined) await fs.writeFile(path.join(dir, 'spec.md'), opts.spec);
  if (opts.enforcement !== undefined)
    await fs.writeFile(path.join(dir, 'enforcement.md'), opts.enforcement);
  if (opts.target !== undefined) {
    const targetPath = path.join(tempDir, opts.target);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, '// target\n');
  }
}

beforeEach(async () => {
  tempDir = path.join(
    os.tmpdir(),
    `openspec-coverage-agg-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  openspecRoot = path.join(tempDir, 'openspec');
  await fs.mkdir(openspecRoot, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe('computeRepoCoverage — state derivation', () => {
  it('derives complete for a fully automated-covered pair', async () => {
    await writePair('behavior/session-loop', {
      spec: specDoc('behavior.session-loop'),
      enforcement: automatedEnforcement('behavior.session-loop', 'src/loop.test.ts'),
      target: 'src/loop.test.ts',
    });

    const coverage = await computeRepoCoverage(openspecRoot, tempDir);
    expect(coverage.specs).toHaveLength(1);
    const [spec] = coverage.specs;
    expect(spec.state).toBe('complete');
    expect(spec.locator).toBe('behavior/session-loop');
    expect(spec.specId).toBe('behavior.session-loop');
    expect(spec.plane).toBe('behavior');
    expect(spec.counts).toMatchObject({
      requirements: 1,
      coveredRequirements: 1,
      hangingRequirements: 0,
      scenarios: 1,
      coveredScenarios: 1,
      uncoveredScenarios: 0,
    });
    expect(spec.coveredRequirementIds).toEqual(['r']);
    expect(spec.strengths).toEqual({ automated: 1, review: 0, manual: 0 });
  });

  it('derives degraded when every requirement is covered but only by review/manual evidence', async () => {
    await writePair('architecture/domain', {
      spec: specDoc('architecture.domain'),
      enforcement: reviewEnforcement('architecture.domain'),
    });

    const coverage = await computeRepoCoverage(openspecRoot, tempDir);
    const [spec] = coverage.specs;
    expect(spec.state).toBe('degraded');
    expect(spec.weaklyCoveredRequirementIds).toEqual(['r']);
    expect(spec.strengths).toEqual({ automated: 0, review: 1, manual: 0 });
  });

  it('derives hanging, stale, broken, and incomplete-pair with the documented priority', async () => {
    await writePair('behavior/hanging', {
      spec: specDoc('behavior.hanging'),
      enforcement: hangingEnforcement('behavior.hanging'),
    });
    await writePair('behavior/stale', {
      spec: specDoc('behavior.stale'),
      enforcement: staleEnforcement('behavior.stale', 'src/stale.test.ts'),
      target: 'src/stale.test.ts',
    });
    await writePair('behavior/broken', {
      spec: specDoc('behavior.broken'),
      enforcement: automatedEnforcement('behavior.broken', 'src/missing.test.ts'),
      // target intentionally absent
    });
    await writePair('behavior/spec-only', { spec: specDoc('behavior.spec-only') });

    const coverage = await computeRepoCoverage(openspecRoot, tempDir);
    const stateByLocator = new Map(coverage.specs.map((s) => [s.locator, s.state]));
    expect(stateByLocator.get('behavior/hanging')).toBe('hanging');
    // stale outranks hanging (the binding covering `gone` still covers `r`)
    expect(stateByLocator.get('behavior/stale')).toBe('stale');
    // broken outranks stale/hanging
    expect(stateByLocator.get('behavior/broken')).toBe('broken');
    expect(stateByLocator.get('behavior/spec-only')).toBe('incomplete-pair');
  });
});

describe('computeRepoCoverage — rollups and histogram', () => {
  it('aggregates per-plane and repository totals with the strength histogram', async () => {
    await writePair('behavior/session-loop', {
      spec: specDoc('behavior.session-loop'),
      enforcement: automatedEnforcement('behavior.session-loop', 'src/loop.test.ts'),
      target: 'src/loop.test.ts',
    });
    await writePair('architecture/domain', {
      spec: specDoc('architecture.domain'),
      enforcement: reviewEnforcement('architecture.domain'),
    });

    const coverage = await computeRepoCoverage(openspecRoot, tempDir);
    expect(coverage.totals.specs).toBe(2);
    expect(coverage.totals.counts.requirements).toBe(2);
    expect(coverage.totals.counts.coveredRequirements).toBe(2);
    expect(coverage.totals.strengths).toEqual({ automated: 1, review: 1, manual: 0 });
    expect(coverage.totals.states.complete).toBe(1);
    expect(coverage.totals.states.degraded).toBe(1);

    expect(coverage.planes.behavior.specs).toBe(1);
    expect(coverage.planes.behavior.strengths.automated).toBe(1);
    expect(coverage.planes.architecture.specs).toBe(1);
    expect(coverage.planes.architecture.strengths.review).toBe(1);
  });
});

describe('computeRepoCoverage — orphans and reverse index', () => {
  it('reports stale bindings with removed IDs, enforcement-only pairs, and broken targets', async () => {
    await writePair('behavior/stale', {
      spec: specDoc('behavior.stale'),
      enforcement: staleEnforcement('behavior.stale', 'src/stale.test.ts'),
      target: 'src/stale.test.ts',
    });
    await writePair('behavior/enf-only', {
      enforcement: hangingEnforcement('behavior.enf-only'),
    });
    await writePair('behavior/broken', {
      spec: specDoc('behavior.broken'),
      enforcement: automatedEnforcement('behavior.broken', 'src/missing.test.ts'),
    });

    const coverage = await computeRepoCoverage(openspecRoot, tempDir);
    expect(coverage.orphans.staleBindings).toEqual([
      {
        locator: 'behavior/stale',
        specId: 'behavior.stale',
        bindingId: 'b',
        removedCoveredIds: ['gone'],
      },
    ]);
    expect(coverage.orphans.enforcementOnlyPairs).toEqual([
      { locator: 'behavior/enf-only', plane: 'behavior' },
    ]);
    expect(coverage.orphans.brokenTargets).toEqual([
      {
        locator: 'behavior/broken',
        specId: 'behavior.broken',
        bindingId: 'b',
        missingTargets: ['src/missing.test.ts'],
      },
    ]);
    expect(coverage.orphans.unboundEvidence).toEqual([]);

    const targets = coverage.targetIndex.map((entry) => entry.target);
    expect(targets).toEqual(['src/missing.test.ts', 'src/stale.test.ts']);
  });

  it('reports evidence files no binding references, and only when globs are given', async () => {
    await writePair('behavior/session-loop', {
      spec: specDoc('behavior.session-loop'),
      enforcement: automatedEnforcement('behavior.session-loop', 'src/loop.test.ts'),
      target: 'src/loop.test.ts',
    });
    const unbound = path.join(tempDir, 'src', 'orphaned.test.ts');
    await fs.writeFile(unbound, '// unreferenced evidence\n');

    const without = await computeRepoCoverage(openspecRoot, tempDir);
    expect(without.orphans.unboundEvidence).toEqual([]);

    const withGlobs = await computeRepoCoverage(openspecRoot, tempDir, {
      evidenceGlobs: ['src/**/*.test.ts'],
    });
    // The bound target is excluded; the unreferenced file is reported.
    expect(withGlobs.orphans.unboundEvidence).toEqual(['src/orphaned.test.ts']);
  });
});

describe('computeRepoCoverage — determinism', () => {
  it('produces byte-identical serialized output across two runs', async () => {
    await writePair('behavior/b-loop', {
      spec: specDoc('behavior.b-loop'),
      enforcement: automatedEnforcement('behavior.b-loop', 'src/b.test.ts'),
      target: 'src/b.test.ts',
    });
    await writePair('behavior/a-loop', {
      spec: specDoc('behavior.a-loop'),
      enforcement: hangingEnforcement('behavior.a-loop'),
    });
    await writePair('architecture/domain', {
      spec: specDoc('architecture.domain'),
      enforcement: reviewEnforcement('architecture.domain'),
    });

    const serialize = async () => {
      const coverage = await computeRepoCoverage(openspecRoot, tempDir, {
        evidenceGlobs: ['src/**/*.ts'],
      });
      const { repository, analyses, ...serializable } = coverage;
      return JSON.stringify(serializable);
    };

    const first = await serialize();
    const second = await serialize();
    expect(second).toBe(first);

    const parsed = JSON.parse(first);
    // Arrays are sorted by locator.
    expect(parsed.specs.map((s: { locator: string }) => s.locator)).toEqual([
      'architecture/domain',
      'behavior/a-loop',
      'behavior/b-loop',
    ]);
  });
});
