import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { GuaranteeReportWriteResult, GuaranteeRunReport, GuaranteeRunStatus, GuaranteeRunStep, GuaranteeSceneExecutionInput, GuaranteeSceneExecutor, GuaranteeVerifierExecutionResult, GuaranteeVerifierExecutor, GuaranteeVerifierResolution, arrayOrEmpty, diagnostic, sortedUnique } from './guarantee-journey-audit-item.ts';
import { exportGuaranteesCsv, relativeEvidencePath } from './export-guarantees-csv.ts';
import { sceneAuthRoleForGuarantee, sceneDeviceRunsForGuarantee, validateGuaranteeSceneJourneyContract } from './run-verifier-command.ts';
import { GuaranteeDiagnostic, GuaranteeManifest, GuaranteeRegistryReport, LoadedGuarantee } from './guarantee-schema-version.ts';
import { refs } from './build-guarantee-dependency-graph.ts';

export function sceneReportEvidencePaths(workspaceRoot: string, report: {
	artifacts?: { runRoot?: string; screenshotPaths?: string[] };
	playwrightTracePath?: string | null;
	storageStatePath?: string | null;
	steps?: Array<{ screenshotPath?: string | null }>;
}) {
	const primaryScreenshots = [
		...arrayOrEmpty(report.steps).map((step) => step.screenshotPath).filter(Boolean),
		...arrayOrEmpty(report.artifacts?.screenshotPaths),
	].filter((path): path is string => Boolean(path && !path.includes('/screenshots/viewport/')));
	return sortedUnique([
		...primaryScreenshots,
		report.playwrightTracePath ?? undefined,
		report.storageStatePath ?? undefined,
		report.artifacts?.runRoot,
	].filter(Boolean).map((entry) => relativeEvidencePath(workspaceRoot, entry!)));
}

export async function defaultGuaranteeSceneExecutor(input: GuaranteeSceneExecutionInput): Promise<GuaranteeVerifierExecutionResult> {
	try {
		const contractDiagnostics = validateGuaranteeSceneJourneyContract({ scenePath: input.scenePath, sourcePath: input.guarantee.sourcePath });
		const scenes = await import('../../scenes/index.ts');
		const authRole = sceneAuthRoleForGuarantee(input.guarantee.manifest);
		const runs = sceneDeviceRunsForGuarantee(input.device ? [input.device] : input.guarantee.manifest.devices.required);
		const scene = parseYaml(readFileSync(input.scenePath, 'utf8')) as Record<string, unknown>;
		const stateRefs = journeyStateRefs(scene);
		const runResults: GuaranteeVerifierExecutionResult[] = [];
		for (const run of runs) {
			const cacheKey = `${input.environment}:${input.executionKey}:${run.id}`;
			const cached = input.sceneCache.get(cacheKey);
			if (cached) {
				runResults.push({ ...cached, summary: `${cached.summary ?? 'Scene passed.'} (cached execution ${input.executionKey})` });
				continue;
			}
			const browserInputs = stateRefs.consumes.filter((entry) => entry.kind === 'browser-storage');
			const browserOutputs = stateRefs.produces.filter((entry) => entry.kind === 'browser-storage');
			if (browserInputs.length > 1 || browserOutputs.length > 1) {
				runResults.push(sceneStateFailure(input, 'guarantee.scene_browser_state_ambiguous', 'A scene may consume and produce at most one browser-storage state.'));
				continue;
			}
			const inputState = browserInputs[0] ? input.runState.values[stateValueKey(browserInputs[0].key, run.id)] : undefined;
			if (browserInputs[0] && !inputState) {
				runResults.push(sceneStateFailure(input, 'guarantee.scene_state_missing', `Missing browser state ${browserInputs[0].key} for ${run.id}.`));
				continue;
			}
			const outputStorageStatePath = browserOutputs[0]
				? resolve(input.outputRoot, 'state', `${safeStateKey(browserOutputs[0].key)}-${run.id}.json`)
				: undefined;
			if (outputStorageStatePath) mkdirSync(dirname(outputStorageStatePath), { recursive: true });
			const inputStorageStatePath = typeof (inputState?.value as { path?: unknown } | undefined)?.path === 'string'
				? (inputState!.value as { path: string }).path
				: undefined;
			const report = await scenes.runScene({
				projectRoot: input.workspaceRoot,
				scene: input.scenePath,
				environment: input.environment,
				device: run.device,
				browser: run.browser,
				authRole,
				record: input.record,
				artifactMode: input.artifactMode,
				mode: 'acceptance',
				runId: `${input.runId}-${run.id}`,
				...(inputStorageStatePath ? { inputStorageStatePath } : {}),
				...(outputStorageStatePath ? { outputStorageStatePath } : {}),
			});
			const ok = contractDiagnostics.length === 0 && report.ok;
			const result: GuaranteeVerifierExecutionResult = {
				status: ok ? 'passed' : 'failed',
				summary: ok ? 'Scene passed.' : contractDiagnostics.length > 0 ? 'Scene is not a complete service journey.' : 'Scene failed.',
				evidence: sceneReportEvidencePaths(input.workspaceRoot, report),
				diagnostics: [...contractDiagnostics, ...arrayOrEmpty(report.diagnostics)] as GuaranteeDiagnostic[],
			};
			if (ok) recordProducedState({ input, refs: stateRefs.produces, device: run.id, outputStorageStatePath });
			input.sceneCache.set(cacheKey, result);
			runResults.push(result);
		}
		const ok = runResults.length > 0 && runResults.every((entry) => entry.status === 'passed');
		return {
			status: ok ? 'passed' : 'failed',
			summary: ok ? (runs.length > 1 ? 'Scene device graph passed.' : runResults[0]?.summary) : 'Scene device graph failed.',
			evidence: runResults.flatMap((entry) => arrayOrEmpty(entry.evidence)),
			diagnostics: runResults.flatMap((entry) => arrayOrEmpty(entry.diagnostics)),
		};
	} catch (error) {
		return {
			status: 'failed',
			summary: error instanceof Error ? error.message : String(error),
			diagnostics: [diagnostic('error', 'guarantee.scene_execution_failed', error instanceof Error ? error.message : String(error), 'scene', input.guarantee.sourcePath)],
		};
	}
}

type JourneyStateRef = { key: string; kind: string };

function journeyStateRefs(scene: Record<string, unknown>) {
	const journey = scene.journey && typeof scene.journey === 'object' ? scene.journey as Record<string, unknown> : {};
	const refs = (field: 'producesState' | 'consumesState') => arrayOrEmpty(journey[field] as unknown[])
		.flatMap((entry): JourneyStateRef[] => entry && typeof entry === 'object'
			&& typeof (entry as Record<string, unknown>).key === 'string'
			? [{ key: String((entry as Record<string, unknown>).key), kind: String((entry as Record<string, unknown>).kind ?? 'marker') }]
			: []);
	return { produces: refs('producesState'), consumes: refs('consumesState') };
}

function stateValueKey(key: string, device: string) {
	return `${key}@${device}`;
}

function safeStateKey(key: string) {
	return key.replace(/[^a-z0-9._-]+/giu, '-');
}

function sceneStateFailure(input: GuaranteeSceneExecutionInput, code: string, message: string): GuaranteeVerifierExecutionResult {
	return {
		status: 'failed',
		summary: message,
		diagnostics: [diagnostic('error', code, message, 'scene.journey', input.guarantee.sourcePath)],
	};
}

function recordProducedState(input: {
	input: GuaranteeSceneExecutionInput;
	refs: JourneyStateRef[];
	device: string;
	outputStorageStatePath?: string;
}) {
	const createdAt = new Date().toISOString();
	for (const ref of input.refs) {
		input.input.runState.values[stateValueKey(ref.key, input.device)] = {
			producerGuaranteeId: input.input.guarantee.manifest.id,
			executionKey: input.input.executionKey,
			device: input.device,
			kind: ref.kind === 'browser-storage' ? 'browser-storage' : 'marker',
			value: ref.kind === 'browser-storage' ? { path: input.outputStorageStatePath } : { ready: true },
			createdAt,
		};
	}
}

export function markdownRunReport(report: GuaranteeRunReport) {
	return [
		'# TreeSeed Guarantee Run',
		'',
		`Run: ${report.runId}`,
		`Environment: ${report.environment}`,
		`Started: ${report.startedAt}`,
		`Completed: ${report.completedAt}`,
		'',
		`Passed: ${report.counts.passed}`,
		`Failed: ${report.counts.failed}`,
		`Skipped: ${report.counts.skipped}`,
		`Blocked: ${report.counts.blocked}`,
		`Release blocking failures: ${report.counts.releaseBlockingFailures}`,
		'',
		'| Guarantee | Status | Steps |',
		'| --- | --- | --- |',
		...report.results.map((entry) => `| ${entry.id} | ${entry.status} | ${entry.steps.map((step) => `${step.id}:${step.status}`).join('<br>')} |`),
		'',
	].join('\n');
}

export function writeGuaranteeRunReport(input: { report: GuaranteeRunReport; registry?: GuaranteeRegistryReport }): GuaranteeReportWriteResult {
	const diagnostics: GuaranteeDiagnostic[] = [];
	const outputRoot = resolve(input.report.outputRoot);
	try {
		mkdirSync(outputRoot, { recursive: true });
		const planPath = resolve(outputRoot, 'plan.json');
		const reportPath = resolve(outputRoot, 'report.json');
		const markdownPath = resolve(outputRoot, 'report.md');
		const csvPath = resolve(outputRoot, 'generated.csv');
		writeFileSync(planPath, `${JSON.stringify(input.report.plan, null, 2)}\n`, 'utf8');
		writeFileSync(reportPath, `${JSON.stringify(input.report, null, 2)}\n`, 'utf8');
		writeFileSync(markdownPath, markdownRunReport(input.report), 'utf8');
		if (input.registry) writeFileSync(csvPath, exportGuaranteesCsv({ guarantees: input.registry.guarantees, filter: input.report.filter }), 'utf8');
		else writeFileSync(csvPath, '', 'utf8');
		return { ok: true, outputRoot, planPath, reportPath, markdownPath, csvPath, diagnostics };
	} catch (error) {
		diagnostics.push(diagnostic('error', 'guarantee.report_write_failed', error instanceof Error ? error.message : String(error), 'outputRoot', outputRoot));
		return {
			ok: false,
			outputRoot,
			planPath: resolve(outputRoot, 'plan.json'),
			reportPath: resolve(outputRoot, 'report.json'),
			markdownPath: resolve(outputRoot, 'report.md'),
			csvPath: resolve(outputRoot, 'generated.csv'),
			diagnostics,
		};
	}
}

export function runIdFor(now: Date) {
	return now.toISOString().replace(/[:.]/gu, '-');
}

export function releaseBlocking(manifest: GuaranteeManifest) {
	return manifest.run?.requiredForRelease === true || manifest.gates.includes('release') || manifest.gates.includes('security') || manifest.gates.includes('migration');
}

export async function runGuaranteeSteps(input: {
	workspaceRoot: string;
	environment: string;
	runId: string;
	outputRoot: string;
	guarantee: LoadedGuarantee & { manifest: GuaranteeManifest };
	selected: boolean;
	dependency: boolean;
	resolutions: Map<string, GuaranteeVerifierResolution>;
	sceneExecutor: GuaranteeSceneExecutor;
	verifierExecutor: GuaranteeVerifierExecutor;
	verifierCache: Map<string, GuaranteeVerifierExecutionResult>;
	sceneCache: Map<string, GuaranteeVerifierExecutionResult>;
	runState: import('./guarantee-journey-audit-item.ts').GuaranteeRunState;
	record?: boolean;
	sceneArtifacts?: 'full' | 'screenshots';
	device?: string;
	onProgress?: (message: string, stream?: 'stdout' | 'stderr') => void;
}) {
	const startedAt = new Date().toISOString();
	const steps: GuaranteeRunStep[] = [];
	const diagnostics: GuaranteeDiagnostic[] = [];
	const evidence: string[] = [];
	const addStep = async (step: Omit<GuaranteeRunStep, 'startedAt' | 'completedAt'>, run: () => Promise<GuaranteeVerifierExecutionResult>) => {
		const stepStartedAt = new Date().toISOString();
		input.onProgress?.(`[guarantees][step] ${input.guarantee.manifest.id}: starting ${step.kind}${step.ref ? ` ${step.ref}` : ''}`);
		const result = await run();
		const completedAt = new Date().toISOString();
		const nextStep: GuaranteeRunStep = {
			...step,
			status: result.status,
			summary: result.summary ?? step.summary,
			evidence: result.evidence ?? arrayOrEmpty(step.evidence),
			diagnostics: result.diagnostics ?? arrayOrEmpty(step.diagnostics),
			startedAt: stepStartedAt,
			completedAt,
		};
		steps.push(nextStep);
		evidence.push(...arrayOrEmpty(nextStep.evidence));
		diagnostics.push(...arrayOrEmpty(nextStep.diagnostics));
		input.onProgress?.(`[guarantees][step] ${input.guarantee.manifest.id}: ${nextStep.status} ${step.kind}${step.ref ? ` ${step.ref}` : ''}`);
	};
	const scene = input.guarantee.manifest.scene;
	if (scene?.required && scene.manifest) {
		const scenePath = resolve(dirname(input.guarantee.sourcePath), scene.manifest);
		await addStep({ id: 'scene', kind: 'scene', status: 'blocked' }, () => input.sceneExecutor({
			workspaceRoot: input.workspaceRoot,
			environment: input.environment,
			runId: input.runId,
			outputRoot: input.outputRoot,
			guarantee: input.guarantee,
			scenePath,
			executionKey: scene.executionKey ?? input.guarantee.manifest.id,
			sceneCache: input.sceneCache,
			runState: input.runState,
			record: input.record ?? false,
			artifactMode: input.sceneArtifacts,
			device: input.device,
		}));
	}
	const verifierGroups: Array<{ kind: GuaranteeRunStep['kind']; refs: string[] }> = [
		{ kind: 'api', refs: arrayOrEmpty(input.guarantee.manifest.api?.verifierRefs) },
		{ kind: 'content', refs: arrayOrEmpty(input.guarantee.manifest.content?.verifierRefs) },
		{ kind: 'audit', refs: arrayOrEmpty(input.guarantee.manifest.audit?.verifierRefs) },
		{ kind: 'negative-case', refs: arrayOrEmpty(input.guarantee.manifest.negativeCases).flatMap((entry) => arrayOrEmpty(entry.verifierRefs)) },
	];
	for (const group of verifierGroups) {
		for (const ref of group.refs) {
			const resolution = input.resolutions.get(ref);
			if (!resolution?.definition) {
				const missing = diagnostic('error', 'guarantee.verifier_unresolved', `Verifier ref "${ref}" is not resolved.`, ref, input.guarantee.sourcePath);
				steps.push({ id: ref, kind: group.kind, ref, status: 'blocked', diagnostics: [missing], startedAt: new Date().toISOString(), completedAt: new Date().toISOString() });
				diagnostics.push(missing);
				continue;
			}
			const cacheKey = `${input.environment}:${ref}`;
			await addStep({ id: ref, kind: group.kind, ref, status: 'blocked' }, async () => {
				const cached = input.verifierCache.get(cacheKey);
				if (cached) return { ...cached, summary: `${cached.summary ?? `${ref} passed.`} (cached)` };
				const result = await input.verifierExecutor({
				workspaceRoot: input.workspaceRoot,
				environment: input.environment,
				runId: input.runId,
				outputRoot: input.outputRoot,
				guarantee: input.guarantee,
				ref,
				definition: resolution.definition!,
				kind: group.kind,
				onProgress: input.onProgress,
				});
				input.verifierCache.set(cacheKey, result);
				return result;
			});
		}
	}
	const status: GuaranteeRunStatus = steps.some((step) => step.status === 'failed')
		? 'failed'
		: steps.some((step) => step.status === 'blocked')
			? 'blocked'
			: steps.some((step) => step.status === 'skipped')
				? 'skipped'
				: 'passed';
	return {
		id: input.guarantee.manifest.id,
		...(input.guarantee.manifest.journeyIndex ? { journeyIndex: input.guarantee.manifest.journeyIndex } : {}),
		type: input.guarantee.manifest.type,
		subtype: input.guarantee.manifest.subtype,
		journey: input.guarantee.manifest.journey,
		ownerPackage: input.guarantee.manifest.ownerPackage,
		status,
		selected: input.selected,
		dependency: input.dependency,
		sourcePath: input.guarantee.relativePath,
		startedAt,
		completedAt: new Date().toISOString(),
		steps,
		evidence,
		diagnostics,
	};
}
