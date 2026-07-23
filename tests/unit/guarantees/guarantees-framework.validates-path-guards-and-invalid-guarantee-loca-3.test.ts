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
it('validates path guards and invalid guarantee locations', () => {
		const root = workspaceFixture('path-guards');
		expect(assertPathInsideWorkspace(root, resolve(root, 'inside.txt'))).toBe(resolve(root, 'inside.txt'));
		expect(() => assertPathInsideWorkspace(root, resolve(root, '..', 'outside.txt'))).toThrow('outside workspace');
		writeGuarantee(root, validGuarantee, 'packages/admin/ask-question.guarantee.yaml');
		const report = discoverTreeseedGuarantees({ workspaceRoot: root });
		expect(report.diagnostics.map((entry) => entry.code)).toContain('guarantee.invalid_path');
	});

it('covers empty discovery, verifier shape, todo resolution, defaults, and registry-less report writing', () => {
		const root = workspaceFixture('helper-branches');
		const missing = discoverTreeseedGuarantees({ workspaceRoot: resolve(root, 'missing-workspace') });
		expect(missing).toMatchObject({ ok: true, counts: { total: 0, valid: 0, errors: 0, warnings: 0 } });

		const verifiersPath = resolve(root, 'packages/admin/guarantees/not-object.verifiers.yaml');
		writeFileSync(verifiersPath, '[]\n');
		expect(loadTreeseedGuaranteeVerifierRegistry({ workspaceRoot: root, path: verifiersPath }).diagnostics.map((entry) => entry.code)).toContain('guarantee_verifiers.invalid_manifest');

		const activeTodo = resolveTreeseedGuaranteeVerifierRefs({
			refs: ['todo.active.case', 'todo.active.case', 'missing.case'],
			verifierRegistries: [],
			status: 'active',
			sourcePath: resolve(root, 'guarantees/project/question/todo.guarantee.yaml'),
		});
		expect(activeTodo.ok).toBe(false);
		expect(activeTodo.resolutions).toHaveLength(2);
		expect(activeTodo.diagnostics.map((entry) => `${entry.severity}:${entry.code}`)).toEqual([
			'error:guarantee.todo_verifier_ref',
			'error:guarantee.missing_verifier_ref',
		]);

		expect(sceneAuthRoleForGuarantee({
			actors: { allowed: ['project_admin'], forbidden: ['anonymous_user'] },
			scene: { entryRoute: '/app/admin/projects' },
		} as Parameters<typeof sceneAuthRoleForGuarantee>[0])).toBe('admin');
		expect(sceneDeviceRunsForGuarantee([])).toEqual([{ id: 'desktop_chromium', device: 'desktop_chromium', browser: 'chromium' }]);

		const outputRoot = resolve(root, '.treeseed/guarantees/manual-report');
		const writeResult = writeTreeseedGuaranteeRunReport({
			report: {
				ok: true,
				runId: 'manual-report',
				workspaceRoot: root,
				environment: 'local',
				filter: {},
				startedAt: '2026-01-01T00:00:00.000Z',
				completedAt: '2026-01-01T00:00:01.000Z',
				outputRoot,
				plan: {
					ok: true,
					workspaceRoot: root,
					filter: {},
					environment: 'local',
					entries: [],
					diagnostics: [],
					counts: { total: 0, selected: 0, withDependencies: 0, errors: 0, warnings: 0 },
				},
				results: [],
				diagnostics: [],
				counts: { planned: 0, passed: 0, failed: 0, skipped: 0, blocked: 0, releaseBlockingFailures: 0 },
			},
		});
		expect(writeResult.ok).toBe(true);
		expect(readFileSync(writeResult.csvPath, 'utf8')).toBe('');
		expect(readFileSync(writeResult.markdownPath, 'utf8')).toContain('# TreeSeed Guarantee Run');
	});

it('covers release, filter, missing verifier, missing scene, and scene execution branches', async () => {
		const root = workspaceFixture('release-and-scene-branches');
		mkdirSync(resolve(root, 'packages', 'admin', 'guarantees', 'billing', 'payment', 'scenes'), { recursive: true });
		writeGuarantee(root, validGuarantee
			.replace('status: planned', 'surface: admin-ui\nstatus: active')
			.replace('negativeCases:\n  - id: viewer-denied\n    actor: project_viewer', 'negativeCases: []')
			.replace('evidence:\n  required: [playwright_trace, api_verification_log]', 'evidence:\n  required: []'),
			'packages/admin/guarantees/project/question/release-missing-evidence.guarantee.yaml');
		writeGuarantee(root, validGuarantee
			.replace('id: guarantee.project.question.ask-question.038', 'id: guarantee.billing.payment.missing-scene.050')
			.replace('journeyIndex: 38', 'journeyIndex: 50')
			.replace('type: project', 'type: billing')
			.replace('subtype: question', 'subtype: payment')
			.replace('journey: Ask Question', 'journey: Missing Scene')
			.replace('status: planned', 'surface: admin-ui\nstatus: active')
			.replace('todo.project.question.ask-question.api', 'missing.api')
			.replace('todo.project.question.ask-question.content', 'missing.content')
			.replace('todo.project.question.ask-question.audit', 'missing.audit'),
			'packages/admin/guarantees/billing/payment/missing-scene.guarantee.yaml');
		writeGuarantee(root, validGuarantee
			.replace('id: guarantee.project.question.ask-question.038', 'id: guarantee.billing.payment.scene-step.051')
			.replace('journeyIndex: 38', 'journeyIndex: 51')
			.replace('type: project', 'type: billing')
			.replace('subtype: question', 'subtype: payment')
			.replace('journey: Ask Question', 'journey: Scene Step')
			.replace('status: planned', 'surface: admin-ui\nstatus: active')
			.replace('gates: [core, release]', 'gates: [core]')
			.replace('manifest: ./scenes/ask-question.scene.yaml', 'manifest: ./scenes/scene-step.scene.yaml')
			.replace('api:\n  required: true', 'api:\n  required: false')
			.replace('content:\n  required: true', 'content:\n  required: false')
			.replace('audit:\n  required: true', 'audit:\n  required: false')
			.replace('todo.project.question.ask-question.api', '')
			.replace('todo.project.question.ask-question.content', '')
			.replace('todo.project.question.ask-question.audit', '')
			.replace('devices:\n  required: [desktop_chromium]', 'devices:\n  required: [desktop_chromium, mobile_webkit]'),
			'packages/admin/guarantees/billing/payment/scene-step.guarantee.yaml');
		writeFileSync(resolve(root, 'packages/admin/guarantees/billing/payment/scenes/scene-step.scene.yaml'), `schemaVersion: treeseed.scene/v1
id: scene-step
journey:
  kind: service
  minimumSteps: 2
workflow:
  - id: open
    action:
      goto: /app/billing
    expect:
      urlIncludes: /app/billing
  - id: pay
    action:
      click:
        role: button
        name: Pay
    expect:
      text: Paid
`);
		const registry = discoverTreeseedGuarantees({ workspaceRoot: root, filter: { gate: 'security', subtype: 'quote', ownerPackage: '@treeseed/api', status: 'deprecated', journeyIndexes: [999] } });
		expect(registry.diagnostics.map((entry) => entry.code)).toEqual(expect.arrayContaining([
			'guarantee.release_missing_evidence',
			'guarantee.release_todo_verifier',
			'guarantee.no_negative_cases',
			'guarantee.scene_missing',
			'guarantee.missing_verifier_ref',
		]));
		const unresolved = await runTreeseedGuarantees({
			workspaceRoot: root,
			filter: { ids: ['guarantee.billing.payment.missing-scene.050'] },
			now: new Date('2026-01-01T00:00:00.000Z'),
			evidenceTarget: 'release',
			failOnSkippedReleaseGuarantees: true,
		});
		expect(unresolved.outputRoot).toContain('.treeseed/guarantees/release/');
		expect(unresolved.results).toEqual([]);
		expect(unresolved.diagnostics.map((entry) => entry.code)).toContain('guarantee.missing_verifier_ref');

		const sceneRoot = workspaceFixture('scene-executor-branches');
		mkdirSync(resolve(sceneRoot, 'packages', 'admin', 'guarantees', 'billing', 'payment', 'scenes'), { recursive: true });
		writeGuarantee(sceneRoot, validGuarantee
			.replace('id: guarantee.project.question.ask-question.038', 'id: guarantee.billing.payment.scene-step.051')
			.replace('journeyIndex: 38', 'journeyIndex: 51')
			.replace('type: project', 'type: billing')
			.replace('subtype: question', 'subtype: payment')
			.replace('journey: Ask Question', 'journey: Scene Step')
			.replace('status: planned', 'surface: admin-ui\nstatus: active')
			.replace('gates: [core, release]', 'gates: [core]')
			.replace('manifest: ./scenes/ask-question.scene.yaml', 'manifest: ./scenes/scene-step.scene.yaml')
			.replace('api:\n  required: true', 'api:\n  required: false')
			.replace('content:\n  required: true', 'content:\n  required: false')
			.replace('audit:\n  required: true', 'audit:\n  required: false')
			.replace('todo.project.question.ask-question.api', '')
			.replace('todo.project.question.ask-question.content', '')
			.replace('todo.project.question.ask-question.audit', '')
			.replace('devices:\n  required: [desktop_chromium]', 'devices:\n  required: [desktop_chromium, mobile_webkit]'),
			'packages/admin/guarantees/billing/payment/scene-step.guarantee.yaml');
		writeFileSync(resolve(sceneRoot, 'packages/admin/guarantees/billing/payment/scenes/scene-step.scene.yaml'), `schemaVersion: treeseed.scene/v1
id: scene-step
journey:
  kind: service
  minimumSteps: 2
workflow:
  - id: open
    action:
      goto: /app/billing
    expect:
      urlIncludes: /app/billing
  - id: pay
    action:
      click:
        role: button
        name: Pay
    expect:
      text: Paid
`);
		const sceneRun = await runTreeseedGuarantees({
			workspaceRoot: sceneRoot,
			filter: { ids: ['guarantee.billing.payment.scene-step.051'] },
			sceneExecutor: async ({ device }) => ({
				status: device === 'mobile_webkit' ? 'failed' : 'passed',
				summary: `${device ?? 'default'} scene`,
				evidence: [`evidence/${device ?? 'default'}.json`, 'playwright/screenshots/viewport/ignored.png'],
				diagnostics: device === 'mobile_webkit' ? [{ severity: 'error', code: 'scene.failed', message: 'mobile failed' }] : [],
			}),
			now: new Date('2026-01-01T00:00:00.000Z'),
			device: 'mobile_webkit',
			sceneArtifacts: 'screenshots',
			record: true,
		});
		expect(sceneRun.results[0]?.status).toBe('failed');
		expect(sceneRun.results[0]?.steps[0]?.kind).toBe('scene');
		expect(sceneRun.results[0]?.evidence).toContain('evidence/mobile_webkit.json');
	});

it('filters by type and subtype and expands dependencies', () => {
		const root = workspaceFixture('filter');
		writeGuarantee(root, validGuarantee);
		writeGuarantee(root, validGuarantee
			.replaceAll('ask-question', 'edit-question')
			.replace('Ask Question', 'Edit Question')
			.replace('journeyIndex: 38', 'journeyIndex: 39')
			.replace('id: guarantee.project.question.edit-question.038', 'id: guarantee.project.question.edit-question.039')
			.replace('guarantees: []', 'guarantees: [guarantee.project.question.ask-question.038]'), 'packages/admin/guarantees/project/question/edit-question.guarantee.yaml');
		const plan = planTreeseedGuarantees({ workspaceRoot: root, filter: { ids: ['guarantee.project.question.edit-question.039'] } });
		expect(plan.ok).toBe(true);
		expect(plan.counts.selected).toBe(1);
		expect(plan.counts.withDependencies).toBe(2);
		expect(plan.entries.find((entry) => entry.id === 'guarantee.project.question.ask-question.038')?.dependency).toBe(true);
	});
});
