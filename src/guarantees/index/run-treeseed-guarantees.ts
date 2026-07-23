import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { TreeseedGuaranteeDiagnostic, TreeseedGuaranteeFilter, TreeseedGuaranteeManifest, TreeseedLoadedGuarantee } from './treeseed-guarantee-schema-version.ts';
import { TreeseedGuaranteeRunReport, TreeseedGuaranteeRunResult, TreeseedGuaranteeRunState, TreeseedGuaranteeSceneExecutor, TreeseedGuaranteeVerifierExecutionResult, TreeseedGuaranteeVerifierExecutor, arrayOrEmpty, diagnostic, sortedUnique } from './treeseed-guarantee-journey-audit-item.ts';
import { defaultTreeseedGuaranteeSceneExecutor, releaseBlocking, runGuaranteeSteps, runIdFor, writeTreeseedGuaranteeRunReport } from './scene-report-evidence-paths.ts';
import { allVerifierRefs, discoverTreeseedGuarantees } from './parse-verifier-registry.ts';
import { planTreeseedGuarantees } from './plan-treeseed-guarantees.ts';
import { relativeEvidencePath, resolveTreeseedGuaranteeVerifierRefs, verifierDefinitionsByRef } from './export-treeseed-guarantees-csv.ts';
import { buildTreeseedGuaranteeDependencyGraph, refs } from './build-treeseed-guarantee-dependency-graph.ts';
import { defaultTreeseedGuaranteeVerifierExecutor } from './run-verifier-command.ts';

export async function runTreeseedGuarantees(input: {
	workspaceRoot: string;
	filter?: TreeseedGuaranteeFilter;
	environment?: string;
	outputRoot?: string;
	includeDependencies?: boolean;
	includePlanned?: boolean;
	failOnSkippedReleaseGuarantees?: boolean;
	record?: boolean;
	sceneArtifacts?: 'full' | 'screenshots';
	device?: string;
	evidenceTarget?: 'local' | 'ci' | 'release';
	sceneExecutor?: TreeseedGuaranteeSceneExecutor;
	verifierExecutor?: TreeseedGuaranteeVerifierExecutor;
	onProgress?: (message: string, stream?: 'stdout' | 'stderr') => void;
	now?: Date;
}): Promise<TreeseedGuaranteeRunReport> {
	const workspaceRoot = resolve(input.workspaceRoot);
	const environment = input.environment ?? 'local';
	const startedAtDate = input.now ?? new Date();
	const startedAt = startedAtDate.toISOString();
	const runId = runIdFor(startedAtDate);
	const outputRoot = resolve(workspaceRoot, input.outputRoot ?? (input.evidenceTarget === 'release'
		? `.treeseed/guarantees/release/${runId}`
		: `.treeseed/guarantees/runs/${runId}`));
	const filter = input.filter ?? {};
	const registry = discoverTreeseedGuarantees({ workspaceRoot, filter });
	const plan = planTreeseedGuarantees({ workspaceRoot, filter, environment, includeDependencies: input.includeDependencies });
	const diagnostics: TreeseedGuaranteeDiagnostic[] = [...registry.diagnostics, ...plan.diagnostics];
	const allResolutions = verifierDefinitionsByRef(registry.verifierRegistries);
	const verifierCache = new Map<string, TreeseedGuaranteeVerifierExecutionResult>();
	const graph = buildTreeseedGuaranteeDependencyGraph({ guarantees: registry.guarantees, filter, includeDependencies: input.includeDependencies !== false });
	diagnostics.push(...graph.diagnostics);
	const selectedIds = graph.selectedIds;
	const runEntries = graph.entries;
	const planEntryById = new Map(plan.entries.map((entry) => [entry.id, entry]));
	const resultById = new Map<string, TreeseedGuaranteeRunResult>();
	const results: TreeseedGuaranteeRunResult[] = [];
	input.onProgress?.(`[guarantees][run] planned ${runEntries.length} guarantee entries for ${environment}`);
	if (registry.ok && plan.ok) {
		for (const [index, entry] of runEntries.entries()) {
			input.onProgress?.(`[guarantees][run] ${index + 1}/${runEntries.length} ${entry.manifest.id} (${entry.manifest.ownerPackage}) ${entry.manifest.journey}`);
			const planEntry = planEntryById.get(entry.manifest.id);
			const blockingDependencies = arrayOrEmpty(planEntry?.dependsOn)
				.map((id) => resultById.get(id))
				.filter((result): result is TreeseedGuaranteeRunResult => Boolean(result && result.status !== 'passed'));
			if (blockingDependencies.length > 0) {
				const now = new Date().toISOString();
				const blockedBy = blockingDependencies.map((result) => result.id);
				const dependencyDiagnostic = diagnostic(
					'error',
					'guarantee.dependency_failed',
					`Dependency ${blockedBy.join(', ')} failed before ${entry.manifest.id}.`,
					'dependencies.guarantees',
					entry.sourcePath,
				);
				const blocked: TreeseedGuaranteeRunResult = {
					id: entry.manifest.id,
					...(entry.manifest.journeyIndex ? { journeyIndex: entry.manifest.journeyIndex } : {}),
					type: entry.manifest.type,
					subtype: entry.manifest.subtype,
					journey: entry.manifest.journey,
					ownerPackage: entry.manifest.ownerPackage,
					status: 'blocked',
					selected: selectedIds.has(entry.manifest.id),
					dependency: !selectedIds.has(entry.manifest.id),
					sourcePath: entry.relativePath,
					startedAt: now,
					completedAt: now,
					steps: [{
						id: 'dependency',
						kind: 'verifier',
						status: 'blocked',
						summary: `Blocked by failed prerequisite: ${blockedBy.join(', ')}.`,
						diagnostics: [dependencyDiagnostic],
						startedAt: now,
						completedAt: now,
					}],
					evidence: [],
					diagnostics: [dependencyDiagnostic],
				};
				results.push(blocked);
				resultById.set(blocked.id, blocked);
				input.onProgress?.(`[guarantees][run] ${entry.manifest.id}: blocked by ${blockedBy.join(', ')}`, 'stderr');
				continue;
			}
			if (entry.manifest.status !== 'active') {
				if (input.includePlanned) {
					const now = new Date().toISOString();
					input.onProgress?.(`[guarantees][run] ${entry.manifest.id}: skipped because status is ${entry.manifest.status}`);
					const skipped: TreeseedGuaranteeRunResult = {
						id: entry.manifest.id,
						...(entry.manifest.journeyIndex ? { journeyIndex: entry.manifest.journeyIndex } : {}),
						type: entry.manifest.type,
						subtype: entry.manifest.subtype,
						journey: entry.manifest.journey,
						ownerPackage: entry.manifest.ownerPackage,
						status: 'skipped',
						selected: selectedIds.has(entry.manifest.id),
						dependency: !selectedIds.has(entry.manifest.id),
						sourcePath: entry.relativePath,
						startedAt: now,
						completedAt: now,
						steps: [{ id: 'status', kind: 'verifier', status: 'skipped', summary: `Guarantee is ${entry.manifest.status}.`, startedAt: now, completedAt: now }],
						evidence: [],
						diagnostics: [],
					};
					results.push(skipped);
					resultById.set(skipped.id, skipped);
				}
				continue;
			}
			const resolution = resolveTreeseedGuaranteeVerifierRefs({
				refs: allVerifierRefs(entry.manifest),
				verifierRegistries: registry.verifierRegistries,
				status: entry.manifest.status,
				sourcePath: entry.sourcePath,
			});
			diagnostics.push(...resolution.diagnostics);
			if (!resolution.ok) {
				const now = new Date().toISOString();
				input.onProgress?.(`[guarantees][run] ${entry.manifest.id}: blocked by unresolved verifier refs`, 'stderr');
				const blocked: TreeseedGuaranteeRunResult = {
					id: entry.manifest.id,
					...(entry.manifest.journeyIndex ? { journeyIndex: entry.manifest.journeyIndex } : {}),
					type: entry.manifest.type,
					subtype: entry.manifest.subtype,
					journey: entry.manifest.journey,
					ownerPackage: entry.manifest.ownerPackage,
					status: 'blocked',
					selected: selectedIds.has(entry.manifest.id),
					dependency: !selectedIds.has(entry.manifest.id),
					sourcePath: entry.relativePath,
					startedAt: now,
					completedAt: now,
					steps: [],
					evidence: [],
					diagnostics: resolution.diagnostics,
				};
				results.push(blocked);
				resultById.set(blocked.id, blocked);
				continue;
			}
			const result = await runGuaranteeSteps({
				workspaceRoot,
				environment,
				runId,
				outputRoot,
				guarantee: entry,
				selected: selectedIds.has(entry.manifest.id),
				dependency: !selectedIds.has(entry.manifest.id),
				resolutions: allResolutions,
				sceneExecutor: input.sceneExecutor ?? defaultTreeseedGuaranteeSceneExecutor,
				verifierExecutor: input.verifierExecutor ?? defaultTreeseedGuaranteeVerifierExecutor,
				verifierCache,
				record: input.record,
				sceneArtifacts: input.sceneArtifacts,
				device: input.device,
				onProgress: input.onProgress,
			});
			results.push(result);
			resultById.set(result.id, result);
			input.onProgress?.(`[guarantees][run] ${entry.manifest.id}: ${result.status}`);
		}
	}
	const completedAt = new Date().toISOString();
	const releaseBlockingFailures = results.filter((result) => {
		const entry = runEntries.find((candidate) => candidate.manifest.id === result.id);
		return entry && releaseBlocking(entry.manifest) && ['failed', 'blocked', ...(input.failOnSkippedReleaseGuarantees === true ? ['skipped' as const] : [])].includes(result.status);
	}).length;
	const counts = {
		planned: plan.entries.filter((entry) => entry.status !== 'active').length,
		passed: results.filter((entry) => entry.status === 'passed').length,
		failed: results.filter((entry) => entry.status === 'failed').length,
		skipped: results.filter((entry) => entry.status === 'skipped').length,
		blocked: results.filter((entry) => entry.status === 'blocked').length,
		releaseBlockingFailures,
	};
	const report: TreeseedGuaranteeRunReport = {
		ok: registry.ok && plan.ok && counts.failed === 0 && counts.blocked === 0 && releaseBlockingFailures === 0,
		runId,
		workspaceRoot,
		environment,
		filter,
		startedAt,
		completedAt,
		outputRoot,
		statePath: relativeEvidencePath(workspaceRoot, resolve(outputRoot, 'state.json')),
		plan,
		results,
		diagnostics,
		counts,
	};
	mkdirSync(outputRoot, { recursive: true });
	const state: TreeseedGuaranteeRunState = {
		schemaVersion: 'treeseed.guarantee-run-state/v1',
		runId,
		values: {},
	};
	writeFileSync(resolve(outputRoot, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
	const writeResult = writeTreeseedGuaranteeRunReport({ report, registry });
	if (!writeResult.ok) {
		report.ok = false;
		report.diagnostics.push(...writeResult.diagnostics);
	}
	return report;
}

export function createTreeseedGuaranteeStatusReport(input: { workspaceRoot: string }) {
	const registry = discoverTreeseedGuarantees({ workspaceRoot: input.workspaceRoot });
	const valid = registry.guarantees.filter((entry): entry is TreeseedLoadedGuarantee & { manifest: TreeseedGuaranteeManifest } => Boolean(entry.manifest));
	const byType: Record<string, number> = {};
	const byStatus: Record<string, number> = {};
	for (const entry of valid) {
		byType[entry.manifest.type] = (byType[entry.manifest.type] ?? 0) + 1;
		byStatus[entry.manifest.status] = (byStatus[entry.manifest.status] ?? 0) + 1;
	}
	return {
		ok: registry.ok,
		workspaceRoot: resolve(input.workspaceRoot),
		guaranteeRoots: sortedUnique(valid.map((entry) => dirname(entry.relativePath).split(sep).slice(0, 3).join('/'))),
		counts: registry.counts,
		byType,
		byStatus,
		verifierRegistries: registry.verifierRegistries.length,
		diagnostics: registry.diagnostics,
	};
}

export function assertPathInsideWorkspace(workspaceRoot: string, path: string) {
	const resolvedWorkspace = resolve(workspaceRoot);
	const resolvedPath = resolve(path);
	if (resolvedPath !== resolvedWorkspace && !resolvedPath.startsWith(`${resolvedWorkspace}${sep}`)) {
		throw new Error(`Path is outside workspace: ${path}`);
	}
	return resolvedPath;
}

export function fileExists(path: string) {
	return existsSync(path) && statSync(path).isFile();
}
