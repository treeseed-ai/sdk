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
});
