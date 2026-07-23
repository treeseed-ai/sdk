import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { TREESEED_GUARANTEE_JOURNEY_AUDIT_SCHEMA_VERSION, TreeseedGuaranteeDiagnostic, TreeseedGuaranteeFilter, TreeseedGuaranteeJourneyAudit, TreeseedGuaranteeManifest, TreeseedGuaranteePlanEntry, TreeseedLoadedGuarantee } from './treeseed-guarantee-schema-version.ts';
import { EXCLUDED_DIRS, TreeseedGuaranteeJourneyAuditItem, TreeseedGuaranteePlanReport, arrayOrEmpty, diagnostic, isRecord } from './treeseed-guarantee-journey-audit-item.ts';
import { discoverTreeseedGuarantees, readSceneYaml, sceneManifestPathForGuarantee, sceneRouteFromYaml, selectedByFilter } from './parse-verifier-registry.ts';
import { buildTreeseedGuaranteeDependencyGraph, filterTreeseedGuarantees, refs } from './build-treeseed-guarantee-dependency-graph.ts';
import { validateGuaranteeSceneJourneyContract } from './run-verifier-command.ts';
import { assertPathInsideWorkspace } from './run-treeseed-guarantees.ts';

export function planTreeseedGuarantees(input: { workspaceRoot: string; filter?: TreeseedGuaranteeFilter; environment?: string; includeDependencies?: boolean }): TreeseedGuaranteePlanReport {
	const registry = discoverTreeseedGuarantees({ workspaceRoot: input.workspaceRoot, filter: input.filter });
	const selectedWithoutDeps = filterTreeseedGuarantees({ guarantees: registry.guarantees, filter: input.filter, includeDependencies: false });
	const graph = buildTreeseedGuaranteeDependencyGraph({ guarantees: registry.guarantees, filter: input.filter, includeDependencies: input.includeDependencies !== false });
	const selectedIds = graph.selectedIds;
	const entries = graph.entries
		.map((entry): TreeseedGuaranteePlanEntry => {
			const meta = graph.meta.get(entry.manifest.id);
			return ({
			id: entry.manifest.id,
			...(entry.manifest.journeyIndex ? { journeyIndex: entry.manifest.journeyIndex } : {}),
			type: entry.manifest.type,
			subtype: entry.manifest.subtype,
			journey: entry.manifest.journey,
			ownerPackage: entry.manifest.ownerPackage,
			...(entry.manifest.surface ? { surface: entry.manifest.surface } : {}),
			status: entry.manifest.status,
			gates: entry.manifest.gates,
			sourcePath: entry.relativePath,
			selected: selectedIds.has(entry.manifest.id),
			dependency: !selectedIds.has(entry.manifest.id),
			...(entry.manifest.scene?.manifest ? { sceneManifest: entry.manifest.scene.manifest } : {}),
			apiVerifierRefs: refs(entry.manifest.api),
			contentVerifierRefs: refs(entry.manifest.content),
			auditVerifierRefs: refs(entry.manifest.audit),
			evidenceRequired: entry.manifest.evidence.required,
			dependencyDepth: meta?.dependencyDepth ?? 0,
			dependencyOf: arrayOrEmpty(meta?.dependencyOf),
			dependsOn: arrayOrEmpty(meta?.dependsOn),
			dependencyReason: arrayOrEmpty(meta?.dependencyReason),
			executionOrder: meta?.executionOrder ?? 0,
			...(meta?.producesState.length ? { producesState: meta.producesState } : {}),
			...(meta?.consumesState.length ? { consumesState: meta.consumesState } : {}),
			});
		});
	const diagnostics = [...registry.diagnostics, ...graph.diagnostics];
	const errors = diagnostics.filter((entry) => entry.severity === 'error').length;
	const warnings = diagnostics.filter((entry) => entry.severity === 'warning').length;
	return {
		ok: errors === 0,
		workspaceRoot: resolve(input.workspaceRoot),
		filter: input.filter ?? {},
		environment: input.environment ?? 'local',
		entries,
		diagnostics,
		counts: {
			total: registry.counts.total,
			selected: selectedWithoutDeps.length,
			withDependencies: entries.length,
			errors,
			warnings,
		},
	};
}

export function collectFiles(root: string, predicate: (path: string) => boolean, out: string[] = []) {
	if (!existsSync(root)) return out;
	for (const name of readdirSync(root)) {
		if (EXCLUDED_DIRS.has(name)) continue;
		const path = resolve(root, name);
		let stat;
		try {
			stat = statSync(path);
		} catch {
			continue;
		}
		if (stat.isDirectory()) collectFiles(path, predicate, out);
		else if (stat.isFile() && predicate(path)) out.push(path);
	}
	return out;
}

export function astroRoutePatternFromPath(root: string, filePath: string) {
	const relativePath = relative(root, filePath).replace(/\\/gu, '/');
	const withoutExtension = relativePath.replace(/\.(astro|tsx|ts|jsx|js)$/u, '');
	const segments = withoutExtension.split('/').filter(Boolean);
	if (segments.at(-1) === 'index') segments.pop();
	return `/${segments.map((segment) => {
		if (/^\[\.\.\..+\]$/u.test(segment)) return '**';
		if (/^\[.+\]$/u.test(segment)) return '*';
		return segment;
	}).join('/')}`.replace(/\/+$/u, '') || '/';
}

export function collectAstroRoutePatterns(workspaceRoot: string) {
	const roots = [
		resolve(workspaceRoot, 'src/pages'),
		resolve(workspaceRoot, 'packages/admin/src/pages'),
		resolve(workspaceRoot, 'packages/core/src/pages'),
	];
	const patterns = new Set<string>();
	for (const root of roots) {
		for (const path of collectFiles(root, (entry) => /\.(astro|tsx|ts|jsx|js)$/u.test(entry))) {
			patterns.add(astroRoutePatternFromPath(root, path));
		}
	}
	return patterns;
}

export function normalizeRoutePath(route: string | undefined) {
	if (!route) return undefined;
	if (/^https?:\/\//u.test(route)) {
		try {
			return new URL(route).pathname || '/';
		} catch {
			return route;
		}
	}
	return route.split(/[?#]/u)[0] || '/';
}

export function routePatternMatches(pattern: string, route: string) {
	const patternSegments = pattern.split('/').filter(Boolean);
	const routeSegments = route.split('/').filter(Boolean);
	if (patternSegments.includes('**')) {
		const index = patternSegments.indexOf('**');
		return patternSegments.slice(0, index).every((segment, segmentIndex) => segment === '*' || segment === routeSegments[segmentIndex]);
	}
	if (patternSegments.length !== routeSegments.length) return false;
	return patternSegments.every((segment, index) => segment === '*' || segment === routeSegments[index]);
}

export function actionKindFromSceneStep(step: unknown) {
	const action = isRecord(step) && isRecord(step.action) ? step.action : null;
	return action ? Object.keys(action)[0] ?? 'unknown' : 'unknown';
}

export function sceneHasAcceptanceAssertions(step: unknown) {
	return isRecord(step) && isRecord(step.expect) && Object.keys(step.expect).length > 0;
}

export function sceneUsesOnlyStableSelectors(value: Record<string, unknown> | null) {
	const text = JSON.stringify(value ?? {});
	if (!text.includes('"selector"')) return true;
	return /data-scene|data-testid|testId|getByRole|getByLabel|getByText|"internal":true/iu.test(text);
}

export function auditTreeseedGuaranteeJourneys(input: { workspaceRoot: string; filter?: TreeseedGuaranteeFilter; writeReport?: string; now?: Date }): TreeseedGuaranteeJourneyAudit {
	const workspaceRoot = resolve(input.workspaceRoot);
	const registry = discoverTreeseedGuarantees({ workspaceRoot, filter: input.filter });
	const routes = collectAstroRoutePatterns(workspaceRoot);
	const valid = registry.guarantees.filter((entry): entry is TreeseedLoadedGuarantee & { manifest: TreeseedGuaranteeManifest } => Boolean(entry.manifest));
	const graph = buildTreeseedGuaranteeDependencyGraph({ guarantees: registry.guarantees, filter: input.filter, includeDependencies: true });
	const items: TreeseedGuaranteeJourneyAuditItem[] = [];
	for (const entry of valid.filter((candidate) => selectedByFilter(candidate.manifest, input.filter))) {
		const scenePath = sceneManifestPathForGuarantee(entry);
		if (!scenePath) {
			items.push({
				guaranteeId: entry.manifest.id,
				status: entry.manifest.status,
				ownerPackage: entry.manifest.ownerPackage,
				type: entry.manifest.type,
				subtype: entry.manifest.subtype,
				journey: entry.manifest.journey,
				sourcePath: entry.relativePath,
				routeExists: true,
				sceneWorkflowStepCount: 0,
				interactiveStepCount: 0,
				classification: 'non-ui-guarantee',
				requiredAction: 'none',
				diagnostics: [],
			});
			continue;
		}
		const scene = existsSync(scenePath) ? readSceneYaml(scenePath) : null;
		const workflow = Array.isArray(scene?.workflow) ? scene.workflow : [];
		const journey = isRecord(scene?.journey) ? scene.journey : null;
		const serviceJourney = journey?.kind === 'service';
		const minimumSteps = typeof journey?.minimumSteps === 'number' ? journey.minimumSteps : 2;
		const actionKinds = workflow.map(actionKindFromSceneStep);
		const interactiveStepCount = actionKinds.filter((kind) => kind !== 'goto' && kind !== 'pause').length;
		const currentRoute = normalizeRoutePath(entry.manifest.scene?.entryRoute || sceneRouteFromYaml(scene));
		const routeExists = Boolean(currentRoute && !currentRoute.includes(':') && [...routes].some((pattern) => routePatternMatches(pattern, currentRoute))) || !currentRoute;
		const missingSelectors = entry.manifest.status === 'active' && !sceneUsesOnlyStableSelectors(scene);
		const weak = workflow.length < minimumSteps || interactiveStepCount === 0 || (entry.manifest.status === 'active' && (!serviceJourney || workflow.some((step) => !sceneHasAcceptanceAssertions(step))));
		const diagnostics: TreeseedGuaranteeDiagnostic[] = [];
		if (!existsSync(scenePath)) diagnostics.push(diagnostic('error', 'guarantee.scene_missing_manifest', `Scene manifest does not exist: ${relative(workspaceRoot, scenePath)}.`, 'scene.manifest', entry.sourcePath));
		if (!routeExists) diagnostics.push(diagnostic(entry.manifest.status === 'active' ? 'error' : 'warning', 'guarantee.scene_missing_route', `Scene entry route ${currentRoute ?? '(unknown)'} does not map to a known Astro route.`, 'scene.entryRoute', entry.sourcePath));
		if (entry.manifest.status === 'active' && !serviceJourney) diagnostics.push(diagnostic('error', 'guarantee.scene_missing_service_journey', 'Active scene-backed guarantees must declare journey.kind: service in the scene manifest.', 'scene.journey.kind', entry.sourcePath));
		if (weak) diagnostics.push(...validateGuaranteeSceneJourneyContract({ scenePath, sourcePath: entry.sourcePath }).map((item) => entry.manifest.status === 'active' ? item : { ...item, severity: 'warning' as const }));
		if (missingSelectors) diagnostics.push(diagnostic('error', 'guarantee.scene_missing_stable_selectors', 'Active service journey scenes must use stable data-scene, data-testid, or role/text selectors instead of brittle CSS selectors.', 'scene.workflow', entry.sourcePath));
		const classification: TreeseedGuaranteeJourneyAuditItem['classification'] = !routeExists
			? 'missing-product-route'
			: missingSelectors
				? 'missing-stable-selectors'
				: entry.manifest.status !== 'active' && weak
					? 'planned-product-contract'
					: weak
						? 'weak-page-only-scene'
						: 'valid-service-journey';
		const requiredAction: TreeseedGuaranteeJourneyAuditItem['requiredAction'] = classification === 'missing-product-route'
			? entry.manifest.status === 'active' ? 'downgrade-status' : 'fix-route'
			: classification === 'missing-stable-selectors'
				? 'add-selectors'
				: classification === 'weak-page-only-scene'
					? 'author-scene'
					: 'none';
		items.push({
			guaranteeId: entry.manifest.id,
			status: entry.manifest.status,
			ownerPackage: entry.manifest.ownerPackage,
			type: entry.manifest.type,
			subtype: entry.manifest.subtype,
			journey: entry.manifest.journey,
			sourcePath: entry.relativePath,
			scenePath: relative(workspaceRoot, scenePath),
			...(currentRoute ? { currentRoute, resolvedRoute: currentRoute } : {}),
			routeExists,
			sceneWorkflowStepCount: workflow.length,
			interactiveStepCount,
			classification,
			requiredAction,
			diagnostics,
		});
	}
	const sceneBackedItems = items.filter((entry) => entry.scenePath);
	const activeSceneBacked = sceneBackedItems.filter((entry) => entry.status === 'active');
	const weakSceneContracts = sceneBackedItems.filter((entry) => entry.classification === 'weak-page-only-scene' || entry.classification === 'planned-product-contract').length;
	const missingRoutes = sceneBackedItems.filter((entry) => entry.classification === 'missing-product-route').length;
	const missingSelectors = sceneBackedItems.filter((entry) => entry.classification === 'missing-stable-selectors').length;
	const activeSceneBackedWeak = activeSceneBacked.filter((entry) => entry.classification === 'weak-page-only-scene').length;
	const activeMissingRoutes = activeSceneBacked.filter((entry) => entry.classification === 'missing-product-route').length;
	const activeMissingSelectors = activeSceneBacked.filter((entry) => entry.classification === 'missing-stable-selectors').length;
	const diagnostics = [...registry.diagnostics, ...graph.diagnostics, ...items.flatMap((entry) => entry.diagnostics)];
	const audit: TreeseedGuaranteeJourneyAudit = {
		schemaVersion: TREESEED_GUARANTEE_JOURNEY_AUDIT_SCHEMA_VERSION,
		workspaceRoot,
		generatedAt: (input.now ?? new Date()).toISOString(),
		totals: {
			guarantees: valid.length,
			sceneBacked: sceneBackedItems.length,
			activeSceneBacked: activeSceneBacked.length,
			weakSceneContracts,
			missingRoutes,
			missingSelectors,
			dependencyErrors: graph.diagnostics.filter((entry) => entry.severity === 'error').length,
			activeSceneBackedWeak,
			activeMissingRoutes,
			activeMissingSelectors,
		},
		items,
		diagnostics,
		ok: activeSceneBackedWeak === 0 && activeMissingRoutes === 0 && activeMissingSelectors === 0 && diagnostics.every((entry) => entry.severity !== 'error'),
	};
	if (input.writeReport) {
		const outputPath = assertPathInsideWorkspace(workspaceRoot, resolve(workspaceRoot, input.writeReport));
		mkdirSync(dirname(outputPath), { recursive: true });
		writeFileSync(outputPath, `${JSON.stringify(audit, null, 2)}\n`);
	}
	return audit;
}

export function csvEscape(value: unknown) {
	const text = Array.isArray(value) ? value.join('; ') : String(value ?? '');
	return /[",\n\r]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}
