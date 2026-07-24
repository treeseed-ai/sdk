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
it('runs active guarantees with injected verifier execution and writes evidence reports', async () => {
		const root = workspaceFixture('runner');
		writeGuarantee(root, validGuarantee
			.replace('status: planned', 'surface: admin-ui\nstatus: active')
			.replace('todo.project.question.ask-question.api', 'fixture.question.api')
			.replace('todo.project.question.ask-question.content', 'fixture.question.content')
			.replace('todo.project.question.ask-question.audit', 'fixture.question.audit')
			.replace('scene:\n  required: true', 'scene:\n  required: false'));
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
		const report = await runGuarantees({
			workspaceRoot: root,
			verifierExecutor: async ({ ref }) => ({ status: 'passed', summary: `${ref} passed`, evidence: [`evidence/${ref}.json`] }),
			now: new Date('2026-01-01T00:00:00.000Z'),
		});
		expect(report.ok).toBe(true);
		expect(report.counts.passed).toBe(1);
		expect(report.results[0]?.steps.map((step) => step.ref)).toEqual(['fixture.question.api', 'fixture.question.content', 'fixture.question.audit']);
		expect(report.outputRoot).toContain('.treeseed/guarantees/runs/2026-01-01T00-00-00-000Z');
	});

it('normalizes sparse verifier results and permits explicitly allowed skipped guarantees', async () => {
		const root = workspaceFixture('sparse-verifier-results');
		writeGuarantee(root, validGuarantee
			.replace('status: planned', 'surface: api-control-plane\nstatus: active\nrun:\n  allowSkipped: true\n  requiredForRelease: false')
			.replace('gates: [core, release]', 'gates: [core]')
			.replace('scene:\n  required: true', 'scene:\n  required: false')
			.replaceAll('todo.project.question.ask-question.api', 'fixture.sparse')
			.replaceAll('todo.project.question.ask-question.content', 'fixture.sparse')
			.replaceAll('todo.project.question.ask-question.audit', 'fixture.sparse')
			.replace('negativeCases:\n  - id: viewer-denied\n    actor: project_viewer', 'negativeCases:\n  - id: viewer-denied\n    actor: project_viewer\n    verifierRefs: [fixture.sparse]'));
		writeFileSync(resolve(root, 'packages/admin/guarantees/sparse.verifiers.yaml'), `schemaVersion: treeseed.guarantee-verifiers/v1
ownerPackage: "@treeseed/admin"
verifiers:
  fixture.sparse:
    kind: manualEvidence
`);

		const passed = await runGuarantees({
			workspaceRoot: root,
			verifierExecutor: async () => ({ status: 'passed' }),
		});
		expect(passed.results[0]).toMatchObject({ status: 'passed', evidence: [], diagnostics: [] });

		const skipped = await runGuarantees({
			workspaceRoot: root,
		});
		expect(skipped.results[0]?.status).toBe('skipped');
		expect(skipped.ok).toBe(true);
	});

it('resolves verifier refs and exercises default verifier branches that do not spawn commands', async () => {
		const root = workspaceFixture('default-verifier-branches');
		writeGuarantee(root, validGuarantee
			.replace('status: planned', 'surface: admin-ui\nstatus: active')
			.replace('gates: [core, release]', 'gates: [core]')
			.replace('todo.project.question.ask-question.api', 'fixture.todo')
			.replace('todo.project.question.ask-question.content', 'fixture.manual')
			.replace('todo.project.question.ask-question.audit', 'fixture.scene')
			.replace('scene:\n  required: true', 'scene:\n  required: false')
			.replace('negativeCases:\n  - id: viewer-denied\n    actor: project_viewer', `negativeCases:
  - id: viewer-denied
    actor: project_viewer
    verifierRefs:
      - fixture.api-missing-case
      - fixture.vitest-missing-file
      - fixture.package-missing-command
      - fixture.node-missing-command
      - fixture.node-spawn-error`));
		writeFileSync(resolve(root, 'packages/admin/guarantees/default.verifiers.yaml'), `schemaVersion: treeseed.guarantee-verifiers/v1
ownerPackage: "@treeseed/admin"
verifiers:
  fixture.todo:
    kind: todo
  fixture.manual:
    kind: manualEvidence
    evidence: [manual.md]
  fixture.scene:
    kind: scene
    evidence: [scene.md]
  fixture.api-missing-case:
    kind: apiAcceptanceCase
  fixture.vitest-missing-file:
    kind: vitestCase
  fixture.package-missing-command:
    kind: packageScript
  fixture.node-missing-command:
    kind: nodeScript
  fixture.node-spawn-error:
    kind: nodeScript
    command: /definitely/missing/treeseed-verifier
`);
		const registry = discoverGuarantees({ workspaceRoot: root });
		const resolution = resolveGuaranteeVerifierRefs({
			refs: ['fixture.todo', 'fixture.todo', 'todo.placeholder', 'missing.ref'],
			verifierRegistries: registry.verifierRegistries,
			status: 'planned',
		});
		expect(resolution.ok).toBe(true);
		expect(resolution.resolutions).toHaveLength(3);
		expect(resolution.diagnostics.map((entry) => entry.code)).toEqual(['guarantee.todo_verifier_ref', 'guarantee.missing_verifier_ref']);

		const activeResolution = resolveGuaranteeVerifierRefs({
			refs: ['todo.placeholder'],
			verifierRegistries: registry.verifierRegistries,
			status: 'active',
		});
		expect(activeResolution.ok).toBe(false);

		const report = await runGuarantees({
			workspaceRoot: root,
			now: new Date('2026-01-01T00:00:00.000Z'),
		});
		expect(report.ok).toBe(false);
		expect(report.results[0]?.status).toBe('failed');
		expect(report.results[0]?.steps.map((step) => [step.ref, step.status])).toEqual([
			['fixture.todo', 'blocked'],
			['fixture.manual', 'skipped'],
			['fixture.scene', 'passed'],
			['fixture.api-missing-case', 'blocked'],
			['fixture.vitest-missing-file', 'blocked'],
			['fixture.package-missing-command', 'blocked'],
			['fixture.node-missing-command', 'blocked'],
			['fixture.node-spawn-error', 'failed'],
		]);
		expect(report.results[0]?.diagnostics.map((entry) => entry.code)).toEqual(expect.arrayContaining([
			'guarantee.todo_verifier_execution',
			'guarantee.api_verifier_missing_case_id',
			'guarantee.vitest_verifier_missing_test_file',
			'guarantee.package_script_missing_command',
			'guarantee.node_script_missing_command',
		]));
	});

it('runs nodeScript verifiers through the default command evidence path', async () => {
		const root = workspaceFixture('node-script-verifiers');
		mkdirSync(resolve(root, 'scripts'), { recursive: true });
		writeFileSync(resolve(root, 'scripts/pass.ts'), `console.log('pass verifier output');
console.error('pass verifier detail');
`);
		writeFileSync(resolve(root, 'scripts/fail.ts'), `console.error('fail verifier detail');
process.exit(7);
`);
		writeGuarantee(root, validGuarantee
			.replace('status: planned', 'surface: admin-ui\nstatus: active')
			.replace('gates: [core, release]', 'gates: [core]')
			.replace('todo.project.question.ask-question.api', 'fixture.node-pass')
			.replace('todo.project.question.ask-question.content', 'fixture.node-fail')
			.replace('todo.project.question.ask-question.audit', 'fixture.scene')
			.replace('scene:\n  required: true', 'scene:\n  required: false')
			.replace('negativeCases:\n  - id: viewer-denied\n    actor: project_viewer', `negativeCases:
  - id: viewer-denied
    actor: project_viewer
    verifierRefs:
      - fixture.manual`));
		writeFileSync(resolve(root, 'packages/admin/guarantees/node.verifiers.yaml'), `schemaVersion: treeseed.guarantee-verifiers/v1
ownerPackage: "@treeseed/admin"
verifiers:
  fixture.node-pass:
    kind: nodeScript
    command: "${resolve(root, 'scripts/pass.ts')}"
    args: [one, two]
    cwd: "${process.cwd()}"
    timeoutSeconds: 5
  fixture.node-fail:
    kind: nodeScript
    command: "${resolve(root, 'scripts/fail.ts')}"
    cwd: "${process.cwd()}"
    timeoutSeconds: 5
  fixture.scene:
    kind: scene
  fixture.manual:
    kind: manualEvidence
    evidence: [manual.md]
`);
		const progress: string[] = [];
		const report = await runGuarantees({
			workspaceRoot: root,
			now: new Date('2026-01-01T00:00:00.000Z'),
			onProgress: (message) => progress.push(message),
		});
		expect(report.ok).toBe(false);
		expect(report.results[0]?.status, JSON.stringify(report.diagnostics.map((entry) => entry.code))).toBe('failed');
		expect(report.results[0]?.steps.map((step) => [step.ref, step.status])).toEqual([
			['fixture.node-pass', 'passed'],
			['fixture.node-fail', 'failed'],
			['fixture.scene', 'passed'],
			['fixture.manual', 'skipped'],
		]);
		expect(progress.some((entry) => entry.includes('pass verifier output'))).toBe(true);
		const passEvidence = resolve(root, report.outputRoot, 'evidence', 'fixture-node-pass.json');
		const failEvidence = resolve(root, report.outputRoot, 'evidence', 'fixture-node-fail.json');
		expect(fileExists(passEvidence)).toBe(true);
		expect(fileExists(failEvidence)).toBe(true);
		expect(JSON.parse(readFileSync(passEvidence, 'utf8')).stdout).toContain('pass verifier output');
		expect(JSON.parse(readFileSync(failEvidence, 'utf8')).exitCode).toBe(7);
	});
});
