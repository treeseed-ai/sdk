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
it('reports duplicate state producers instead of choosing an ambiguous producer', () => {
		const root = workspaceFixture('duplicate-state-producer');
		const active = validGuarantee
			.replace('status: planned', 'surface: admin-ui\nstatus: active')
			.replace('todo.project.question.ask-question.api', 'fixture.question.api')
			.replace('todo.project.question.ask-question.content', 'fixture.question.content')
			.replace('todo.project.question.ask-question.audit', 'fixture.question.audit');
		writeGuarantee(root, active);
		writeGuarantee(root, active
			.replaceAll('ask-question', 'edit-question')
			.replace('Ask Question', 'Edit Question')
			.replace('journeyIndex: 38', 'journeyIndex: 39')
			.replace('id: guarantee.project.question.edit-question.038', 'id: guarantee.project.question.edit-question.039'), 'packages/admin/guarantees/project/question/edit-question.guarantee.yaml');
		writeGuarantee(root, active
			.replaceAll('ask-question', 'follow-up')
			.replace('Ask Question', 'Follow Up')
			.replace('journeyIndex: 38', 'journeyIndex: 40')
			.replace('id: guarantee.project.question.follow-up.038', 'id: guarantee.project.question.follow-up.040')
			.replace('guarantees: []', 'guarantees: [guarantee.project.question.ask-question.038, guarantee.project.question.edit-question.039]')
			.replace('manifest: ./scenes/ask-question.scene.yaml', 'manifest: ./scenes/follow-up.scene.yaml'), 'packages/admin/guarantees/project/question/follow-up.guarantee.yaml');
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
		writeFileSync(resolve(root, 'packages/admin/guarantees/project/question/scenes/ask-question.scene.yaml'), `schemaVersion: treeseed.scene/v1
id: ask-question
journey:
  kind: service
  producesState:
    - key: question.primary
      kind: custom
workflow: []
`);
		writeFileSync(resolve(root, 'packages/admin/guarantees/project/question/scenes/edit-question.scene.yaml'), `schemaVersion: treeseed.scene/v1
id: edit-question
journey:
  kind: service
  producesState:
    - key: question.primary
      kind: custom
workflow: []
`);
		writeFileSync(resolve(root, 'packages/admin/guarantees/project/question/scenes/follow-up.scene.yaml'), `schemaVersion: treeseed.scene/v1
id: follow-up
journey:
  kind: service
  consumesState:
    - key: question.primary
      kind: custom
workflow: []
`);
		const plan = planGuarantees({ workspaceRoot: root, filter: { ids: ['guarantee.project.question.follow-up.040'] } });
		expect(plan.ok).toBe(false);
		expect(plan.diagnostics.map((entry) => entry.code)).toContain('guarantee.state_duplicate_producer');
		expect(plan.entries.find((entry) => entry.id === 'guarantee.project.question.follow-up.040')?.dependsOn).toEqual([
			'guarantee.project.question.ask-question.038',
			'guarantee.project.question.edit-question.039',
		]);
	});

it('reports cyclic guarantee dependencies during planning without overflowing depth calculation', () => {
		const root = workspaceFixture('dependency-cycle-plan');
		const active = validGuarantee
			.replace('status: planned', 'surface: admin-ui\nstatus: active')
			.replace('todo.project.question.ask-question.api', 'fixture.question.api')
			.replace('todo.project.question.ask-question.content', 'fixture.question.content')
			.replace('todo.project.question.ask-question.audit', 'fixture.question.audit')
			.replace('scene:\n  required: true', 'scene:\n  required: false')
			.replace('guarantees: []', 'guarantees: [guarantee.project.question.edit-question.039]');
		writeGuarantee(root, active);
		writeGuarantee(root, active
			.replaceAll('ask-question', 'edit-question')
			.replace('Ask Question', 'Edit Question')
			.replace('journeyIndex: 38', 'journeyIndex: 39')
			.replace('id: guarantee.project.question.edit-question.038', 'id: guarantee.project.question.edit-question.039')
			.replace('guarantees: [guarantee.project.question.edit-question.039]', 'guarantees: [guarantee.project.question.ask-question.038]'), 'packages/admin/guarantees/project/question/edit-question.guarantee.yaml');
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
		expect(() => planGuarantees({ workspaceRoot: root, filter: { ids: ['guarantee.project.question.ask-question.038'] } })).not.toThrow();
		const plan = planGuarantees({ workspaceRoot: root, filter: { ids: ['guarantee.project.question.ask-question.038'] } });
		expect(plan.ok).toBe(false);
		expect(plan.diagnostics.map((entry) => entry.code)).toContain('guarantee.dependency_cycle');
	});

it('audits active scene-backed service journeys and rejects weak active scenes', () => {
		const root = workspaceFixture('journey-audit');
		mkdirSync(resolve(root, 'packages/admin/src/pages/app/work/questions'), { recursive: true });
		writeFileSync(resolve(root, 'packages/admin/src/pages/app/work/questions/new.astro'), '---\n---\n');
		writeGuarantee(root, validGuarantee
			.replace('status: planned', 'surface: admin-ui\nstatus: active')
			.replace('api:\n  required: true', 'api:\n  required: false')
			.replace('content:\n  required: true', 'content:\n  required: false')
			.replace('audit:\n  required: true', 'audit:\n  required: false')
			.replace('todo.project.question.ask-question.api', '')
			.replace('todo.project.question.ask-question.content', '')
			.replace('todo.project.question.ask-question.audit', '')
			.replace('entryRoute: /app/questions', 'entryRoute: /app/work/questions/new'));
		writeFileSync(resolve(root, 'packages/admin/guarantees/project/question/scenes/ask-question.scene.yaml'), `schemaVersion: treeseed.scene/v1
id: ask-question
journey:
  kind: service
  minimumSteps: 2
workflow:
  - id: open
    action:
      goto: /app/work/questions/new
    expect:
      urlIncludes: /app/work/questions/new
  - id: fill-question
    action:
      fill:
        role: textbox
        name: Question
        value: What should we build next?
    expect:
      text: Question
`);
		expect(auditGuaranteeJourneys({ workspaceRoot: root }).ok).toBe(true);
		writeFileSync(resolve(root, 'packages/admin/guarantees/project/question/scenes/ask-question.scene.yaml'), `schemaVersion: treeseed.scene/v1
id: ask-question
workflow:
  - id: open
    action:
      goto: /app/work/questions/new
`);
		const weak = auditGuaranteeJourneys({ workspaceRoot: root });
		expect(weak.ok).toBe(false);
		expect(weak.totals.activeSceneBackedWeak).toBe(1);
	});
});
