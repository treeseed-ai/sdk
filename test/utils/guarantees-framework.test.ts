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
} from '../../src/guarantees/index.ts';

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
		const report = discoverTreeseedGuarantees({ workspaceRoot: root });
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
		const report = discoverTreeseedGuarantees({ workspaceRoot: root });
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
		const report = discoverTreeseedGuarantees({ workspaceRoot: root });
		expect(report.ok).toBe(false);
		expect(report.diagnostics.map((entry) => entry.code)).toContain('guarantee.invalid_type');
		expect(report.diagnostics.map((entry) => entry.code)).toContain('guarantee.type_path_mismatch');
	});

	it('reports malformed manifests, duplicates, invalid filters, and verifier registry errors', () => {
		const root = workspaceFixture('malformed');
		writeGuarantee(root, 'schemaVersion: [', 'packages/admin/guarantees/project/question/bad-yaml.guarantee.yaml');
		writeGuarantee(root, '[]', 'packages/admin/guarantees/project/question/not-object.guarantee.yaml');
		writeGuarantee(root, validGuarantee
			.replace('status: planned', 'status: active')
			.replace('ownerPackage: "@treeseed/admin"', 'ownerPackage: "@treeseed/api"')
			.replace('devices:\n  required: [desktop_chromium]', 'devices:\n  required: [desktop_chromium, hologram]')
			.replace('gates: [core, release]', 'gates: [core, mystery]')
			.replace('scene:\n  required: true', 'scene:\n  required: false')
			.replace('api:\n  required: true', 'api:\n  required: false')
			.replace('content:\n  required: true', 'content:\n  required: false')
			.replace('audit:\n  required: true', 'audit:\n  required: false')
			.replace('evidence:\n  required: [playwright_trace, api_verification_log]', 'evidence:\n  required: []'),
			'packages/admin/guarantees/project/question/active-invalid.guarantee.yaml');
		writeGuarantee(root, validGuarantee, 'packages/admin/guarantees/project/question/duplicate-a.guarantee.yaml');
		writeGuarantee(root, validGuarantee, 'packages/admin/guarantees/project/question/duplicate-b.guarantee.yaml');
		writeGuarantee(root, validGuarantee
			.replace('id: guarantee.project.question.ask-question.038', 'id: guarantee.project.question.forward.039')
			.replace('journeyIndex: 38', 'journeyIndex: 39')
			.replace('dependencies:\n  journeys: []\n  guarantees: []', 'dependencies:\n  journeys: [40]\n  guarantees: [guarantee.project.question.missing.999]'),
			'packages/admin/guarantees/project/question/forward.guarantee.yaml');
		writeFileSync(resolve(root, 'packages/admin/guarantees/bad.verifiers.yaml'), `schemaVersion: wrong
ownerPackage: "@treeseed/api"
verifiers:
  bad-entry: nope
  missing-kind: {}
  weird:
    kind: strange
`);

		const registry = discoverTreeseedGuarantees({ workspaceRoot: root, filter: { type: 'Project' } });
		expect(registry.ok).toBe(false);
		expect(registry.counts.selected).toBe(0);
		expect(registry.diagnostics.map((entry) => entry.code)).toEqual(expect.arrayContaining([
			'guarantee.yaml_parse_error',
			'guarantee.invalid_manifest',
			'guarantee.owner_package_mismatch',
			'guarantee.invalid_device',
			'guarantee.invalid_gate',
			'guarantee.active_missing_contract',
			'guarantee.duplicate_id',
			'guarantee.duplicate_journey_index',
			'guarantee.missing_dependency',
			'guarantee.missing_journey_dependency',
			'guarantee.forward_journey_dependency',
			'guarantee_filter.invalid_type',
			'guarantee_verifiers.unsupported_schema_version',
			'guarantee_verifiers.owner_package_mismatch',
			'guarantee_verifiers.invalid_entry',
			'guarantee_verifiers.missing_kind',
			'guarantee_verifiers.invalid_kind',
		]));

		const loadedRegistry = loadTreeseedGuaranteeVerifierRegistry({ workspaceRoot: root, path: resolve(root, 'packages/admin/guarantees/bad.verifiers.yaml') });
		expect(loadedRegistry.diagnostics.map((entry) => entry.code)).toContain('guarantee_verifiers.invalid_kind');
		const direct = validateTreeseedGuarantee({ workspaceRoot: root, path: resolve(root, 'packages/admin/guarantees/project/question/active-invalid.guarantee.yaml') });
		expect(direct.diagnostics.map((entry) => entry.code)).toContain('guarantee.owner_package_mismatch');
	});

	it('covers parser edge cases for invalid manifests, filters, missing package names, and treedx paths', () => {
		const root = workspaceFixture('parser-edges');
		writeGuarantee(root, `
schemaVersion: treeseed.guarantee/v0
id: bad-id
type: project
subtype: Question
journey: ""
ownerPackage: "@treeseed/admin"
status: unknown
dependencies: {}
actors: {}
devices: {}
gates: []
preconditions: {}
evidence: {}
`, 'packages/admin/guarantees/project/question/parser-edge.guarantee.yaml');
		const invalid = validateTreeseedGuarantee({ workspaceRoot: root, path: resolve(root, 'packages/admin/guarantees/project/question/parser-edge.guarantee.yaml') });
		expect(invalid.diagnostics.map((entry) => entry.code)).toEqual(expect.arrayContaining([
			'guarantee.unsupported_schema_version',
			'guarantee.missing_required_field',
			'guarantee.invalid_id',
			'guarantee.invalid_subtype',
			'guarantee.invalid_status',
			'guarantee.subtype_path_mismatch',
		]));

		mkdirSync(resolve(root, 'packages', 'no-package', 'guarantees', 'project', 'question'), { recursive: true });
		writeFileSync(resolve(root, 'packages/no-package/guarantees/project/question/fallback.guarantee.yaml'), validGuarantee.replace('ownerPackage: "@treeseed/admin"', 'ownerPackage: "@treeseed/market"'));
		const fallback = validateTreeseedGuarantee({ workspaceRoot: root, path: resolve(root, 'packages/no-package/guarantees/project/question/fallback.guarantee.yaml') });
		expect(fallback.ownerPackage).toBe('@treeseed/market');
		expect(fallback.diagnostics.map((entry) => entry.code)).not.toContain('guarantee.owner_package_mismatch');

		mkdirSync(resolve(root, 'packages', 'treedx', 'guarantees', 'project', 'question'), { recursive: true });
		writeFileSync(resolve(root, 'packages/treedx/package.json'), JSON.stringify({ name: '@treeseed/treedx' }));
		writeFileSync(resolve(root, 'packages/treedx/guarantees/project/question/bad.guarantee.yaml'), validGuarantee.replace('ownerPackage: "@treeseed/admin"', 'ownerPackage: "@treeseed/treedx"'));
		const treedx = validateTreeseedGuarantee({ workspaceRoot: root, path: resolve(root, 'packages/treedx/guarantees/project/question/bad.guarantee.yaml') });
		expect(treedx.diagnostics.map((entry) => entry.code)).toContain('guarantee.treedx_product_semantics_forbidden');

		writeFileSync(resolve(root, 'packages/admin/guarantees/missing-owner.verifiers.yaml'), `schemaVersion: treeseed.guarantee-verifiers/v1
verifiers:
  empty: {}
`);
		const registry = loadTreeseedGuaranteeVerifierRegistry({ workspaceRoot: root, path: resolve(root, 'packages/admin/guarantees/missing-owner.verifiers.yaml') });
		expect(registry.diagnostics.map((entry) => entry.code)).toEqual(expect.arrayContaining([
			'guarantee_verifiers.missing_owner_package',
			'guarantee_verifiers.missing_kind',
		]));

		writeGuarantee(root, validGuarantee);
		const filtered = discoverTreeseedGuarantees({
			workspaceRoot: root,
			filter: {
				subtype: 'missing',
				ownerPackage: '@treeseed/api',
				status: 'active',
				journeyIndexes: [999],
			},
		});
		expect(filtered.counts.selected).toBe(0);

		writeGuarantee(root, validGuarantee
			.replace('guarantee.project.question.ask-question.038', 'guarantee.api.endpoints.auth-and-sessions.999')
			.replace('journeyIndex: 38', 'journeyIndex: 999')
			.replace('ownerPackage: "@treeseed/admin"', 'ownerPackage: "@treeseed/api"')
			.replace(/scene:\n  required: true\n  manifest: \.\/scenes\/ask-question\.scene\.yaml\n/u, 'scene:\n  required: false\n'), 'packages/api/guarantees/api/endpoints/auth-and-sessions.guarantee.yaml');
		const ownerFiltered = planTreeseedGuarantees({ workspaceRoot: root, filter: { ownerPackages: ['@treeseed/admin', '@treeseed/api'] }, includeDependencies: false });
		const selectedOwners = ownerFiltered.entries.filter((entry) => entry.selected).map((entry) => entry.ownerPackage);
		expect(selectedOwners).toEqual(expect.arrayContaining(['@treeseed/admin', '@treeseed/api']));
		const sceneFiltered = planTreeseedGuarantees({ workspaceRoot: root, filter: { sceneBacked: true }, includeDependencies: false });
		expect(sceneFiltered.entries.filter((entry) => entry.selected).map((entry) => entry.id)).not.toContain('guarantee.api.endpoints.auth-and-sessions.999');
	});

	it('normalizes minimal guarantee contracts and evaluates every filter independently', () => {
		const root = workspaceFixture('minimal-contract-defaults');
		writeGuarantee(root, `schemaVersion: treeseed.guarantee/v1
id: guarantee.project.question.minimal.101
type: project
subtype: question
journey: Minimal Contract
ownerPackage: "@treeseed/admin"
summary: Minimal planned guarantee.
status: planned
run: {}
scene: {}
api: {}
content: {}
audit: {}
`, 'packages/admin/guarantees/project/question/minimal.guarantee.yaml');
		writeFileSync(resolve(root, 'packages/admin/guarantees/minimal.verifiers.yaml'), `schemaVersion: treeseed.guarantee-verifiers/v1
ownerPackage: "@treeseed/admin"
verifiers:
  minimal.manual:
    kind: manual
  minimal.script:
    kind: packageScript
    command: test
`);
		writeFileSync(resolve(root, 'packages/admin/guarantees/no-map.verifiers.yaml'), `schemaVersion: treeseed.guarantee-verifiers/v1
ownerPackage: "@treeseed/admin"
`);

		const discovered = discoverTreeseedGuarantees({ workspaceRoot: root });
		const manifest = discovered.guarantees.find((entry) => entry.manifest?.id === 'guarantee.project.question.minimal.101')?.manifest;
		expect(manifest).toMatchObject({
			dependencies: { journeys: [], guarantees: [] },
			actors: { allowed: [], forbidden: [] },
			devices: { required: [] },
			preconditions: { fixtures: [], notes: [] },
			evidence: { required: [], optional: [] },
		});

		const filters = [
			{ ownerPackage: '@treeseed/api' },
			{ status: 'active' as const },
			{ type: 'billing' },
			{ subtype: 'payment' },
			{ gate: 'release' },
			{ journeyIndexes: [999] },
			{ journeyIndexes: [] },
			{ ids: ['guarantee.missing'] },
		];
		for (const filter of filters) {
			const report = discoverTreeseedGuarantees({ workspaceRoot: root, filter });
			expect(report.counts.selected).toBe(filter.journeyIndexes?.length === 0 ? 1 : 0);
		}
		expect(discoverTreeseedGuarantees({
			workspaceRoot: root,
			filter: { journeyIndexes: [101] },
		}).counts.selected).toBe(0);
		expect(exportTreeseedGuaranteesCsv({ guarantees: discovered.guarantees })).toContain('guarantee.project.question.minimal.101');
		expect(exportTreeseedGuaranteesJson({ registry: discovered }).guarantees[0]?.sceneManifest).toBeUndefined();
		expect(exportTreeseedGuaranteesMarkdown({ registry: discovered })).toContain('Minimal Contract');

		const noRegistries = resolveTreeseedGuaranteeVerifierRefs({
			refs: [], verifierRegistries: [], status: 'planned', sourcePath: resolve(root, 'minimal.guarantee.yaml'),
		});
		expect(noRegistries).toMatchObject({ ok: true, resolutions: [], diagnostics: [] });
		const noMap = loadTreeseedGuaranteeVerifierRegistry({ workspaceRoot: root, path: resolve(root, 'packages/admin/guarantees/no-map.verifiers.yaml') });
		expect(noMap.registry?.verifiers).toEqual({});
	});

	it('discovers root guarantees while excluding verifier, dependency, and malformed package paths', () => {
		const root = workspaceFixture('discovery-path-branches');
		writeGuarantee(root, validGuarantee
			.replace('ownerPackage: "@treeseed/admin"', 'ownerPackage: "@treeseed/market"'),
		'guarantees/project/question/root.guarantee.yaml');
		writeGuarantee(root, validGuarantee, 'guarantees/verifiers/ignored.guarantee.yaml');
		writeGuarantee(root, validGuarantee, 'node_modules/dependency/guarantees/project/question/ignored.guarantee.yaml');
		mkdirSync(resolve(root, 'packages/bad-package/guarantees/project/question'), { recursive: true });
		writeFileSync(resolve(root, 'packages/bad-package/package.json'), '{');
		writeFileSync(resolve(root, 'packages/bad-package/guarantees/project/question/bad-package.guarantee.yaml'), validGuarantee);
		writeFileSync(resolve(root, 'packages/admin/guarantees/empty.verifiers.yaml'), '');

		const report = discoverTreeseedGuarantees({ workspaceRoot: root });
		expect(report.guarantees.some((entry) => entry.ownerPackage === '@treeseed/market')).toBe(true);
		expect(report.guarantees.some((entry) => entry.sourcePath.includes('node_modules'))).toBe(false);
		expect(report.guarantees.some((entry) => entry.sourcePath.includes('/guarantees/verifiers/'))).toBe(true);
		const emptyRegistry = loadTreeseedGuaranteeVerifierRegistry({
			workspaceRoot: root,
			path: resolve(root, 'packages/admin/guarantees/empty.verifiers.yaml'),
		});
		expect(emptyRegistry.registry).toBeNull();
		expect(emptyRegistry.diagnostics).toEqual([]);
	});

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
		const plan = planTreeseedGuarantees({ workspaceRoot: root, filter: { ids: ['guarantee.project.question.follow-up.040'] } });
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
		expect(() => planTreeseedGuarantees({ workspaceRoot: root, filter: { ids: ['guarantee.project.question.ask-question.038'] } })).not.toThrow();
		const plan = planTreeseedGuarantees({ workspaceRoot: root, filter: { ids: ['guarantee.project.question.ask-question.038'] } });
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
		expect(auditTreeseedGuaranteeJourneys({ workspaceRoot: root }).ok).toBe(true);
		writeFileSync(resolve(root, 'packages/admin/guarantees/project/question/scenes/ask-question.scene.yaml'), `schemaVersion: treeseed.scene/v1
id: ask-question
workflow:
  - id: open
    action:
      goto: /app/work/questions/new
`);
		const weak = auditTreeseedGuaranteeJourneys({ workspaceRoot: root });
		expect(weak.ok).toBe(false);
		expect(weak.totals.activeSceneBackedWeak).toBe(1);
	});

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

		const passed = await runTreeseedGuarantees({
			workspaceRoot: root,
			verifierExecutor: async () => ({ status: 'passed' }),
		});
		expect(passed.results[0]).toMatchObject({ status: 'passed', evidence: [], diagnostics: [] });

		const skipped = await runTreeseedGuarantees({
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
		const registry = discoverTreeseedGuarantees({ workspaceRoot: root });
		const resolution = resolveTreeseedGuaranteeVerifierRefs({
			refs: ['fixture.todo', 'fixture.todo', 'todo.placeholder', 'missing.ref'],
			verifierRegistries: registry.verifierRegistries,
			status: 'planned',
		});
		expect(resolution.ok).toBe(true);
		expect(resolution.resolutions).toHaveLength(3);
		expect(resolution.diagnostics.map((entry) => entry.code)).toEqual(['guarantee.todo_verifier_ref', 'guarantee.missing_verifier_ref']);

		const activeResolution = resolveTreeseedGuaranteeVerifierRefs({
			refs: ['todo.placeholder'],
			verifierRegistries: registry.verifierRegistries,
			status: 'active',
		});
		expect(activeResolution.ok).toBe(false);

		const report = await runTreeseedGuarantees({
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
		const report = await runTreeseedGuarantees({
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
			await expect(runTreeseedGuarantees({
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
		const report = await runTreeseedGuarantees({
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
			const report = await runTreeseedGuarantees({
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
		const report = await runTreeseedGuarantees({
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
		const report = await runTreeseedGuarantees({ workspaceRoot: root, includePlanned: true, now: new Date('2026-01-01T00:00:00.000Z') });
		expect(report.ok).toBe(true);
		expect(report.counts.planned).toBe(1);
		expect(report.counts.skipped).toBe(1);
	});

	it('creates status summaries grouped by type and status', () => {
		const root = workspaceFixture('status');
		writeGuarantee(root, validGuarantee);
		const status = createTreeseedGuaranteeStatusReport({ workspaceRoot: root });
		expect(status.ok).toBe(true);
		expect(status.byType.project).toBe(1);
		expect(status.byStatus.planned).toBe(1);
		expect(status.guaranteeRoots).toEqual(['packages/admin/guarantees']);
	});

	it('rejects vitest verifier output that executed no assertions', () => {
		expect(validateTreeseedVitestVerifierOutput({
			stdout: ' Test Files  1 passed (1)\n      Tests  2 passed (2)\n',
			stderr: '',
		})).toBeNull();
		expect(validateTreeseedVitestVerifierOutput({
			stdout: ' Test Files  1 skipped (1)\n      Tests  27 skipped (27)\n',
			stderr: '',
		})).toContain('without executing any assertions');
		expect(validateTreeseedVitestVerifierOutput({
			stdout: 'No test files found, exiting with code 0\n',
			stderr: '',
		})).toContain('without executing any assertions');
		expect(validateTreeseedVitestVerifierOutput({
			stdout: '',
			stderr: '\u001B[31m Tests  3 failed (3)\u001B[0m\r\n',
		})).toBeNull();
	});
});
