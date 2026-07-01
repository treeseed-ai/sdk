import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
	discoverTreeseedGuarantees,
	exportTreeseedGuaranteesCsv,
	normalizeTreeseedGuaranteeTaxonomy,
	planTreeseedGuarantees,
	runTreeseedGuarantees,
} from '../../src/guarantees/index.ts';

function workspaceFixture(name: string) {
	const root = resolve(tmpdir(), `treeseed-guarantees-${name}-${process.pid}-${Date.now()}`);
	mkdirSync(resolve(root, 'packages', 'admin', 'guarantees', 'project', 'question', 'scenes'), { recursive: true });
	writeFileSync(resolve(root, 'package.json'), JSON.stringify({ name: '@treeseed/market' }));
	writeFileSync(resolve(root, 'packages', 'admin', 'package.json'), JSON.stringify({ name: '@treeseed/admin' }));
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
	it('validates lowercase taxonomy and planned placeholder verifiers', () => {
		const root = workspaceFixture('valid');
		writeGuarantee(root, validGuarantee);
		writeFileSync(resolve(root, 'packages/admin/guarantees/project/question/scenes/ask-question.scene.yaml'), 'schemaVersion: treeseed.scene/v1\nid: fixture\n');
		const report = discoverTreeseedGuarantees({ workspaceRoot: root });
		expect(report.ok).toBe(true);
		expect(report.counts.valid).toBe(1);
	});

	it('rejects mixed-case taxonomy and path mismatches', () => {
		const root = workspaceFixture('taxonomy');
		writeGuarantee(root, validGuarantee.replace('type: project', 'type: Project'));
		const report = discoverTreeseedGuarantees({ workspaceRoot: root });
		expect(report.ok).toBe(false);
		expect(report.diagnostics.map((entry) => entry.code)).toContain('guarantee.invalid_type');
		expect(report.diagnostics.map((entry) => entry.code)).toContain('guarantee.type_path_mismatch');
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

	it('exports canonical lowercase CSV values', () => {
		const root = workspaceFixture('csv');
		writeGuarantee(root, validGuarantee);
		const report = discoverTreeseedGuarantees({ workspaceRoot: root });
		const csv = exportTreeseedGuaranteesCsv({ guarantees: report.guarantees });
		expect(csv).toContain('guarantee.project.question.ask-question.038');
		expect(csv).toContain(',project,question,');
		expect(csv).toContain('"CSV commas, quotes, and newlines should export safely."');
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
		const report = await runTreeseedGuarantees({
			workspaceRoot: root,
			verifierExecutor: async ({ ref }) => ({ status: 'passed', summary: `${ref} passed`, evidence: [`evidence/${ref}.json`] }),
			now: new Date('2026-01-01T00:00:00.000Z'),
		});
		expect(report.ok).toBe(true);
		expect(report.counts.passed).toBe(1);
		expect(report.results[0]?.steps.map((step) => step.ref)).toEqual(['fixture.question.api', 'fixture.question.content', 'fixture.question.audit']);
		expect(report.outputRoot).toContain('.treeseed/guarantees/runs/2026-01-01T00-00-00-000Z');
	});

	it('caches identical verifier refs within one guarantee run', async () => {
		const root = workspaceFixture('runner-cache');
		const active = validGuarantee
			.replace('status: planned', 'surface: admin-ui\nstatus: active')
			.replace('todo.project.question.ask-question.api', 'fixture.shared.api')
			.replace('todo.project.question.ask-question.content', 'fixture.shared.content')
			.replace('todo.project.question.ask-question.audit', 'fixture.shared.audit')
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
  fixture.shared.content:
    kind: vitestCase
    testFile: test/fixture.test.ts
  fixture.shared.audit:
    kind: vitestCase
    testFile: test/fixture.test.ts
`);
		const calls: string[] = [];
		const report = await runTreeseedGuarantees({
			workspaceRoot: root,
			verifierExecutor: async ({ ref }) => {
				calls.push(ref);
				return { status: 'passed', summary: `${ref} passed`, evidence: [`evidence/${ref}.json`] };
			},
			now: new Date('2026-01-01T00:00:00.000Z'),
		});
		expect(report.ok).toBe(true);
		expect(report.counts.passed).toBe(2);
		expect(calls.sort()).toEqual(['fixture.shared.api', 'fixture.shared.audit', 'fixture.shared.content']);
		expect(report.results[1]?.steps.map((step) => step.summary)).toEqual([
			'fixture.shared.api passed (cached)',
			'fixture.shared.content passed (cached)',
			'fixture.shared.audit passed (cached)',
		]);
	});

	it('reports planned guarantees as skipped when requested', async () => {
		const root = workspaceFixture('planned-runner');
		writeGuarantee(root, validGuarantee);
		const report = await runTreeseedGuarantees({ workspaceRoot: root, includePlanned: true, now: new Date('2026-01-01T00:00:00.000Z') });
		expect(report.ok).toBe(true);
		expect(report.counts.planned).toBe(1);
		expect(report.counts.skipped).toBe(1);
	});
});
