import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { TREESEED_GUARANTEE_VERIFIERS_SCHEMA_VERSION, TreeseedGuaranteeDiagnostic, TreeseedGuaranteeFilter, TreeseedGuaranteeManifest, TreeseedGuaranteePlanEntry, TreeseedGuaranteeRegistryReport, TreeseedGuaranteeVerifierDefinition, TreeseedGuaranteeVerifierKind, TreeseedGuaranteeVerifierRegistry, TreeseedLoadedGuarantee, TreeseedLoadedGuaranteeVerifierRegistry } from './treeseed-guarantee-schema-version.ts';
import { KNOWN_VERIFIER_KINDS, TAXONOMY_PATTERN, arrayOrEmpty, diagnostic, isRecord, normalizeTreeseedGuaranteeTaxonomy, numberValue, readYamlFile, stringArray, stringValue } from './treeseed-guarantee-journey-audit-item.ts';
import { loadTreeseedGuaranteeManifest, nearestPackageRoot, ownerPackageFromRoot, walkFiles } from './walk-files.ts';
import { validateTreeseedGuaranteeRegistry } from './build-treeseed-guarantee-dependency-graph.ts';

export function parseVerifierRegistry(value: unknown, diagnostics: TreeseedGuaranteeDiagnostic[], sourcePath: string): TreeseedGuaranteeVerifierRegistry | null {
	if (!isRecord(value)) {
		diagnostics.push(diagnostic('error', 'guarantee_verifiers.invalid_manifest', 'Verifier registry must be an object.', 'manifest', sourcePath));
		return null;
	}
	const schemaVersion = stringValue(value.schemaVersion);
	const ownerPackage = stringValue(value.ownerPackage);
	if (schemaVersion !== TREESEED_GUARANTEE_VERIFIERS_SCHEMA_VERSION) diagnostics.push(diagnostic('error', 'guarantee_verifiers.unsupported_schema_version', `Unsupported verifier schema version "${schemaVersion}".`, 'schemaVersion', sourcePath));
	if (!ownerPackage) diagnostics.push(diagnostic('error', 'guarantee_verifiers.missing_owner_package', 'Verifier registry ownerPackage is required.', 'ownerPackage', sourcePath));
	const rawVerifiers = isRecord(value.verifiers) ? value.verifiers : {};
	const verifiers: Record<string, TreeseedGuaranteeVerifierDefinition> = {};
	for (const [id, entry] of Object.entries(rawVerifiers)) {
		if (!isRecord(entry)) {
			diagnostics.push(diagnostic('error', 'guarantee_verifiers.invalid_entry', `Verifier "${id}" must be an object.`, `verifiers.${id}`, sourcePath));
			continue;
		}
		const kind = stringValue(entry.kind) as TreeseedGuaranteeVerifierKind;
		verifiers[id] = {
			kind,
			...(typeof entry.ownerPackage === 'string' ? { ownerPackage: entry.ownerPackage } : {}),
			...(typeof entry.spec === 'string' ? { spec: entry.spec } : {}),
			...(typeof entry.caseId === 'string' ? { caseId: entry.caseId } : {}),
			...(typeof entry.command === 'string' ? { command: entry.command } : {}),
			...(Array.isArray(entry.args) ? { args: stringArray(entry.args) } : {}),
			...(typeof entry.testFile === 'string' ? { testFile: entry.testFile } : {}),
			...(typeof entry.testName === 'string' ? { testName: entry.testName } : {}),
			...(typeof entry.cwd === 'string' ? { cwd: entry.cwd } : {}),
			...(numberValue(entry.timeoutSeconds) ? { timeoutSeconds: numberValue(entry.timeoutSeconds) } : {}),
			...(Array.isArray(entry.evidence) ? { evidence: stringArray(entry.evidence) } : {}),
			...(typeof entry.description === 'string' ? { description: entry.description } : {}),
		};
		if (!verifiers[id].kind) diagnostics.push(diagnostic('error', 'guarantee_verifiers.missing_kind', `Verifier "${id}" is missing kind.`, `verifiers.${id}.kind`, sourcePath));
		if (verifiers[id].kind && !KNOWN_VERIFIER_KINDS.has(verifiers[id].kind)) diagnostics.push(diagnostic('error', 'guarantee_verifiers.invalid_kind', `Verifier "${id}" has unsupported kind "${verifiers[id].kind}".`, `verifiers.${id}.kind`, sourcePath));
	}
	return {
		schemaVersion: TREESEED_GUARANTEE_VERIFIERS_SCHEMA_VERSION,
		ownerPackage,
		verifiers,
	};
}

export function loadVerifierRegistry(workspaceRoot: string, path: string): TreeseedLoadedGuaranteeVerifierRegistry {
	const sourcePath = resolve(path);
	const packageRoot = nearestPackageRoot(workspaceRoot, sourcePath);
	const ownerPackage = ownerPackageFromRoot(packageRoot);
	const diagnostics: TreeseedGuaranteeDiagnostic[] = [];
	const value = readYamlFile(sourcePath, diagnostics);
	const registry = value ? parseVerifierRegistry(value, diagnostics, sourcePath) : null;
	if (registry && registry.ownerPackage !== ownerPackage) {
		diagnostics.push(diagnostic('error', 'guarantee_verifiers.owner_package_mismatch', `Verifier ownerPackage "${registry.ownerPackage}" must match package "${ownerPackage}".`, 'ownerPackage', sourcePath));
	}
	return { sourcePath, ownerPackage, registry, diagnostics };
}

export function loadTreeseedGuaranteeVerifierRegistry(input: { workspaceRoot: string; path: string }): TreeseedLoadedGuaranteeVerifierRegistry {
	return loadVerifierRegistry(resolve(input.workspaceRoot), input.path);
}

export function discoverTreeseedGuarantees(input: { workspaceRoot: string; filter?: TreeseedGuaranteeFilter } = { workspaceRoot: process.cwd() }): TreeseedGuaranteeRegistryReport {
	const workspaceRoot = resolve(input.workspaceRoot);
	const guaranteePaths = walkFiles(workspaceRoot, (filePath) => filePath.endsWith('.guarantee.yaml'));
	const verifierPaths = walkFiles(workspaceRoot, (filePath) => filePath.endsWith('.verifiers.yaml'));
	const guarantees = guaranteePaths.map((path) => loadTreeseedGuaranteeManifest({ workspaceRoot, path }));
	const verifierRegistries = verifierPaths.map((path) => loadVerifierRegistry(workspaceRoot, path));
	return validateTreeseedGuaranteeRegistry({ workspaceRoot, guarantees, verifierRegistries, filter: input.filter });
}

export function validateTreeseedGuarantee(input: { workspaceRoot: string; path: string }) {
	return loadTreeseedGuaranteeManifest(input);
}

export function allVerifierRefs(manifest: TreeseedGuaranteeManifest) {
	return [
		...arrayOrEmpty(manifest.api?.verifierRefs),
		...arrayOrEmpty(manifest.content?.verifierRefs),
		...arrayOrEmpty(manifest.audit?.verifierRefs),
		...arrayOrEmpty(manifest.negativeCases).flatMap((entry) => arrayOrEmpty(entry.verifierRefs)),
	];
}

export function selectedByFilter(manifest: TreeseedGuaranteeManifest, filter: TreeseedGuaranteeFilter = {}) {
	if (filter.gate && !manifest.gates.includes(filter.gate)) return false;
	if (filter.type && manifest.type !== filter.type) return false;
	if (filter.subtype && manifest.subtype !== filter.subtype) return false;
	if (filter.ownerPackage && manifest.ownerPackage !== filter.ownerPackage) return false;
	if (filter.ownerPackages && filter.ownerPackages.length > 0 && !filter.ownerPackages.includes(manifest.ownerPackage)) return false;
	if (filter.sceneBacked === true && !manifest.scene?.manifest) return false;
	if (filter.status && manifest.status !== filter.status) return false;
	if (filter.ids && filter.ids.length > 0 && !filter.ids.includes(manifest.id)) return false;
	if (filter.journeyIndexes && filter.journeyIndexes.length > 0 && (!manifest.journeyIndex || !filter.journeyIndexes.includes(manifest.journeyIndex))) return false;
	return true;
}

export function sortGuaranteeEntries(a: TreeseedLoadedGuarantee & { manifest: TreeseedGuaranteeManifest }, b: TreeseedLoadedGuarantee & { manifest: TreeseedGuaranteeManifest }) {
	return (a.manifest.journeyIndex ?? 99999) - (b.manifest.journeyIndex ?? 99999) || a.manifest.id.localeCompare(b.manifest.id);
}

export function validateFilter(filter: TreeseedGuaranteeFilter | undefined, diagnostics: TreeseedGuaranteeDiagnostic[]) {
	for (const field of ['type', 'subtype'] as const) {
		const value = filter?.[field];
		if (value && !TAXONOMY_PATTERN.test(value)) diagnostics.push(diagnostic('error', `guarantee_filter.invalid_${field}`, `Filter ${field} must be lowercase kebab-case. Try "${normalizeTreeseedGuaranteeTaxonomy(value)}".`, field));
	}
}

export type TreeseedGuaranteeDependencyReason = TreeseedGuaranteePlanEntry['dependencyReason'][number];

export type TreeseedGuaranteeDependencyGraphMeta = {
	dependsOn: string[];
	dependencyOf: string[];
	dependencyReason: TreeseedGuaranteeDependencyReason[];
	dependencyDepth: number;
	executionOrder: number;
	producesState: string[];
	consumesState: string[];
};

export type TreeseedGuaranteeDependencyGraph = {
	entries: Array<TreeseedLoadedGuarantee & { manifest: TreeseedGuaranteeManifest }>;
	selectedIds: Set<string>;
	meta: Map<string, TreeseedGuaranteeDependencyGraphMeta>;
	diagnostics: TreeseedGuaranteeDiagnostic[];
};

export function readSceneYaml(scenePath: string) {
	try {
		const value = parseYaml(readFileSync(scenePath, 'utf8'));
		return isRecord(value) ? value : null;
	} catch {
		return null;
	}
}

export function sceneManifestPathForGuarantee(entry: TreeseedLoadedGuarantee & { manifest: TreeseedGuaranteeManifest }) {
	const manifest = entry.manifest.scene?.manifest;
	if (!manifest) return undefined;
	return resolve(dirname(entry.sourcePath), manifest);
}

export function sceneRouteFromYaml(value: Record<string, unknown> | null) {
	const workflow = Array.isArray(value?.workflow) ? value.workflow : [];
	for (const step of workflow) {
		const action = isRecord(step) && isRecord(step.action) ? step.action : null;
		const goto = isRecord(action?.goto) ? action.goto : null;
		const url = stringValue(goto?.url) || stringValue(goto?.path) || stringValue(action?.goto);
		if (url) return url;
	}
	return undefined;
}

export function sceneStateKeys(value: Record<string, unknown> | null, key: 'producesState' | 'consumesState') {
	const journey = isRecord(value?.journey) ? value.journey : null;
	const entries = Array.isArray(journey?.[key]) ? journey[key] as unknown[] : [];
	return entries.map((entry) => isRecord(entry) ? stringValue(entry.key) : stringValue(entry)).filter(Boolean);
}

export function implicitAuthDependencyFor(entry: TreeseedLoadedGuarantee & { manifest: TreeseedGuaranteeManifest }) {
	if (entry.manifest.type === 'user' && entry.manifest.subtype === 'auth') return undefined;
	const entryRoute = entry.manifest.scene?.entryRoute;
	const scenePath = sceneManifestPathForGuarantee(entry);
	const sceneRoute = scenePath && existsSync(scenePath) ? sceneRouteFromYaml(readSceneYaml(scenePath)) : undefined;
	const route = entryRoute || sceneRoute;
	return route?.startsWith('/app/') || route === '/app' ? 'guarantee.user.auth.user-login.004' : undefined;
}

export function dependencyIdsForGuarantee(input: {
	entry: TreeseedLoadedGuarantee & { manifest: TreeseedGuaranteeManifest };
	byId: Map<string, TreeseedLoadedGuarantee & { manifest: TreeseedGuaranteeManifest }>;
	byJourneyIndex: Map<number, TreeseedLoadedGuarantee & { manifest: TreeseedGuaranteeManifest }>;
	valid: Array<TreeseedLoadedGuarantee & { manifest: TreeseedGuaranteeManifest }>;
}) {
	const deps = new Map<string, Set<TreeseedGuaranteeDependencyReason>>();
	const add = (id: string | undefined, reason: TreeseedGuaranteeDependencyReason) => {
		if (!id || id === input.entry.manifest.id || !input.byId.has(id)) return;
		const reasons = deps.get(id) ?? new Set<TreeseedGuaranteeDependencyReason>();
		reasons.add(reason);
		deps.set(id, reasons);
	};
	for (const id of arrayOrEmpty(input.entry.manifest.dependencies.guarantees)) add(id, 'explicit-guarantee');
	for (const journeyIndex of arrayOrEmpty(input.entry.manifest.dependencies.journeys)) add(input.byJourneyIndex.get(journeyIndex)?.manifest.id, 'journey-index');
	for (const dep of arrayOrEmpty(input.entry.manifest.dependsOnGuarantees)) {
		const [ownerPackage, ref] = dep.includes(':') ? dep.split(/:(.+)/u).filter(Boolean) : ['', dep];
		const match = input.valid.find((candidate) =>
			(!ownerPackage || candidate.manifest.ownerPackage === ownerPackage)
			&& candidate.manifest.status === 'active'
			&& (candidate.manifest.id === ref || allVerifierRefs(candidate.manifest).includes(ref)));
		add(match?.manifest.id, 'depends-on-verifier');
	}
	add(implicitAuthDependencyFor(input.entry), 'implicit-auth');
	return deps;
}
