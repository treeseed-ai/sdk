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
it('audits missing routes, brittle selectors, planned weak scenes, absolute routes, and report output', () => {
		const root = workspaceFixture('journey-audit-edges');
		mkdirSync(resolve(root, 'packages/admin/src/pages/app/good'), { recursive: true });
		writeFileSync(resolve(root, 'packages/admin/src/pages/app/good/index.astro'), '---\n---\n');
		mkdirSync(resolve(root, 'packages/admin/guarantees/project/question/scenes'), { recursive: true });

		const activeBase = validGuarantee
			.replace('status: planned', 'surface: admin-ui\nstatus: active')
			.replace('api:\n  required: true', 'api:\n  required: false')
			.replace('content:\n  required: true', 'content:\n  required: false')
			.replace('audit:\n  required: true', 'audit:\n  required: false')
			.replace('todo.project.question.ask-question.api', '')
			.replace('todo.project.question.ask-question.content', '')
			.replace('todo.project.question.ask-question.audit', '');

		writeGuarantee(root, activeBase
			.replace('id: guarantee.project.question.ask-question.038', 'id: guarantee.project.question.missing-route.041')
			.replace('journeyIndex: 38', 'journeyIndex: 41')
			.replace('journey: Ask Question', 'journey: Missing Route')
			.replace('manifest: ./scenes/ask-question.scene.yaml', 'manifest: ./scenes/missing-route.scene.yaml\n  entryRoute: /app/missing-route'),
			'packages/admin/guarantees/project/question/missing-route.guarantee.yaml');
		writeFileSync(resolve(root, 'packages/admin/guarantees/project/question/scenes/missing-route.scene.yaml'), `schemaVersion: treeseed.scene/v1
id: missing-route
journey:
  kind: service
  minimumSteps: 2
workflow:
  - id: open
    action:
      goto: /app/missing-route
    expect:
      urlIncludes: /app/missing-route
  - id: act
    action:
      click:
        role: button
        name: Continue
    expect:
      text: Done
`);

		writeGuarantee(root, activeBase
			.replace('id: guarantee.project.question.ask-question.038', 'id: guarantee.project.question.brittle-selector.042')
			.replace('journeyIndex: 38', 'journeyIndex: 42')
			.replace('journey: Ask Question', 'journey: Brittle Selector')
			.replace('manifest: ./scenes/ask-question.scene.yaml', 'manifest: ./scenes/brittle-selector.scene.yaml\n  entryRoute: https://example.test/app/good?tab=one'),
			'packages/admin/guarantees/project/question/brittle-selector.guarantee.yaml');
		writeFileSync(resolve(root, 'packages/admin/guarantees/project/question/scenes/brittle-selector.scene.yaml'), `schemaVersion: treeseed.scene/v1
id: brittle-selector
journey:
  kind: service
  minimumSteps: 2
workflow:
  - id: open
    action:
      goto:
        url: https://example.test/app/good?tab=one
    expect:
      urlIncludes: /app/good
  - id: css-click
    action:
      click:
        selector: .dangerously-brittle
    expect:
      text: Done
`);

		writeGuarantee(root, validGuarantee
			.replace('id: guarantee.project.question.ask-question.038', 'id: guarantee.project.question.planned-weak.043')
			.replace('journeyIndex: 38', 'journeyIndex: 43')
			.replace('journey: Ask Question', 'journey: Planned Weak')
			.replace('manifest: ./scenes/ask-question.scene.yaml', 'manifest: ./scenes/planned-weak.scene.yaml\n  entryRoute: /app/good'),
			'packages/admin/guarantees/project/question/planned-weak.guarantee.yaml');
		writeFileSync(resolve(root, 'packages/admin/guarantees/project/question/scenes/planned-weak.scene.yaml'), `schemaVersion: treeseed.scene/v1
id: planned-weak
workflow:
  - id: open
    action:
      goto: /app/good
`);

		const audit = auditTreeseedGuaranteeJourneys({
			workspaceRoot: root,
			writeReport: 'generated/journey-audit.json',
			now: new Date('2026-01-01T00:00:00.000Z'),
		});
		expect(audit.ok).toBe(false);
		expect(audit.totals.activeMissingRoutes).toBe(1);
		expect(audit.totals.activeMissingSelectors).toBe(1);
		expect(audit.totals.weakSceneContracts).toBeGreaterThanOrEqual(1);
		expect(audit.items.find((entry) => entry.guaranteeId.endsWith('missing-route.041'))?.classification).toBe('missing-product-route');
		expect(audit.items.find((entry) => entry.guaranteeId.endsWith('brittle-selector.042'))?.classification).toBe('missing-stable-selectors');
		expect(audit.items.find((entry) => entry.guaranteeId.endsWith('planned-weak.043'))?.classification).toBe('planned-product-contract');
		expect(audit.items.find((entry) => entry.guaranteeId.endsWith('brittle-selector.042'))?.currentRoute).toBe('/app/good');
		expect(fileExists(resolve(root, 'generated/journey-audit.json'))).toBe(true);
	});

it('audits absent scene manifests and empty route actions as repairable planned contracts', () => {
		const root = workspaceFixture('journey-audit-missing-manifest');
		writeGuarantee(root, validGuarantee
			.replace('manifest: ./scenes/ask-question.scene.yaml', 'manifest: ./scenes/does-not-exist.scene.yaml\n  entryRoute: ""'));
		const audit = auditTreeseedGuaranteeJourneys({ workspaceRoot: root });
		expect(audit.ok).toBe(false);
		expect(audit.items[0]).toMatchObject({
			classification: 'planned-product-contract',
		});
		expect(audit.items[0]).not.toHaveProperty('currentRoute');
		expect(audit.diagnostics.map((entry) => entry.code)).toContain('guarantee.scene_missing_manifest');

		writeGuarantee(root, validGuarantee
			.replace('id: guarantee.project.question.ask-question.038', 'id: guarantee.project.question.invalid-workflow.102')
			.replace('journeyIndex: 38', 'journeyIndex: 102')
			.replace('manifest: ./scenes/ask-question.scene.yaml', 'manifest: ./scenes/invalid-workflow.scene.yaml'),
		'packages/admin/guarantees/project/question/invalid-workflow.guarantee.yaml');
		writeFileSync(resolve(root, 'packages/admin/guarantees/project/question/scenes/invalid-workflow.scene.yaml'), `schemaVersion: treeseed.scene/v1
id: invalid-workflow
workflow:
  - scalar-step
  - id: absent-action
    expect:
      text: Ready
  - id: empty-action
    action: {}
  - id: query-route
    action:
      goto:
        url: "?tab=one"
    expect: {}
`);
		const invalidWorkflow = auditTreeseedGuaranteeJourneys({ workspaceRoot: root });
		expect(invalidWorkflow.items.find((entry) => entry.guaranteeId.endsWith('invalid-workflow.102'))).toMatchObject({
			classification: 'missing-product-route',
		});
	});

it('validates UI guarantees depending on active API endpoint guarantee refs', () => {
		const root = workspaceFixture('depends-on-api');
		mkdirSync(resolve(root, 'packages/api/guarantees/verifiers'), { recursive: true });
		writeGuarantee(root, `
schemaVersion: treeseed.guarantee/v1
id: guarantee.api.endpoints.auth-and-sessions.401
journeyIndex: 401
type: api
subtype: endpoints
journey: Auth And Session Endpoint Reliability
ownerPackage: "@treeseed/api"
surface: api-control-plane
summary: Auth endpoints are covered.
status: active
actors:
  allowed: [authenticated_user]
  forbidden: [anonymous_user]
devices:
  required: []
gates: [core]
preconditions:
  fixtures: []
api:
  required: true
  verifierRefs: [api.endpoints.auth-and-sessions]
negativeCases:
  - id: denied
    verifierRefs: [api.endpoints.auth-and-sessions]
evidence:
  required: [api_acceptance_report]
`, 'packages/api/guarantees/api/endpoints/auth-and-sessions.guarantee.yaml');
		writeFileSync(resolve(root, 'packages/api/guarantees/verifiers/api.verifiers.yaml'), `schemaVersion: treeseed.guarantee-verifiers/v1
ownerPackage: "@treeseed/api"
verifiers:
  api.endpoints.auth-and-sessions:
    kind: apiAcceptanceCase
    caseId: auth.web.sign-in.site-admin
`);
		writeGuarantee(root, validGuarantee
			.replace('status: planned', 'surface: admin-ui\nstatus: planned')
			.replace('dependencies:\n  journeys: []\n  guarantees: []', `dependencies:\n  journeys: []\n  guarantees: []\ndependsOnGuarantees:\n  - ownerPackage: "@treeseed/api"\n    ref: api.endpoints.auth-and-sessions`));
		const report = discoverTreeseedGuarantees({ workspaceRoot: root });
		expect(report.ok).toBe(true);

		writeGuarantee(root, validGuarantee
			.replace('id: guarantee.project.question.ask-question.038', 'id: guarantee.project.question.missing-api.040')
			.replace('journeyIndex: 38', 'journeyIndex: 40')
			.replace('status: planned', 'surface: admin-ui\nstatus: planned')
			.replace('dependencies:\n  journeys: []\n  guarantees: []', `dependencies:\n  journeys: []\n  guarantees: []\ndependsOnGuarantees:\n  - ownerPackage: "@treeseed/api"\n    ref: api.endpoints.missing`),
			'packages/admin/guarantees/project/question/missing-api.guarantee.yaml');
		const missing = discoverTreeseedGuarantees({ workspaceRoot: root });
		expect(missing.ok).toBe(false);
		expect(missing.diagnostics.map((entry) => entry.code)).toContain('guarantee.missing_depends_on_guarantee');
	});

it('exports canonical lowercase CSV values', () => {
		const root = workspaceFixture('csv');
		writeGuarantee(root, validGuarantee);
		const report = discoverTreeseedGuarantees({ workspaceRoot: root });
		const csv = exportTreeseedGuaranteesCsv({ guarantees: report.guarantees });
		expect(csv).toContain('guarantee.project.question.ask-question.038');
		expect(csv).toContain(',project,question,');
		expect(csv).toContain('"CSV commas, quotes, and newlines should export safely."');
		expect(exportTreeseedGuaranteesJson({ registry: report }).guarantees[0]?.id).toBe('guarantee.project.question.ask-question.038');
		expect(exportTreeseedGuaranteesMarkdown({ registry: report })).toContain('| guarantee.project.question.ask-question.038 |');
		const jsonExport = writeTreeseedGuaranteesExport({ workspaceRoot: root, format: 'json', output: 'generated/guarantees.json' });
		const markdownExport = writeTreeseedGuaranteesExport({ workspaceRoot: root, format: 'markdown', output: 'generated/guarantees.md' });
		const csvExport = writeTreeseedGuaranteesExport({ workspaceRoot: root, format: 'csv', output: 'generated/guarantees.csv' });
		expect(jsonExport.ok).toBe(true);
		expect(markdownExport.ok).toBe(true);
		expect(csvExport.ok).toBe(true);
		expect(fileExists(resolve(root, 'generated/guarantees.json'))).toBe(true);
	});

it('normalizes taxonomy suggestions', () => {
		expect(normalizeTreeseedGuaranteeTaxonomy('MarketplaceSeller')).toBe('marketplace-seller');
		expect(normalizeTreeseedGuaranteeTaxonomy('TreeDX Routing')).toBe('treedx-routing');
	});

it('validates guarantee surfaces', () => {
		const root = workspaceFixture('surface');
		writeGuarantee(root, validGuarantee.replace('summary: Ask a project question.', 'surface: AdminUI\nsummary: Ask a project question.'));
		const report = discoverTreeseedGuarantees({ workspaceRoot: root });
		expect(report.ok).toBe(false);
		expect(report.diagnostics.map((entry) => entry.code)).toContain('guarantee.invalid_surface');
	});
});
