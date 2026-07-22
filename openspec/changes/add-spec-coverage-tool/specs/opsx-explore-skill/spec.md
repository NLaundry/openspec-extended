## ADDED Requirements

### Requirement: Staged governed exploration
Under the governed spec model, the explore skill SHALL structure exploration of a new idea as three named stages — desired behavior, supporting architecture, and enforcement — while remaining a conversational thinking partner rather than a rigid script.

#### Scenario: Behavior stage first
- **WHEN** a user brings a new idea to a governed explore session
- **THEN** the agent first explores the observable outcome ("what behavior do you want") and which behavioral spec pair would own it

#### Scenario: Architecture stage follows
- **WHEN** the desired behavior is understood
- **THEN** the agent explores what structure must remain true to build it — packages, responsibilities, boundaries, invariants — and which architectural spec pair would own each

#### Scenario: Enforcement stage closes the loop
- **WHEN** behavioral or architectural claims crystallize
- **THEN** the agent explores how the most important claims would be proven — test, lint, static-analysis, command, review, or manual — as an approach, before proposing artifacts

### Requirement: Enforcement approach without premature certainty
Because requirements and scenarios do not exist until the proposal, the explore skill's enforcement stage SHALL explore a testing approach for the most important architectural invariants and behavioral outcomes without enumerating concrete bindings, and SHALL reserve concrete binding, target, and coverage decisions for the proposal.

#### Scenario: Enforcement stage stays general
- **WHEN** the enforcement stage is reached during exploration
- **THEN** the agent names the most important claims and, for each, the highest-leverage way it could be verified
- **AND** it does not enumerate concrete bindings, target files, or `covers` lists

#### Scenario: Certainty reserved for the proposal
- **WHEN** exploration concludes and a proposal is created
- **THEN** concrete enforcement bindings, targets, and coverage are decided against the now-existing requirements and scenarios

#### Scenario: Leverage-first, honest evidence
- **WHEN** the skill discusses how a claim would be enforced
- **THEN** it prefers the highest-leverage check — one fitness function or property test over many example tests — and treats review and manual as first-class honest evidence rather than a coverage quota to maximize

### Requirement: Dual-plane classification
The explore skill SHALL explicitly classify whether an idea changes what the system does, how the system must be structured, or both, and SHALL state when specs are needed in both planes. It SHALL treat named structural triggers — a new port or adapter, a new package/module/layer, a new dependency edge or boundary rule, or a new cross-cutting invariant — as requiring an architectural spec, not as implementation detail.

#### Scenario: Structural trigger requires an architectural spec
- **WHEN** building an idea introduces a new port or adapter, a new package or layer, a new dependency edge, or a new cross-cutting invariant
- **THEN** the agent states the idea needs an architectural spec pair in addition to any behavioral one, naming a candidate architectural locator

#### Scenario: Idea spans both planes
- **WHEN** an idea changes user-observable behavior AND hits a structural trigger
- **THEN** the agent says the idea needs a behavioral spec pair AND an architectural spec pair, naming a candidate locator for each

#### Scenario: Single-plane idea
- **WHEN** an idea only alters observable behavior within the existing structure, with no new port, package, dependency edge, or invariant
- **THEN** the agent plans a behavioral spec pair only and says why no architectural spec is needed

### Requirement: Coverage-informed health awareness
Under the governed spec model, the explore skill SHALL consult `openspec coverage --json` at the start of exploration and factor spec-surface health — hanging claims, stale bindings, degraded specs, orphaned enforcement — into the discussion.

#### Scenario: Health check opens exploration
- **WHEN** a governed explore session begins
- **THEN** the agent runs `openspec coverage --json` and mentions relevant rot or gaps in the areas the idea touches

#### Scenario: New work near existing rot
- **WHEN** the idea touches a spec whose state is hanging, stale, or degraded
- **THEN** the agent surfaces that state and suggests addressing or explicitly deferring it in the proposal

### Requirement: Coverage feeds governed workflows
The governed verify and apply guidance SHALL point agents at `openspec coverage` as the shared health signal so verification and implementation consume the same coverage picture as exploration.

#### Scenario: Verify consults coverage
- **WHEN** governed verification assesses enforcement coverage
- **THEN** its guidance names `openspec coverage` (and its `--json` form) as the aggregated view backing the assessment

#### Scenario: Legacy explore unchanged
- **WHEN** the project's resolved spec model is legacy
- **THEN** explore, verify, and apply guidance are byte-identical to their pre-change output
