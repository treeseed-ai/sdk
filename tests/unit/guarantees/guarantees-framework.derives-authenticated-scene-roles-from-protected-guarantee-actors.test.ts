import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { resolve } from 'node:path';

import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import {
	auditGuaranteeJourneys,
	assertPathInsideWorkspace,
	discoverGuarantees,
	exportGuaranteesCsv,
	exportGuaranteesJson,
	exportGuaranteesMarkdown,
	browserForGuaranteeDevice,
	createGuaranteeStatusReport,
	fileExists,
	loadGuaranteeVerifierRegistry,
	normalizeGuaranteeTaxonomy,
	planGuarantees,
	resolveGuaranteeVerifierRefs,
	runGuarantees,
	sceneAuthRoleForGuarantee,
	sceneDeviceRunsForGuarantee,
	validateVitestVerifierOutput,
	validateGuarantee,
	validateGuaranteeSceneJourneyContract,
	writeGuaranteesExport,
	writeGuaranteeRunReport,
} from '../../../src/guarantees/index.ts';

function workspaceFixture(name: string) {
	const root = resolve(tmpdir(), `treeseed-guarantees-${name}-${process.pid}-${Date.now()}`);
	mkdirSync(resolve(root, 'packages', 'admin', 'guarantees', 'project', 'question', 'scenes'), { recursive: true });
	mkdirSync(resolve(root, 'packages', 'api', 'guarantees', 'api', 'endpoints'), { recursive: true });
	writeFileSync(resolve(root, 'package.json'), JSON.stringify({ name: '@treeseed/market' }));
	writeFileSync(resolve(root, 'packages', 'admin', 'package.json'), JSON.stringify({ name: '@treeseed/admin' }));
	writeFileSync(resolve(root, 'packages', 'api', 'package.json'), JSON.stringify({ name: '@treeseed/api' }));
	return root;
}

function writeGuarantee(root: string, body: string, rel = 'packages/admin/guarantees/project/question/ask-question.guarantee.yaml') {
	const file = resolve(root, rel);
	mkdirSync(resolve(file, '..'), { recursive: true });
	writeFileSync(file, body);
	return file;
}

const validGuarantee = `
schemaVersion: treeseed.guarantee/v1
id: guarantee.project.question.ask-question.038
journeyIndex: 38
type: project
subtype: question
journey: Ask Question
ownerPackage: "@treeseed/admin"
summary: Ask a project question.
status: planned
dependencies:
  journeys: []
  guarantees: []
actors:
  allowed: [project_contributor]
  forbidden: [project_viewer]
devices:
  required: [desktop_chromium]
gates: [core, release]
preconditions:
  fixtures: [project]
scene:
  required: true
  manifest: ./scenes/ask-question.scene.yaml
api:
  required: true
  verifierRefs: [todo.project.question.ask-question.api]
content:
  required: true
  verifierRefs: [todo.project.question.ask-question.content]
audit:
  required: true
  verifierRefs: [todo.project.question.ask-question.audit]
negativeCases:
  - id: viewer-denied
    actor: project_viewer
evidence:
  required: [playwright_trace, api_verification_log]
notes:
  - CSV commas, quotes, and newlines should export safely.
`;
describe('Treeseed guarantees framework', () => {
it('derives authenticated scene roles from protected guarantee actors', () => {
		const manifest = {
			actors: { allowed: ['host_operator', 'team_owner'], forbidden: ['anonymous_user', 'unauthorized_user'] },
			scene: { entryRoute: '/app/hosts/preview-host-plan' },
		} as Parameters<typeof sceneAuthRoleForGuarantee>[0];
		expect(sceneAuthRoleForGuarantee(manifest)).toBe('owner');
		expect(sceneAuthRoleForGuarantee({
			...manifest,
			actors: { allowed: ['project_contributor'], forbidden: ['anonymous_user'] },
		} as Parameters<typeof sceneAuthRoleForGuarantee>[0])).toBe('member');
		expect(sceneAuthRoleForGuarantee({
			...manifest,
			actors: { allowed: ['anonymous_user'], forbidden: [] },
			scene: { entryRoute: '/market/templates' },
		} as Parameters<typeof sceneAuthRoleForGuarantee>[0])).toBeUndefined();
		expect(sceneAuthRoleForGuarantee({
			...manifest,
			actors: { allowed: ['buyer'], forbidden: ['unauthorized_user'] },
			scene: { entryRoute: '/marketplace' },
		} as Parameters<typeof sceneAuthRoleForGuarantee>[0])).toBe('owner');
	});

it('maps guarantee devices to distinct scene browser runs', () => {
		expect(browserForGuaranteeDevice('desktop_firefox')).toBe('firefox');
		expect(browserForGuaranteeDevice('mobile_webkit')).toBe('webkit');
		expect(sceneDeviceRunsForGuarantee(['desktop_chromium', 'desktop_firefox', 'tablet_chromium'])).toEqual([
			{ id: 'desktop_chromium', device: 'desktop_chromium', browser: 'chromium' },
			{ id: 'desktop_firefox', device: 'desktop_firefox', browser: 'firefox' },
			{ id: 'tablet_chromium', device: 'tablet_chromium', browser: 'chromium' },
		]);
	});

it('flags entry-route-only scenes as weak service journey contracts', () => {
		const root = workspaceFixture('weak-scene-contract');
		const scenePath = resolve(root, 'packages/admin/guarantees/project/question/scenes/ask-question.scene.yaml');
		mkdirSync(resolve(scenePath, '..'), { recursive: true });
		writeFileSync(scenePath, `schemaVersion: treeseed.scene/v1
id: ask-question
workflow:
  - id: open-entry-route
    action:
      goto: /app/questions
`);
		const diagnostics = validateGuaranteeSceneJourneyContract({ scenePath });
		expect(diagnostics.map((entry) => entry.code)).toContain('guarantee.scene_weak_journey_contract');
	});

it('validates scene journey contract unreadable, invalid, empty, and unknown-action inputs', () => {
		const root = workspaceFixture('scene-contract-edges');
		const missing = validateGuaranteeSceneJourneyContract({ scenePath: resolve(root, 'missing.scene.yaml') });
		expect(missing.map((entry) => entry.code)).toContain('guarantee.scene_unreadable');

		const invalidPath = resolve(root, 'invalid.scene.yaml');
		writeFileSync(invalidPath, 'not-object');
		expect(validateGuaranteeSceneJourneyContract({ scenePath: invalidPath }).map((entry) => entry.code)).toContain('guarantee.scene_invalid_manifest');

		const emptyPath = resolve(root, 'empty.scene.yaml');
		writeFileSync(emptyPath, 'schemaVersion: treeseed.scene/v1\nid: empty\nworkflow: []\n');
		expect(validateGuaranteeSceneJourneyContract({ scenePath: emptyPath }).map((entry) => entry.code)).toContain('guarantee.scene_empty_journey');

		const unknownActionPath = resolve(root, 'unknown-action.scene.yaml');
		writeFileSync(unknownActionPath, `schemaVersion: treeseed.scene/v1
id: unknown-action
journey:
  kind: service
workflow:
  - id: unknown
    action: {}
    expect:
      text: Ready
`);
		const unknown = validateGuaranteeSceneJourneyContract({ scenePath: unknownActionPath });
		expect(unknown.map((entry) => entry.code)).toContain('guarantee.scene_weak_journey_contract');
		expect(unknown[0]?.message).toContain('unknown');
	});

it('validates lowercase taxonomy and planned placeholder verifiers', () => {
		const root = workspaceFixture('valid');
		writeGuarantee(root, validGuarantee);
		writeFileSync(resolve(root, 'packages/admin/guarantees/project/question/scenes/ask-question.scene.yaml'), 'schemaVersion: treeseed.scene/v1\nid: fixture\n');
		const report = discoverGuarantees({ workspaceRoot: root });
		expect(report.ok).toBe(true);
		expect(report.counts.valid).toBe(1);
	});

it('parses fully populated guarantee manifests and verifier definitions', () => {
		const root = workspaceFixture('fully-populated');
		writeGuarantee(root, `
schemaVersion: treeseed.guarantee/v1
id: guarantee.project.question.full-contract.041
journeyIndex: "41"
type: project
subtype: question
journey: Full Contract
ownerPackage: "@treeseed/admin"
surface: admin-ui
summary: Full contract parsing.
status: active
run:
  timeoutSeconds: "30"
  allowSkipped: true
  requiredForRelease: false
dependencies:
  journeys: ["38", ignored]
  guarantees: [guarantee.project.question.ask-question.038, ""]
dependsOnGuarantees:
  - ownerPackage: "@treeseed/api"
    ref: api.endpoints.auth-and-sessions
  - guarantee.project.question.ask-question.038
  - {}
  - 42
actors:
  allowed: [project_contributor, ""]
  forbidden: [anonymous_user]
devices:
  required: [desktop_chromium]
  optional: [mobile_webkit, ""]
gates: [core]
preconditions:
  fixtures: [project]
  notes: [fixture note]
scene:
  required: true
  manifest: ./scenes/full-contract.scene.yaml
  mode:
    acceptance: true
    demo: true
    training: false
  entryRoute: /app/questions
  componentContract: QuestionComposer
  expectedEvidence: [playwright_trace]
api:
  required: true
  verifierRefs: [fixture.full.api]
content:
  required: true
  verifierRefs: [fixture.full.content]
audit:
  required: true
  verifierRefs: [fixture.full.audit]
negativeCases:
  - id: denied
    actor: anonymous_user
    verifierRefs: [fixture.full.negative]
    notes: [denied note]
  - not-an-object
evidence:
  required: [playwright_trace]
  optional: [api_log]
notes: [release note]
`, 'packages/admin/guarantees/project/question/full-contract.guarantee.yaml');
		writeFileSync(resolve(root, 'packages/admin/guarantees/project/question/scenes/full-contract.scene.yaml'), 'schemaVersion: treeseed.scene/v1\nid: full-contract\nworkflow: []\n');
		writeFileSync(resolve(root, 'packages/admin/guarantees/full.verifiers.yaml'), `schemaVersion: treeseed.guarantee-verifiers/v1
ownerPackage: "@treeseed/admin"
verifiers:
  fixture.full.api:
    kind: apiAcceptanceCase
    ownerPackage: "@treeseed/api"
    spec: api.base
    caseId: full.case
    timeoutSeconds: "12"
    evidence: [api.json]
    description: API case
  fixture.full.content:
    kind: vitestCase
    testFile: test/content.test.ts
    testName: content case
    cwd: packages/admin
    args: [--run]
  fixture.full.audit:
    kind: packageScript
    command: test:audit
  fixture.full.negative:
    kind: nodeScript
    command: scripts/check.ts
`);
		const report = discoverGuarantees({ workspaceRoot: root });
		expect(report.ok).toBe(false);
		expect(report.diagnostics.map((entry) => entry.code)).toEqual(expect.arrayContaining([
			'guarantee.missing_dependency',
			'guarantee.missing_journey_dependency',
			'guarantee.missing_depends_on_guarantee',
		]));
		const manifest = report.guarantees.find((entry) => entry.manifest?.id === 'guarantee.project.question.full-contract.041')!.manifest!;
		expect(manifest.run).toEqual({ timeoutSeconds: 30, allowSkipped: true, requiredForRelease: false });
		expect(manifest.dependsOnGuarantees).toEqual([
			'@treeseed/api:api.endpoints.auth-and-sessions',
			'guarantee.project.question.ask-question.038',
		]);
		expect(manifest.scene).toMatchObject({
			required: true,
			mode: { acceptance: true, demo: true, training: false },
			entryRoute: '/app/questions',
			componentContract: 'QuestionComposer',
			expectedEvidence: ['playwright_trace'],
		});
		expect(manifest.devices.optional).toEqual(['mobile_webkit']);
		expect(manifest.negativeCases?.[0]).toMatchObject({ id: 'denied', actor: 'anonymous_user', verifierRefs: ['fixture.full.negative'], notes: ['denied note'] });
		const verifiers = report.verifierRegistries.find((entry) => entry.sourcePath.endsWith('full.verifiers.yaml'))!.registry!.verifiers;
		expect(verifiers['fixture.full.api']).toMatchObject({ kind: 'apiAcceptanceCase', ownerPackage: '@treeseed/api', caseId: 'full.case', timeoutSeconds: 12 });
		expect(verifiers['fixture.full.content']).toMatchObject({ kind: 'vitestCase', testName: 'content case', cwd: 'packages/admin', args: ['--run'] });
	});

it('rejects mixed-case taxonomy and path mismatches', () => {
		const root = workspaceFixture('taxonomy');
		writeGuarantee(root, validGuarantee.replace('type: project', 'type: Project'));
		const report = discoverGuarantees({ workspaceRoot: root });
		expect(report.ok).toBe(false);
		expect(report.diagnostics.map((entry) => entry.code)).toContain('guarantee.invalid_type');
		expect(report.diagnostics.map((entry) => entry.code)).toContain('guarantee.type_path_mismatch');
	});
});
