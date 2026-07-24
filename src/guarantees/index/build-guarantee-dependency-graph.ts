import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { GuaranteeDiagnostic, GuaranteeFilter, GuaranteeManifest, GuaranteeRegistryReport, GuaranteeVerifierContract, LoadedGuarantee, LoadedGuaranteeVerifierRegistry } from './guarantee-schema-version.ts';
import { GuaranteeDependencyGraph, GuaranteeDependencyGraphMeta, GuaranteeDependencyReason, allVerifierRefs, dependencyIdsForGuarantee, readSceneYaml, sceneManifestPathForGuarantee, sceneStateKeys, selectedByFilter, sortGuaranteeEntries, validateFilter } from './parse-verifier-registry.ts';
import { arrayOrEmpty, diagnostic } from './guarantee-journey-audit-item.ts';

export function buildGuaranteeDependencyGraph(input: { guarantees: LoadedGuarantee[]; filter?: GuaranteeFilter; includeDependencies?: boolean }): GuaranteeDependencyGraph {
	const valid = input.guarantees.filter((entry): entry is LoadedGuarantee & { manifest: GuaranteeManifest } => Boolean(entry.manifest)).sort(sortGuaranteeEntries);
	const byId = new Map(valid.map((entry) => [entry.manifest.id, entry]));
	const byJourneyIndex = new Map(valid.flatMap((entry) => entry.manifest.journeyIndex ? [[entry.manifest.journeyIndex, entry] as const] : []));
	const selectedIds = new Set(valid.filter((entry) => selectedByFilter(entry.manifest, input.filter)).map((entry) => entry.manifest.id));
	const includeIds = new Set(selectedIds);
	const reasonById = new Map<string, Set<GuaranteeDependencyReason>>();
	const diagnostics: GuaranteeDiagnostic[] = [];
	const visitInclude = (id: string, chain: string[]) => {
		const entry = byId.get(id);
		if (!entry) return;
		if (chain.includes(id)) {
			diagnostics.push(diagnostic('error', 'guarantee.dependency_cycle', `Guarantee dependency cycle: ${[...chain, id].join(' -> ')}.`, 'dependencies', entry.sourcePath));
			return;
		}
		const deps = dependencyIdsForGuarantee({ entry, byId, byJourneyIndex, valid });
		for (const [depId, reasons] of deps) {
			for (const reason of reasons) {
				const existing = reasonById.get(depId) ?? new Set<GuaranteeDependencyReason>();
				existing.add(reason);
				reasonById.set(depId, existing);
			}
			if (input.includeDependencies !== false && !includeIds.has(depId)) includeIds.add(depId);
			if (input.includeDependencies !== false) visitInclude(depId, [...chain, id]);
		}
	};
	for (const id of [...selectedIds]) visitInclude(id, []);

	const included = valid.filter((entry) => includeIds.has(entry.manifest.id));
	const includedIds = new Set(included.map((entry) => entry.manifest.id));
	const depMap = new Map<string, string[]>();
	const reasonMap = new Map<string, Set<GuaranteeDependencyReason>>();
	const stateProduces = new Map<string, string[]>();
	const stateConsumes = new Map<string, string[]>();
	for (const entry of included) {
		const scenePath = sceneManifestPathForGuarantee(entry);
		const scene = scenePath && existsSync(scenePath) ? readSceneYaml(scenePath) : null;
		stateProduces.set(entry.manifest.id, sceneStateKeys(scene, 'producesState'));
		stateConsumes.set(entry.manifest.id, sceneStateKeys(scene, 'consumesState'));
		const deps = dependencyIdsForGuarantee({ entry, byId, byJourneyIndex, valid });
		const filtered = [...deps.keys()].filter((id) => includedIds.has(id)).sort((a, b) => sortGuaranteeEntries(byId.get(a)!, byId.get(b)!));
		depMap.set(entry.manifest.id, filtered);
		const reasons = new Set<GuaranteeDependencyReason>();
		for (const depId of filtered) for (const reason of arrayOrEmpty(deps.get(depId))) reasons.add(reason);
		for (const reason of arrayOrEmpty(reasonById.get(entry.manifest.id))) reasons.add(reason);
		reasonMap.set(entry.manifest.id, reasons);
	}
	const producersByStateKey = new Map<string, string[]>();
	for (const [id, keys] of stateProduces) {
		for (const key of keys) {
			producersByStateKey.set(key, [...arrayOrEmpty(producersByStateKey.get(key)), id]);
		}
	}
	for (const [key, producers] of producersByStateKey) {
		const unique = [...new Set(producers)];
		if (unique.length > 1) {
			diagnostics.push(diagnostic(
				'error',
				'guarantee.state_duplicate_producer',
				`State key ${key} is produced by multiple included guarantees: ${unique.join(', ')}.`,
				'journey.producesState',
				byId.get(unique[0])?.sourcePath,
			));
		}
		producersByStateKey.set(key, unique);
	}
	for (const [id, keys] of stateConsumes) {
		for (const key of keys) {
			const producers = arrayOrEmpty(producersByStateKey.get(key));
			const producer = producers.length === 1 ? producers[0] : undefined;
			if (producer && producer !== id && includedIds.has(producer)) {
				const deps = arrayOrEmpty(depMap.get(id));
				if (!deps.includes(producer)) deps.push(producer);
				depMap.set(id, deps.sort((a, b) => sortGuaranteeEntries(byId.get(a)!, byId.get(b)!)));
				const reasons = reasonMap.get(id) ?? new Set<GuaranteeDependencyReason>();
				reasons.add('state');
				reasonMap.set(id, reasons);
			}
		}
	}
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const ordered: string[] = [];
	const visitOrder = (id: string, chain: string[]) => {
		if (visited.has(id)) return;
		if (visiting.has(id)) {
			diagnostics.push(diagnostic('error', 'guarantee.dependency_cycle', `Guarantee dependency cycle: ${[...chain, id].join(' -> ')}.`, 'dependencies', byId.get(id)?.sourcePath));
			return;
		}
		visiting.add(id);
		for (const dep of arrayOrEmpty(depMap.get(id))) visitOrder(dep, [...chain, id]);
		visiting.delete(id);
		visited.add(id);
		ordered.push(id);
	};
	for (const entry of included) visitOrder(entry.manifest.id, []);
	const inverse = new Map<string, string[]>();
	for (const [id, deps] of depMap) for (const dep of deps) inverse.set(dep, [...arrayOrEmpty(inverse.get(dep)), id]);
	const depthCache = new Map<string, number>();
	const depth = (id: string, chain: string[] = []): number => {
		if (depthCache.has(id)) return depthCache.get(id)!;
		if (chain.includes(id)) {
			diagnostics.push(diagnostic('error', 'guarantee.dependency_cycle', `Guarantee dependency cycle: ${[...chain, id].join(' -> ')}.`, 'dependencies', byId.get(id)?.sourcePath));
			return 0;
		}
		const value = Math.max(0, ...arrayOrEmpty(depMap.get(id)).map((dep) => depth(dep, [...chain, id]) + 1));
		depthCache.set(id, value);
		return value;
	};
	const meta = new Map<string, GuaranteeDependencyGraphMeta>();
	for (const [index, id] of ordered.entries()) {
		meta.set(id, {
			dependsOn: arrayOrEmpty(depMap.get(id)),
			dependencyOf: arrayOrEmpty(inverse.get(id)).sort((a, b) => sortGuaranteeEntries(byId.get(a)!, byId.get(b)!)),
			dependencyReason: [...(reasonMap.get(id) ?? new Set<GuaranteeDependencyReason>())],
			dependencyDepth: depth(id),
			executionOrder: index,
			producesState: arrayOrEmpty(stateProduces.get(id)),
			consumesState: arrayOrEmpty(stateConsumes.get(id)),
		});
	}
	return { entries: ordered.map((id) => byId.get(id)!).filter(Boolean), selectedIds, meta, diagnostics };
}

export function filterGuarantees(input: { guarantees: LoadedGuarantee[]; filter?: GuaranteeFilter; includeDependencies?: boolean }) {
	return buildGuaranteeDependencyGraph(input).entries;
}

export function validateGuaranteeRegistry(input: {
	workspaceRoot: string;
	guarantees: LoadedGuarantee[];
	verifierRegistries?: LoadedGuaranteeVerifierRegistry[];
	filter?: GuaranteeFilter;
}): GuaranteeRegistryReport {
	const diagnostics: GuaranteeDiagnostic[] = [
		...input.guarantees.flatMap((entry) => entry.diagnostics),
		...arrayOrEmpty(input.verifierRegistries).flatMap((entry) => entry.diagnostics),
	];
	validateFilter(input.filter, diagnostics);
	const valid = input.guarantees.filter((entry): entry is LoadedGuarantee & { manifest: GuaranteeManifest } => Boolean(entry.manifest));
	const ids = new Map<string, LoadedGuarantee & { manifest: GuaranteeManifest }>();
	const journeyIndexes = new Map<number, LoadedGuarantee & { manifest: GuaranteeManifest }>();
	for (const entry of valid) {
		const existing = ids.get(entry.manifest.id);
		if (existing) diagnostics.push(diagnostic('error', 'guarantee.duplicate_id', `Duplicate guarantee id "${entry.manifest.id}" also appears at ${existing.relativePath}.`, 'id', entry.sourcePath));
		ids.set(entry.manifest.id, entry);
		if (entry.manifest.journeyIndex) {
			const existingIndex = journeyIndexes.get(entry.manifest.journeyIndex);
			if (existingIndex) diagnostics.push(diagnostic('error', 'guarantee.duplicate_journey_index', `Duplicate journey index ${entry.manifest.journeyIndex} also appears at ${existingIndex.relativePath}.`, 'journeyIndex', entry.sourcePath));
			journeyIndexes.set(entry.manifest.journeyIndex, entry);
		}
	}
	for (const entry of valid) {
		for (const dep of arrayOrEmpty(entry.manifest.dependencies.guarantees)) {
			if (!ids.has(dep)) diagnostics.push(diagnostic('error', 'guarantee.missing_dependency', `Missing guarantee dependency "${dep}".`, 'dependencies.guarantees', entry.sourcePath));
		}
		for (const dep of arrayOrEmpty(entry.manifest.dependencies.journeys)) {
			if (!journeyIndexes.has(dep)) diagnostics.push(diagnostic('error', 'guarantee.missing_journey_dependency', `Missing journey dependency "${dep}".`, 'dependencies.journeys', entry.sourcePath));
			if (entry.manifest.journeyIndex && dep >= entry.manifest.journeyIndex) diagnostics.push(diagnostic('error', 'guarantee.forward_journey_dependency', `Journey dependency ${dep} must be lower than ${entry.manifest.journeyIndex}.`, 'dependencies.journeys', entry.sourcePath));
		}
	}
	for (const entry of valid) {
		for (const dep of arrayOrEmpty(entry.manifest.dependsOnGuarantees)) {
			const [ownerPackage, ref] = dep.includes(':') ? dep.split(/:(.+)/u).filter(Boolean) : ['', dep];
			const match = valid.find((candidate) =>
				(!ownerPackage || candidate.manifest.ownerPackage === ownerPackage)
				&& candidate.manifest.status === 'active'
				&& (candidate.manifest.id === ref || allVerifierRefs(candidate.manifest).includes(ref)));
			if (!match) diagnostics.push(diagnostic('error', 'guarantee.missing_depends_on_guarantee', `Missing active guarantee dependency "${dep}".`, 'dependsOnGuarantees', entry.sourcePath));
		}
	}
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const visit = (id: string, chain: string[]) => {
		if (visited.has(id)) return;
		if (visiting.has(id)) {
			diagnostics.push(diagnostic('error', 'guarantee.dependency_cycle', `Guarantee dependency cycle: ${[...chain, id].join(' -> ')}.`, 'dependencies.guarantees', ids.get(id)?.sourcePath));
			return;
		}
		visiting.add(id);
		for (const dep of arrayOrEmpty(ids.get(id)?.manifest.dependencies.guarantees)) visit(dep, [...chain, id]);
		visiting.delete(id);
		visited.add(id);
	};
	for (const id of ids.keys()) visit(id, []);

	const verifierIds = new Set(arrayOrEmpty(input.verifierRegistries).flatMap((entry) => Object.keys(entry.registry?.verifiers ?? {})));
	const verifierKinds = new Map(arrayOrEmpty(input.verifierRegistries).flatMap((registry) =>
		Object.entries(registry.registry?.verifiers ?? {}).map(([id, definition]) => [id, definition.kind] as const)
	));
	for (const entry of valid) {
		for (const ref of allVerifierRefs(entry.manifest)) {
			if (ref.startsWith('todo.')) {
				if (entry.manifest.status === 'active') diagnostics.push(diagnostic('error', 'guarantee.todo_verifier_active', `Active guarantee cannot use placeholder verifier ref "${ref}".`, 'verifierRefs', entry.sourcePath));
				continue;
			}
			if (!verifierIds.has(ref)) {
				const severity = entry.manifest.status === 'active' ? 'error' : 'warning';
				diagnostics.push(diagnostic(severity, 'guarantee.missing_verifier_ref', `Verifier ref "${ref}" is not defined.`, 'verifierRefs', entry.sourcePath));
			}
			if ((entry.manifest.gates.includes('release') || entry.manifest.gates.includes('security')) && verifierKinds.get(ref) === 'manualEvidence') {
				diagnostics.push(diagnostic('error', 'guarantee.release_manual_evidence', `Release/security guarantee cannot depend on manual evidence verifier "${ref}".`, 'verifierRefs', entry.sourcePath));
			}
		}
	}

	const selected = input.filter ? filterGuarantees({ guarantees: input.guarantees, filter: input.filter }).length : undefined;
	const errors = diagnostics.filter((entry) => entry.severity === 'error').length;
	const warnings = diagnostics.filter((entry) => entry.severity === 'warning').length;
	return {
		ok: errors === 0,
		workspaceRoot: resolve(input.workspaceRoot),
		guarantees: input.guarantees,
		verifierRegistries: arrayOrEmpty(input.verifierRegistries),
		diagnostics,
		counts: {
			total: input.guarantees.length,
			valid: valid.length,
			...(selected !== undefined ? { selected } : {}),
			errors,
			warnings,
		},
	};
}

export function refs(contract: GuaranteeVerifierContract | undefined) {
	return arrayOrEmpty(contract?.verifierRefs);
}
