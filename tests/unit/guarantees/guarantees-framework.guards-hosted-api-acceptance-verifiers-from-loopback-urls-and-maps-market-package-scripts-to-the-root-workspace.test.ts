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
it('guards hosted API acceptance verifiers from loopback URLs and maps market package scripts to the root workspace', async () => {
		const apiRoot = workspaceFixture('api-loopback-guard');
		writeGuarantee(apiRoot, validGuarantee
			.replace('status: planned', 'surface: admin-ui\nstatus: active')
			.replace('gates: [core, release]', 'gates: [core]')
			.replace('todo.project.question.ask-question.api', 'fixture.api-hosted')
			.replace('todo.project.question.ask-question.content', '')
			.replace('todo.project.question.ask-question.audit', '')
			.replace('content:\n  required: true', 'content:\n  required: false')
			.replace('audit:\n  required: true', 'audit:\n  required: false')
			.replace('scene:\n  required: true', 'scene:\n  required: false')
			.replace('negativeCases:\n  - id: viewer-denied\n    actor: project_viewer', 'negativeCases: []'));
		writeFileSync(resolve(apiRoot, 'packages/admin/guarantees/api.verifiers.yaml'), `schemaVersion: treeseed.guarantee-verifiers/v1
ownerPackage: "@treeseed/admin"
verifiers:
  fixture.api-hosted:
    kind: apiAcceptanceCase
    caseId: hosted.case
`);
		const previousBaseUrl = process.env.TREESEED_API_BASE_URL;
		process.env.TREESEED_API_BASE_URL = 'http://127.0.0.1:3000/';
		try {
			await expect(runGuarantees({
				workspaceRoot: apiRoot,
				environment: 'staging',
				now: new Date('2026-01-01T00:00:00.000Z'),
			})).rejects.toThrow('must target a live hosted API URL');
		} finally {
			if (previousBaseUrl === undefined) delete process.env.TREESEED_API_BASE_URL;
			else process.env.TREESEED_API_BASE_URL = previousBaseUrl;
		}

		const marketRoot = workspaceFixture('market-package-script');
		mkdirSync(resolve(marketRoot, 'scripts'), { recursive: true });
		writeFileSync(resolve(marketRoot, 'scripts/package-script.js'), 'console.log("market package script ran");\n');
		const packageJson = JSON.parse(readFileSync(resolve(marketRoot, 'package.json'), 'utf8'));
		packageJson.scripts = { 'verify:market': 'node scripts/package-script.js' };
		writeFileSync(resolve(marketRoot, 'package.json'), JSON.stringify(packageJson, null, 2));
		writeGuarantee(marketRoot, validGuarantee
			.replace('ownerPackage: "@treeseed/admin"', 'ownerPackage: "@treeseed/market"')
			.replace('status: planned', 'surface: market-ui\nstatus: active')
			.replace('gates: [core, release]', 'gates: [core]')
			.replace('todo.project.question.ask-question.api', 'fixture.market-package')
			.replace('todo.project.question.ask-question.content', '')
			.replace('todo.project.question.ask-question.audit', '')
			.replace('content:\n  required: true', 'content:\n  required: false')
			.replace('audit:\n  required: true', 'audit:\n  required: false')
			.replace('scene:\n  required: true', 'scene:\n  required: false')
			.replace('negativeCases:\n  - id: viewer-denied\n    actor: project_viewer', 'negativeCases: []'),
			'guarantees/project/question/market-package.guarantee.yaml');
		writeFileSync(resolve(marketRoot, 'guarantees/market.verifiers.yaml'), `schemaVersion: treeseed.guarantee-verifiers/v1
ownerPackage: "@treeseed/market"
verifiers:
  fixture.market-package:
    kind: packageScript
    command: verify:market
`);
		const report = await runGuarantees({
			workspaceRoot: marketRoot,
			now: new Date('2026-01-01T00:00:00.000Z'),
		});
		expect(report.ok).toBe(true);
		expect(report.results[0]?.status).toBe('passed');
		expect(report.results[0]?.evidence[0]).toContain('fixture-market-package.json');
		const evidence = JSON.parse(readFileSync(resolve(marketRoot, report.outputRoot, 'evidence', 'fixture-market-package.json'), 'utf8'));
		expect(evidence.args).toEqual(['run', 'verify:market', '--']);
		expect(evidence.stdout).toContain('market package script ran');
	});

it('executes API acceptance verifiers with local defaults and redacted service-secret evidence', async () => {
		const root = workspaceFixture('api-acceptance-command');
		writeGuarantee(root, validGuarantee
			.replace('status: planned', 'surface: api-control-plane\nstatus: active')
			.replace('gates: [core, release]', 'gates: [core]')
			.replace('todo.project.question.ask-question.api', 'fixture.acceptance.case')
			.replace('todo.project.question.ask-question.content', '')
			.replace('todo.project.question.ask-question.audit', '')
			.replace('scene:\n  required: true', 'scene:\n  required: false')
			.replace('content:\n  required: true', 'content:\n  required: false')
			.replace('audit:\n  required: true', 'audit:\n  required: false')
			.replace('negativeCases:\n  - id: viewer-denied\n    actor: project_viewer', `negativeCases:
  - id: viewer-denied
    actor: project_viewer`));
		writeFileSync(resolve(root, 'packages/admin/guarantees/acceptance.verifiers.yaml'), `schemaVersion: treeseed.guarantee-verifiers/v1
ownerPackage: "@treeseed/admin"
verifiers:
  fixture.acceptance.case:
    kind: apiAcceptanceCase
    caseId: acceptance.fixture.case
    timeoutSeconds: 5
`);
		const previousSecret = process.env.TREESEED_ACCEPTANCE_SERVICE_SECRET;
		process.env.TREESEED_ACCEPTANCE_SERVICE_SECRET = 'super-secret-value';
		try {
			const report = await runGuarantees({
				workspaceRoot: root,
				now: new Date('2026-01-01T00:00:00.000Z'),
			});
			expect(report.ok).toBe(false);
			expect(report.results[0]?.steps[0]?.ref).toBe('fixture.acceptance.case');
			expect(report.results[0]?.steps[0]?.status).toBe('failed');
			const evidencePath = resolve(root, report.outputRoot, 'evidence', 'fixture-acceptance-case.json');
			expect(fileExists(evidencePath)).toBe(true);
			const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
			expect(evidence.args).toEqual([
				'-w',
				'packages/api',
				'run',
				'test:acceptance',
				'--',
				'--environment',
				'local',
				'--base-url',
				'http://127.0.0.1:3000',
				'--case',
				'acceptance.fixture.case',
				'--json',
			]);
			expect(evidence.env.TREESEED_ACCEPTANCE_SERVICE_ID).toBe('web');
			expect(evidence.env.TREESEED_ACCEPTANCE_SERVICE_SECRET).toBe('<redacted>');
		} finally {
			if (previousSecret === undefined) delete process.env.TREESEED_ACCEPTANCE_SERVICE_SECRET;
			else process.env.TREESEED_ACCEPTANCE_SERVICE_SECRET = previousSecret;
		}
	});

it('counts skipped planned release guarantees as release-blocking when the run requests that policy', async () => {
		const root = workspaceFixture('planned-release-skip-policy');
		writeGuarantee(root, validGuarantee);
		const report = await runGuarantees({
			workspaceRoot: root,
			includePlanned: true,
			failOnSkippedReleaseGuarantees: true,
			now: new Date('2026-01-01T00:00:00.000Z'),
		});
		expect(report.ok).toBe(false);
		expect(report.counts.skipped).toBe(1);
		expect(report.counts.releaseBlockingFailures).toBe(1);
		expect(report.results[0]?.status).toBe('skipped');
		expect(report.results[0]?.steps[0]?.summary).toBe('Guarantee is planned.');
	});

it('caches identical verifier refs within one guarantee run', async () => {
		const root = workspaceFixture('runner-cache');
		const active = validGuarantee
			.replace('status: planned', 'surface: admin-ui\nstatus: active')
			.replace('todo.project.question.ask-question.api', 'fixture.shared.api')
			.replace('todo.project.question.ask-question.content', 'fixture.shared.api')
			.replace('todo.project.question.ask-question.audit', 'fixture.shared.api')
			.replace('scene:\n  required: true', 'scene:\n  required: false');
		writeGuarantee(root, active);
		writeGuarantee(root, active
			.replaceAll('ask-question', 'edit-question')
			.replace('Ask Question', 'Edit Question')
			.replace('journeyIndex: 38', 'journeyIndex: 39')
			.replace('id: guarantee.project.question.edit-question.038', 'id: guarantee.project.question.edit-question.039'), 'packages/admin/guarantees/project/question/edit-question.guarantee.yaml');
		writeFileSync(resolve(root, 'packages/admin/guarantees/test.verifiers.yaml'), `schemaVersion: treeseed.guarantee-verifiers/v1
ownerPackage: "@treeseed/admin"
verifiers:
  fixture.shared.api:
    kind: vitestCase
    testFile: test/fixture.test.ts
`);
		const calls: string[] = [];
		const report = await runGuarantees({
			workspaceRoot: root,
			verifierExecutor: async ({ ref }) => {
				calls.push(ref);
				return { status: 'passed', summary: `${ref} passed`, evidence: [`evidence/${ref}.json`] };
			},
			now: new Date('2026-01-01T00:00:00.000Z'),
		});
		expect(report.ok).toBe(true);
		expect(report.counts.passed).toBe(2);
		expect(calls).toEqual(['fixture.shared.api']);
		expect(report.results[1]?.steps.map((step) => step.summary)).toEqual([
			'fixture.shared.api passed (cached)',
			'fixture.shared.api passed (cached)',
			'fixture.shared.api passed (cached)',
		]);
	});

it('reports planned guarantees as skipped when requested', async () => {
		const root = workspaceFixture('planned-runner');
		writeGuarantee(root, validGuarantee);
		const report = await runGuarantees({ workspaceRoot: root, includePlanned: true, now: new Date('2026-01-01T00:00:00.000Z') });
		expect(report.ok).toBe(true);
		expect(report.counts.planned).toBe(1);
		expect(report.counts.skipped).toBe(1);
	});

it('creates status summaries grouped by type and status', () => {
		const root = workspaceFixture('status');
		writeGuarantee(root, validGuarantee);
		const status = createGuaranteeStatusReport({ workspaceRoot: root });
		expect(status.ok).toBe(true);
		expect(status.byType.project).toBe(1);
		expect(status.byStatus.planned).toBe(1);
		expect(status.guaranteeRoots).toEqual(['packages/admin/guarantees']);
	});

it('rejects vitest verifier output that executed no assertions', () => {
		expect(validateVitestVerifierOutput({
			stdout: ' Test Files  1 passed (1)\n      Tests  2 passed (2)\n',
			stderr: '',
		})).toBeNull();
		expect(validateVitestVerifierOutput({
			stdout: ' Test Files  1 skipped (1)\n      Tests  27 skipped (27)\n',
			stderr: '',
		})).toContain('without executing any assertions');
		expect(validateVitestVerifierOutput({
			stdout: 'No test files found, exiting with code 0\n',
			stderr: '',
		})).toContain('without executing any assertions');
		expect(validateVitestVerifierOutput({
			stdout: '',
			stderr: '\u001B[31m Tests  3 failed (3)\u001B[0m\r\n',
		})).toBeNull();
	});
});
