import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { GuaranteeDiagnostic, GuaranteeFilter, GuaranteeManifest, LoadedGuarantee } from './guarantee-schema-version.ts';
import { GuaranteeRunReport, GuaranteeRunResult, GuaranteeRunState, GuaranteeSceneExecutor, GuaranteeVerifierExecutionResult, GuaranteeVerifierExecutor, arrayOrEmpty, diagnostic, sortedUnique } from './guarantee-journey-audit-item.ts';
import { defaultGuaranteeSceneExecutor, releaseBlocking, runGuaranteeSteps, runIdFor, writeGuaranteeRunReport } from './scene-report-evidence-paths.ts';
import { allVerifierRefs, discoverGuarantees } from './parse-verifier-registry.ts';
import { planGuarantees } from './plan-guarantees.ts';
import { relativeEvidencePath, resolveGuaranteeVerifierRefs, verifierDefinitionsByRef } from './export-guarantees-csv.ts';
import { buildGuaranteeDependencyGraph, refs } from './build-guarantee-dependency-graph.ts';
import { defaultGuaranteeVerifierExecutor } from './run-verifier-command.ts';

export async function runGuarantees(input: {
	workspaceRoot: string;
	filter?: GuaranteeFilter;
	environment?: string;
	outputRoot?: string;
	includeDependencies?: boolean;
	includePlanned?: boolean;
	failOnSkippedReleaseGuarantees?: boolean;
	record?: boolean;
	sceneArtifacts?: 'full' | 'screenshots';
	device?: string;
	evidenceTarget?: 'local' | 'ci' | 'release';
	sceneExecutor?: GuaranteeSceneExecutor;
	verifierExecutor?: GuaranteeVerifierExecutor;
	onProgress?: (message: string, stream?: 'stdout' | 'stderr') => void;
	now?: Date;
}): Promise<GuaranteeRunReport> {
	const workspaceRoot = resolve(input.workspaceRoot);
	const environment = input.environment ?? 'local';
	const startedAtDate = input.now ?? new Date();
	const startedAt = startedAtDate.toISOString();
	const runId = runIdFor(startedAtDate);
	const outputRoot = resolve(workspaceRoot, input.outputRoot ?? (input.evidenceTarget === 'release'
		? `.treeseed/guarantees/release/${runId}`
		: `.treeseed/guarantees/runs/${runId}`));
	const filter = input.filter ?? {};
	const registry = discoverGuarantees({ workspaceRoot, filter });
	const plan = planGuarantees({ workspaceRoot, filter, environment, includeDependencies: input.includeDependencies });
	const diagnostics: GuaranteeDiagnostic[] = [...registry.diagnostics, ...plan.diagnostics];
	const allResolutions = verifierDefinitionsByRef(registry.verifierRegistries);
	const verifierCache = new Map<string, GuaranteeVerifierExecutionResult>();
	const graph = buildGuaranteeDependencyGraph({ guarantees: registry.guarantees, filter, includeDependencies: input.includeDependencies !== false });
	diagnostics.push(...graph.diagnostics);
	const selectedIds = graph.selectedIds;
	const runEntries = graph.entries;
	const planEntryById = new Map(plan.entries.map((entry) => [entry.id, entry]));
	const resultById = new Map<string, GuaranteeRunResult>();
	const results: GuaranteeRunResult[] = [];
	input.onProgress?.(`[guarantees][run] planned ${runEntries.length} guarantee entries for ${environment}`);
	if (registry.ok && plan.ok) {
		for (const [index, entry] of runEntries.entries()) {
			input.onProgress?.(`[guarantees][run] ${index + 1}/${runEntries.length} ${entry.manifest.id} (${entry.manifest.ownerPackage}) ${entry.manifest.journey}`);
			const planEntry = planEntryById.get(entry.manifest.id);
			const blockingDependencies = arrayOrEmpty(planEntry?.dependsOn)
				.map((id) => resultById.get(id))
				.filter((result): result is GuaranteeRunResult => Boolean(result && result.status !== 'passed'));
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
				const blocked: GuaranteeRunResult = {
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
					const skipped: GuaranteeRunResult = {
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
			const resolution = resolveGuaranteeVerifierRefs({
				refs: allVerifierRefs(entry.manifest),
				verifierRegistries: registry.verifierRegistries,
				status: entry.manifest.status,
				sourcePath: entry.sourcePath,
			});
			diagnostics.push(...resolution.diagnostics);
			if (!resolution.ok) {
				const now = new Date().toISOString();
				input.onProgress?.(`[guarantees][run] ${entry.manifest.id}: blocked by unresolved verifier refs`, 'stderr');
				const blocked: GuaranteeRunResult = {
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
				sceneExecutor: input.sceneExecutor ?? defaultGuaranteeSceneExecutor,
				verifierExecutor: input.verifierExecutor ?? defaultGuaranteeVerifierExecutor,
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
	const report: GuaranteeRunReport = {
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
	const state: GuaranteeRunState = {
		schemaVersion: 'treeseed.guarantee-run-state/v1',
		runId,
		values: {},
	};
	writeFileSync(resolve(outputRoot, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
	const writeResult = writeGuaranteeRunReport({ report, registry });
	if (!writeResult.ok) {
		report.ok = false;
		report.diagnostics.push(...writeResult.diagnostics);
	}
	return report;
}

export function createGuaranteeStatusReport(input: { workspaceRoot: string }) {
	const registry = discoverGuarantees({ workspaceRoot: input.workspaceRoot });
	const valid = registry.guarantees.filter((entry): entry is LoadedGuarantee & { manifest: GuaranteeManifest } => Boolean(entry.manifest));
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
