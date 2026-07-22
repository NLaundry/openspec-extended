import { describe, it, expect } from 'vitest';

import {
  getExploreSkillTemplate,
  getVerifyChangeSkillTemplate,
  getApplyChangeSkillTemplate,
  getOpsxProposeSkillTemplate,
  getOpsxExploreCommandTemplate,
  getOpsxVerifyCommandTemplate,
  getOpsxApplyCommandTemplate,
  getOpsxProposeCommandTemplate,
} from '../../../src/core/templates/skill-templates.js';
import type { SpecModel } from '../../../src/core/artifact-graph/types.js';

const GOVERNED: SpecModel = {
  kind: 'governed',
  version: 1,
  planes: ['behavior', 'architecture'],
  pairedEnforcement: true,
};

/**
 * add-spec-coverage-tool (opsx-explore-skill spec): the governed explore
 * guidance walks behavior -> architecture -> enforcement, classifies dual-plane
 * ideas, and opens with the `openspec coverage --json` health check; verify and
 * apply carry one-line coverage pointers. Legacy output never mentions any of
 * it (byte-identical, hash-locked elsewhere).
 */
describe('governed explore staged flow and coverage awareness', () => {
  const EXPLORE_MARKERS = [
    // Health check opens exploration and mentions rot in touched areas.
    'Health check first (governed)',
    'openspec coverage --json',
    'hanging\nclaims, stale bindings, **degraded** specs',
    'surface that state and suggest addressing it or explicitly\ndeferring it in the proposal',
    // The three named stages.
    'Staged exploration: behavior -> architecture -> enforcement (governed)',
    '**Desired behavior.**',
    '**Supporting architecture.**',
    '**Enforcement approach',
    // Dual-plane classifier: both planes -> a candidate locator in each.
    'Dual-plane classifier:',
    'name a candidate locator in EACH plane',
    'say why no architectural spec is needed',
    // Named structural triggers force the architectural spec (the port/adapter case).
    'structural trigger',
    'a new **port or adapter**',
    'architecture/persistence-port',
    // Enforcement stage stays general; certainty is reserved for the proposal.
    'stay general; certainty is the proposal',
    'coverage decisions for the proposal',
    // The distilled enforcement philosophy is the shared lens.
    'Enforcement philosophy (governed)',
    'Coverage is a mirror, not a target.',
    'Prefer the highest-leverage check.',
    'Bind at the requirement level, not per scenario.',
    // The five-homes classification table is folded in, not lost.
    'Classifying durable insights (governed)',
    '| User/client-visible capability that must stay true | Behavioral spec pair',
  ];

  for (const marker of EXPLORE_MARKERS) {
    it(`teaches "${marker.slice(0, 40)}..." under governed, absent under legacy`, () => {
      const skill = getExploreSkillTemplate(GOVERNED).instructions;
      const command = getOpsxExploreCommandTemplate(GOVERNED).content;
      expect(skill).toContain(marker);
      expect(command).toContain(marker);
      expect(getExploreSkillTemplate().instructions).not.toContain(marker);
      expect(getOpsxExploreCommandTemplate().content).not.toContain(marker);
    });
  }
});

describe('coverage pointers in governed verify and apply guidance', () => {
  const POINTER = 'openspec coverage';

  it('verify names openspec coverage and its --json form under governed, absent under legacy', () => {
    for (const surface of [
      getVerifyChangeSkillTemplate(GOVERNED).instructions,
      getOpsxVerifyCommandTemplate(GOVERNED).content,
    ]) {
      expect(surface).toContain(POINTER);
      expect(surface).toContain('openspec coverage --json');
      expect(surface).toContain('aggregated enforcement-coverage view backing this assessment');
    }
    expect(getVerifyChangeSkillTemplate().instructions).not.toContain(POINTER);
    expect(getOpsxVerifyCommandTemplate().content).not.toContain(POINTER);
  });

  it('apply names openspec coverage as the shared health signal under governed, absent under legacy', () => {
    for (const surface of [
      getApplyChangeSkillTemplate(GOVERNED).instructions,
      getOpsxApplyCommandTemplate(GOVERNED).content,
    ]) {
      expect(surface).toContain(POINTER);
      expect(surface).toContain('aggregated coverage health signal');
    }
    expect(getApplyChangeSkillTemplate().instructions).not.toContain(POINTER);
    expect(getOpsxApplyCommandTemplate().content).not.toContain(POINTER);
  });
});

describe('enforcement philosophy reaches authoring (concrete altitude)', () => {
  // The proposal is where certainty lands, so the authoring guidance must carry
  // both the shared philosophy and the concrete "author bindings by it" framing.
  const AUTHORING_MARKERS = [
    'Enforcement philosophy (governed)',
    'Prefer the highest-leverage check.',
    'Author bindings by the philosophy below',
    '"At least\n  one binding" is a floor for honest evidence, not a quota to maximize',
  ];

  for (const marker of AUTHORING_MARKERS) {
    it(`propose authoring teaches "${marker.slice(0, 40)}..." under governed, absent under legacy`, () => {
      expect(getOpsxProposeSkillTemplate(GOVERNED).instructions).toContain(marker);
      expect(getOpsxProposeCommandTemplate(GOVERNED).content).toContain(marker);
      expect(getOpsxProposeSkillTemplate().instructions).not.toContain(marker);
      expect(getOpsxProposeCommandTemplate().content).not.toContain(marker);
    });
  }
});
