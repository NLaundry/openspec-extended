import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { CoverageCommand } from '../../src/commands/coverage.js';

const GOVERNED_SCHEMA = 'spec-driven-governed';
const LEGACY_SCHEMA = 'spec-driven';

let tempDir: string;
let originalCwd: string;
let originalLog: typeof console.log;
let originalError: typeof console.error;
let logOutput: string[];
let errOutput: string[];

/** A valid governed spec.md declaring `id` plus one requirement/scenario. */
function specDoc(id: string): string {
  return `---\nid: ${id}\n---\n### Requirement: R\n**ID:** \`r\`\nThe system MUST do X.\n#### Scenario: S\n**ID:** \`s\`\n- **WHEN** a\n- **THEN** b\n`;
}

/** Enforcement covering requirement `r` with an active automated binding. */
function automatedEnforcement(id: string, target: string): string {
  return `# Enforcement\n\n\`\`\`yaml\nversion: 1\nspec: ${id}\nbindings:\n  - id: b\n    covers: [r]\n    mechanism: test\n    strength: automated\n    status: active\n    targets: [${target}]\n    run:\n      command: pnpm\n      args: [vitest, run, ${target}]\n      cwd: .\n\`\`\`\n`;
}

/** Enforcement covering `r` with a review binding declaring limitations. */
function reviewEnforcement(id: string): string {
  return `# Enforcement\n\n\`\`\`yaml\nversion: 1\nspec: ${id}\nbindings:\n  - id: rv\n    covers: [r]\n    mechanism: review\n    strength: review\n    status: active\n    limitations: Reviewer availability\n    review:\n      procedure: Inspect the module boundaries\n\`\`\`\n`;
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

async function writeConfig(schema: string): Promise<void> {
  const openspec = path.join(tempDir, 'openspec');
  await fs.mkdir(openspec, { recursive: true });
  await fs.writeFile(path.join(openspec, 'config.yaml'), `schema: ${schema}\n`);
}

async function runCoverage(
  target: string | undefined,
  options: Record<string, unknown> = {}
): Promise<void> {
  await new CoverageCommand().execute(target, options as never);
}

beforeEach(async () => {
  tempDir = path.join(
    os.tmpdir(),
    `openspec-coverage-cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await fs.mkdir(tempDir, { recursive: true });
  originalCwd = process.cwd();
  process.chdir(tempDir);
  originalLog = console.log;
  originalError = console.error;
  logOutput = [];
  errOutput = [];
  console.log = (...args: unknown[]) => logOutput.push(args.join(' '));
  console.error = (...args: unknown[]) => errOutput.push(args.join(' '));
});

afterEach(async () => {
  console.log = originalLog;
  console.error = originalError;
  process.chdir(originalCwd);
  process.exitCode = 0;
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe('coverage — repository summary', () => {
  it('reports every governed pair with locator, id, plane totals, strengths, and state', async () => {
    await writeConfig(GOVERNED_SCHEMA);
    await writePair('behavior/session-loop', {
      spec: specDoc('behavior.session-loop'),
      enforcement: automatedEnforcement('behavior.session-loop', 'src/loop.test.ts'),
      target: 'src/loop.test.ts',
    });
    await writePair('architecture/domain', {
      spec: specDoc('architecture.domain'),
      enforcement: reviewEnforcement('architecture.domain'),
    });

    await runCoverage(undefined);

    const out = logOutput.join('\n');
    expect(out).toContain('Coverage:');
    const loopLine = logOutput.find((l) => l.includes('behavior/session-loop'));
    expect(loopLine).toContain('id behavior.session-loop');
    expect(loopLine).toContain('requirements 1/1');
    expect(loopLine).toContain('automated 1');
    expect(loopLine).toContain('complete');
    const domainLine = logOutput.find((l) => l.includes('architecture/domain'));
    expect(domainLine).toContain('degraded');
    expect(out).toContain('Planes:');
    expect(out).toContain('Repository: specs 2');
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('exits 0 with rot present when --strict is not given (read-only reporting)', async () => {
    await writeConfig(GOVERNED_SCHEMA);
    await writePair('behavior/session-loop', {
      spec: specDoc('behavior.session-loop'),
      enforcement: hangingEnforcement('behavior.session-loop'),
    });

    await runCoverage(undefined);

    expect(logOutput.join('\n')).toContain('hanging');
    expect(process.exitCode ?? 0).toBe(0);
  });
});

describe('coverage — JSON contract', () => {
  it('emits the stable documented shape with sorted per-spec records', async () => {
    await writeConfig(GOVERNED_SCHEMA);
    await writePair('behavior/session-loop', {
      spec: specDoc('behavior.session-loop'),
      enforcement: automatedEnforcement('behavior.session-loop', 'src/loop.test.ts'),
      target: 'src/loop.test.ts',
    });
    await writePair('architecture/domain', {
      spec: specDoc('architecture.domain'),
      enforcement: reviewEnforcement('architecture.domain'),
    });

    await runCoverage(undefined, { json: true });

    const parsed = JSON.parse(logOutput.join('\n'));
    expect(Object.keys(parsed)).toEqual([
      'summary',
      'specs',
      'orphans',
      'strict',
      'valid',
      'root',
    ]);
    expect(parsed.summary.totals).toMatchObject({
      specs: 2,
      requirements: 2,
      coveredRequirements: 2,
    });
    expect(parsed.summary.states).toMatchObject({ complete: 1, degraded: 1 });
    expect(parsed.summary.strengths).toEqual({ automated: 1, review: 1, manual: 0 });
    expect(parsed.summary.planes.behavior.specs).toBe(1);
    expect(parsed.summary.planes.architecture.specs).toBe(1);
    expect(parsed.specs.map((s: { locator: string }) => s.locator)).toEqual([
      'architecture/domain',
      'behavior/session-loop',
    ]);
    expect(parsed.specs[0]).toMatchObject({
      specId: 'architecture.domain',
      plane: 'architecture',
      state: 'degraded',
    });
    expect(parsed.orphans).toEqual({
      staleBindings: [],
      enforcementOnlyPairs: [],
      brokenTargets: [],
      unboundEvidence: [],
    });
    expect(parsed.strict).toBe(false);
    expect(parsed.valid).toBe(true);
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('is byte-identical across two runs on an unchanged repository', async () => {
    await writeConfig(GOVERNED_SCHEMA);
    await writePair('behavior/session-loop', {
      spec: specDoc('behavior.session-loop'),
      enforcement: staleEnforcement('behavior.session-loop', 'src/loop.test.ts'),
      target: 'src/loop.test.ts',
    });
    await writePair('architecture/domain', {
      spec: specDoc('architecture.domain'),
      enforcement: reviewEnforcement('architecture.domain'),
    });

    await runCoverage(undefined, { json: true, orphans: true });
    const first = logOutput.join('\n');
    logOutput = [];
    await runCoverage(undefined, { json: true, orphans: true });
    const second = logOutput.join('\n');

    expect(second).toBe(first);
  });
});

describe('coverage — drill-down', () => {
  it('resolves a stable spec ID and lists covering bindings with strength, targets, and limitations', async () => {
    await writeConfig(GOVERNED_SCHEMA);
    await writePair('architecture/domain', {
      spec: specDoc('architecture.domain'),
      enforcement: reviewEnforcement('architecture.domain'),
    });

    await runCoverage('architecture.domain');

    const out = logOutput.join('\n');
    expect(out).toContain('Coverage: architecture/domain');
    expect(out).toContain('state:   degraded');
    expect(out).toContain('- r (R) [covered]');
    expect(out).toContain('covered by rv [review/review/active]');
    expect(out).toContain('limitations: Reviewer availability');
    expect(out).toContain('scenario s (S) [covered by rv]');
    expect(out).toContain('Hanging requirements: (none)');
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('identifies hanging requirements and uncovered scenarios by pair-local ID', async () => {
    await writeConfig(GOVERNED_SCHEMA);
    await writePair('behavior/session-loop', {
      spec: specDoc('behavior.session-loop'),
      enforcement: hangingEnforcement('behavior.session-loop'),
    });

    await runCoverage('behavior/session-loop');

    const out = logOutput.join('\n');
    expect(out).toContain('- r (R) [hanging]');
    expect(out).toContain('Hanging requirements: r');
    expect(out).toContain('Uncovered scenarios: s');
  });

  it('carries per-requirement binding detail in the drill-down JSON record', async () => {
    await writeConfig(GOVERNED_SCHEMA);
    await writePair('behavior/session-loop', {
      spec: specDoc('behavior.session-loop'),
      enforcement: automatedEnforcement('behavior.session-loop', 'src/loop.test.ts'),
      target: 'src/loop.test.ts',
    });

    await runCoverage('behavior.session-loop', { json: true });

    const parsed = JSON.parse(logOutput.join('\n'));
    expect(parsed.specs).toHaveLength(1);
    const [spec] = parsed.specs;
    expect(spec.locator).toBe('behavior/session-loop');
    const [requirement] = spec.requirements;
    expect(requirement).toMatchObject({ id: 'r', state: 'covered' });
    expect(requirement.coveredBy[0]).toMatchObject({
      id: 'b',
      mechanism: 'test',
      strength: 'automated',
      status: 'active',
      targets: ['src/loop.test.ts'],
      limitations: null,
    });
    expect(requirement.scenarios[0]).toMatchObject({
      id: 's',
      state: 'covered',
      coveredBy: ['b'],
    });
    // Repo-level summary and orphans stay present in the drill-down view.
    expect(parsed.summary).toBeDefined();
    expect(parsed.orphans).toBeDefined();
  });

  it('reports an unknown target', async () => {
    await writeConfig(GOVERNED_SCHEMA);
    await writePair('behavior/session-loop', {
      spec: specDoc('behavior.session-loop'),
      enforcement: hangingEnforcement('behavior.session-loop'),
    });

    await runCoverage('behavior/nope');

    expect(errOutput.join('\n')).toContain("Spec 'behavior/nope' not found");
    expect(process.exitCode).toBe(1);
  });
});

describe('coverage — orphans and evidence', () => {
  it('lists stale bindings with removed IDs, enforcement-only pairs, and broken targets', async () => {
    await writeConfig(GOVERNED_SCHEMA);
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

    await runCoverage(undefined, { orphans: true });

    const out = logOutput.join('\n');
    expect(out).toContain('Orphans');
    expect(out).toContain('- behavior/stale binding b covers removed: gone');
    expect(out).toContain('- behavior/enf-only (behavior)');
    expect(out).toContain('- behavior/broken binding b missing: src/missing.test.ts');
  });

  it('reports unbound evidence with --evidence, informational only', async () => {
    await writeConfig(GOVERNED_SCHEMA);
    await writePair('behavior/session-loop', {
      spec: specDoc('behavior.session-loop'),
      enforcement: automatedEnforcement('behavior.session-loop', 'src/loop.test.ts'),
      target: 'src/loop.test.ts',
    });
    await fs.writeFile(path.join(tempDir, 'src', 'orphaned.test.ts'), '// x\n');

    await runCoverage(undefined, { evidence: ['src/**/*.test.ts'] });

    const out = logOutput.join('\n');
    expect(out).toContain('Unbound evidence');
    expect(out).toContain('- src/orphaned.test.ts');
    expect(out).not.toContain('- src/loop.test.ts');
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('never fails --strict on unbound evidence alone', async () => {
    await writeConfig(GOVERNED_SCHEMA);
    await writePair('behavior/session-loop', {
      spec: specDoc('behavior.session-loop'),
      enforcement: automatedEnforcement('behavior.session-loop', 'src/loop.test.ts'),
      target: 'src/loop.test.ts',
    });
    await fs.writeFile(path.join(tempDir, 'src', 'orphaned.test.ts'), '// x\n');

    await runCoverage(undefined, { evidence: ['src/**/*.test.ts'], strict: true });

    expect(process.exitCode ?? 0).toBe(0);
  });
});

describe('coverage — strict gating', () => {
  it('exits non-zero and names the offending specs and bindings on rot', async () => {
    await writeConfig(GOVERNED_SCHEMA);
    await writePair('behavior/hanging', {
      spec: specDoc('behavior.hanging'),
      enforcement: hangingEnforcement('behavior.hanging'),
    });
    await writePair('behavior/stale', {
      spec: specDoc('behavior.stale'),
      enforcement: staleEnforcement('behavior.stale', 'src/stale.test.ts'),
      target: 'src/stale.test.ts',
    });

    await runCoverage(undefined, { strict: true });

    const err = errOutput.join('\n');
    expect(err).toContain('Strict: coverage rot detected.');
    expect(err).toContain('- behavior/hanging: hanging (hanging requirements: r)');
    expect(err).toContain('- stale binding b in behavior/stale covers removed: gone');
    expect(process.exitCode).toBe(1);
  });

  it('passes --strict on a repository of complete and degraded specs', async () => {
    await writeConfig(GOVERNED_SCHEMA);
    await writePair('behavior/session-loop', {
      spec: specDoc('behavior.session-loop'),
      enforcement: automatedEnforcement('behavior.session-loop', 'src/loop.test.ts'),
      target: 'src/loop.test.ts',
    });
    await writePair('architecture/domain', {
      spec: specDoc('architecture.domain'),
      enforcement: reviewEnforcement('architecture.domain'),
    });

    await runCoverage(undefined, { strict: true });

    expect(process.exitCode ?? 0).toBe(0);
  });

  it('reports strict and valid in JSON without extra text', async () => {
    await writeConfig(GOVERNED_SCHEMA);
    await writePair('behavior/hanging', {
      spec: specDoc('behavior.hanging'),
      enforcement: hangingEnforcement('behavior.hanging'),
    });

    await runCoverage(undefined, { strict: true, json: true });

    const parsed = JSON.parse(logOutput.join('\n'));
    expect(parsed.strict).toBe(true);
    expect(parsed.valid).toBe(false);
    expect(process.exitCode).toBe(1);
  });
});

describe('coverage — legacy model', () => {
  it('explains that coverage requires the governed spec model and exits non-zero', async () => {
    await writeConfig(LEGACY_SCHEMA);
    const dir = path.join(tempDir, 'openspec', 'specs', 'auth');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'spec.md'),
      '## Purpose\nAuth.\n\n## Requirements\n\n### Requirement: Login\nUsers MUST log in.\n\n#### Scenario: ok\n- **WHEN** x\n- **THEN** y\n'
    );

    await runCoverage(undefined);

    expect(errOutput.join('\n')).toContain(
      'coverage requires the governed spec model (schema with specModel.kind: governed)'
    );
    expect(logOutput.join('\n')).not.toContain('Coverage:');
    expect(process.exitCode).toBe(1);
  });

  it('reports the legacy error as a status payload in JSON mode', async () => {
    await writeConfig(LEGACY_SCHEMA);

    await runCoverage(undefined, { json: true });

    const parsed = JSON.parse(logOutput.join('\n'));
    expect(parsed.status[0]).toMatchObject({
      severity: 'error',
      code: 'governed_model_required',
    });
    expect(process.exitCode).toBe(1);
  });
});
