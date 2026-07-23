import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { resolve } from 'node:path';

import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import {
	auditTreeseedGuaranteeJourneys,
	assertPathInsideWorkspace,
	discoverTreeseedGuarantees,
	exportTreeseedGuaranteesCsv,
	exportTreeseedGuaranteesJson,
	exportTreeseedGuaranteesMarkdown,
	browserForGuaranteeDevice,
	createTreeseedGuaranteeStatusReport,
	fileExists,
	loadTreeseedGuaranteeVerifierRegistry,
	normalizeTreeseedGuaranteeTaxonomy,
	planTreeseedGuarantees,
	resolveTreeseedGuaranteeVerifierRefs,
	runTreeseedGuarantees,
	sceneAuthRoleForGuarantee,
	sceneDeviceRunsForGuarantee,
	validateTreeseedVitestVerifierOutput,
	validateTreeseedGuarantee,
	validateGuaranteeSceneJourneyContract,
	writeTreeseedGuaranteesExport,
	writeTreeseedGuaranteeRunReport,
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
it('expands journey dependencies and implicit app auth dependencies in deterministic execution order', () => {
		const root = workspaceFixture('dependency-graph');
		mkdirSync(resolve(root, 'packages', 'admin', 'guarantees', 'user', 'auth'), { recursive: true });
		writeGuarantee(root, validGuarantee);
		writeGuarantee(root, validGuarantee
			.replace('id: guarantee.project.question.ask-question.038', 'id: guarantee.user.auth.user-login.004')
			.replace('journeyIndex: 38', 'journeyIndex: 4')
			.replace('type: project', 'type: user')
			.replace('subtype: question', 'subtype: auth')
			.replace('journey: Ask Question', 'journey: User Login')
			.replace('scene:\n  required: true', 'surface: admin-ui\nscene:\n  required: false'),
			'packages/admin/guarantees/user/auth/user-login.guarantee.yaml');
		writeGuarantee(root, validGuarantee
			.replace('journeyIndex: 38', 'journeyIndex: 39')
			.replace('id: guarantee.project.question.ask-question.038', 'id: guarantee.project.question.follow-up.039')
			.replace('dependencies:\n  journeys: []\n  guarantees: []', 'dependencies:\n  journeys: [38]\n  guarantees: []')
			.replace('manifest: ./scenes/ask-question.scene.yaml', 'manifest: ./scenes/ask-question.scene.yaml\n  entryRoute: /app/work/questions/new')
			.replace('scene:\n  required: true', 'surface: admin-ui\nscene:\n  required: false'),
			'packages/admin/guarantees/project/question/follow-up.guarantee.yaml');
		const plan = planTreeseedGuarantees({ workspaceRoot: root, filter: { ids: ['guarantee.project.question.follow-up.039'] } });
		expect(plan.ok).toBe(true);
		expect(plan.entries.map((entry) => entry.id)).toEqual([
			'guarantee.user.auth.user-login.004',
			'guarantee.project.question.ask-question.038',
			'guarantee.project.question.follow-up.039',
		]);
		expect(plan.entries.at(-1)?.dependsOn).toEqual(['guarantee.user.auth.user-login.004', 'guarantee.project.question.ask-question.038']);
		expect(plan.entries.at(-1)?.dependencyReason).toContain('journey-index');
		expect(plan.entries.at(-1)?.dependencyReason).toContain('implicit-auth');
	});

it('links verifier dependencies, state dependencies, release manual evidence, and object goto routes', () => {
		const root = workspaceFixture('state-and-verifier-dependencies');
		mkdirSync(resolve(root, 'packages', 'admin', 'guarantees', 'user', 'auth', 'scenes'), { recursive: true });
		mkdirSync(resolve(root, 'packages', 'admin', 'guarantees', 'market', 'journey', 'scenes'), { recursive: true });
		const guarantee = (input: {
			id: string;
			journeyIndex: number;
			type: string;
			subtype: string;
			journey: string;
			ref: string;
			scene: string;
			gates?: string;
			dependsOnGuarantees?: string;
			evidence?: string;
		}) => `schemaVersion: treeseed.guarantee/v1
id: ${input.id}
journeyIndex: ${input.journeyIndex}
type: ${input.type}
subtype: ${input.subtype}
journey: ${input.journey}
ownerPackage: "@treeseed/admin"
surface: admin-ui
summary: ${input.journey}
status: active
dependencies:
  journeys: []
  guarantees: []
${input.dependsOnGuarantees ? `dependsOnGuarantees:\n${input.dependsOnGuarantees}` : ''}
actors:
  allowed: [project_contributor]
  forbidden: [anonymous_user]
devices:
  required: [desktop_chromium]
gates: [${input.gates ?? 'core'}]
preconditions: {}
scene:
  required: false
  manifest: ./scenes/${input.scene}.scene.yaml
api:
  required: true
  verifierRefs: [${input.ref}]
content:
  required: false
audit:
  required: false
negativeCases:
  - id: denied
    actor: anonymous_user
evidence:
  required: [${input.evidence ?? 'api_log'}]
`;
		writeGuarantee(root, guarantee({
			id: 'guarantee.user.auth.user-login.004',
			journeyIndex: 4,
			type: 'user',
			subtype: 'auth',
			journey: 'User Login',
			ref: 'fixture.auth.api',
			scene: 'user-login',
		}), 'packages/admin/guarantees/user/auth/user-login.guarantee.yaml');
		writeGuarantee(root, guarantee({
			id: 'guarantee.market.journey.state-producer.060',
			journeyIndex: 60,
			type: 'market',
			subtype: 'journey',
			journey: 'State Producer',
			ref: 'fixture.producer.api',
			scene: 'state-producer',
			gates: 'core, release',
			evidence: 'manual_log',
		}), 'packages/admin/guarantees/market/journey/state-producer.guarantee.yaml');
		writeGuarantee(root, guarantee({
			id: 'guarantee.market.journey.state-consumer.061',
			journeyIndex: 61,
			type: 'market',
			subtype: 'journey',
			journey: 'State Consumer',
			ref: 'fixture.consumer.api',
			scene: 'state-consumer',
			dependsOnGuarantees: '  - fixture.producer.api',
		}), 'packages/admin/guarantees/market/journey/state-consumer.guarantee.yaml');
		writeFileSync(resolve(root, 'packages/admin/guarantees/user/auth/scenes/user-login.scene.yaml'), `schemaVersion: treeseed.scene/v1
id: user-login
workflow:
  - id: open-login
    action:
      goto: /auth/sign-in
`);
		writeFileSync(resolve(root, 'packages/admin/guarantees/market/journey/scenes/state-producer.scene.yaml'), `schemaVersion: treeseed.scene/v1
id: state-producer
journey:
  kind: service
  producesState:
    - shared-project
workflow:
  - id: open-producer
    action:
      goto:
        path: /app/producer
`);
		writeFileSync(resolve(root, 'packages/admin/guarantees/market/journey/scenes/state-consumer.scene.yaml'), `schemaVersion: treeseed.scene/v1
id: state-consumer
journey:
  kind: service
  consumesState:
    - shared-project
workflow:
  - id: open-consumer
    action:
      goto:
        url: /app/consumer?from=producer
`);
		writeFileSync(resolve(root, 'packages/admin/guarantees/state.verifiers.yaml'), `schemaVersion: treeseed.guarantee-verifiers/v1
ownerPackage: "@treeseed/admin"
verifiers:
  fixture.auth.api:
    kind: apiAcceptanceCase
    caseId: auth.case
  fixture.producer.api:
    kind: manualEvidence
    evidence: [manual-log.json]
  fixture.consumer.api:
    kind: apiAcceptanceCase
    caseId: consumer.case
`);

		const registry = discoverTreeseedGuarantees({ workspaceRoot: root });
		expect(registry.diagnostics.map((entry) => entry.code)).toContain('guarantee.release_manual_evidence');
		const plan = planTreeseedGuarantees({ workspaceRoot: root, filter: { ids: ['guarantee.market.journey.state-consumer.061'] } });
		expect(plan.entries.map((entry) => entry.id)).toEqual([
			'guarantee.user.auth.user-login.004',
			'guarantee.market.journey.state-producer.060',
			'guarantee.market.journey.state-consumer.061',
		]);
		expect(plan.entries.find((entry) => entry.id.endsWith('state-producer.060'))?.producesState).toEqual(['shared-project']);
		expect(plan.entries.find((entry) => entry.id.endsWith('state-consumer.061'))?.consumesState).toEqual(['shared-project']);
		expect(plan.entries.find((entry) => entry.id.endsWith('state-consumer.061'))?.dependencyReason).toEqual(expect.arrayContaining(['depends-on-verifier', 'implicit-auth', 'state']));
	});

it('blocks dependent guarantees when prerequisites fail before executing dependent verifiers', async () => {
		const root = workspaceFixture('dependency-blocking');
		const active = validGuarantee
			.replace('status: planned', 'surface: admin-ui\nstatus: active')
			.replace('todo.project.question.ask-question.api', 'fixture.question.api')
			.replace('todo.project.question.ask-question.content', 'fixture.question.content')
			.replace('todo.project.question.ask-question.audit', 'fixture.question.audit')
			.replace('scene:\n  required: true', 'scene:\n  required: false');
		writeGuarantee(root, active);
		writeGuarantee(root, active
			.replaceAll('ask-question', 'edit-question')
			.replace('Ask Question', 'Edit Question')
			.replace('journeyIndex: 38', 'journeyIndex: 39')
			.replace('id: guarantee.project.question.edit-question.038', 'id: guarantee.project.question.edit-question.039')
			.replace('guarantees: []', 'guarantees: [guarantee.project.question.ask-question.038]'), 'packages/admin/guarantees/project/question/edit-question.guarantee.yaml');
		writeFileSync(resolve(root, 'packages/admin/guarantees/test.verifiers.yaml'), `schemaVersion: treeseed.guarantee-verifiers/v1
ownerPackage: "@treeseed/admin"
verifiers:
  fixture.question.api:
    kind: vitestCase
    testFile: test/fixture.test.ts
  fixture.question.content:
    kind: vitestCase
    testFile: test/fixture.test.ts
  fixture.question.audit:
    kind: vitestCase
    testFile: test/fixture.test.ts
`);
		const calls: string[] = [];
		const report = await runTreeseedGuarantees({
			workspaceRoot: root,
			filter: { ids: ['guarantee.project.question.edit-question.039'] },
			verifierExecutor: async ({ guarantee, ref }) => {
				calls.push(`${guarantee.manifest.id}:${ref}`);
				return guarantee.manifest.id.includes('ask-question')
					? { status: 'failed', summary: `${ref} failed` }
					: { status: 'passed', summary: `${ref} passed` };
			},
			now: new Date('2026-01-01T00:00:00.000Z'),
		});
		expect(report.ok).toBe(false);
		expect(report.results.map((entry) => [entry.id, entry.status])).toEqual([
			['guarantee.project.question.ask-question.038', 'failed'],
			['guarantee.project.question.edit-question.039', 'blocked'],
		]);
		expect(report.results[1]?.diagnostics.map((entry) => entry.code)).toContain('guarantee.dependency_failed');
		expect(calls.every((entry) => !entry.startsWith('guarantee.project.question.edit-question.039:'))).toBe(true);
		expect(report.statePath).toContain('state.json');
	});
});
