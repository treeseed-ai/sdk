import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { TreeseedGuaranteeReportWriteResult, TreeseedGuaranteeRunReport, TreeseedGuaranteeRunStatus, TreeseedGuaranteeRunStep, TreeseedGuaranteeSceneExecutionInput, TreeseedGuaranteeSceneExecutor, TreeseedGuaranteeVerifierExecutionResult, TreeseedGuaranteeVerifierExecutor, TreeseedGuaranteeVerifierResolution, arrayOrEmpty, diagnostic, sortedUnique } from './treeseed-guarantee-journey-audit-item.ts';
import { exportTreeseedGuaranteesCsv, relativeEvidencePath } from './export-treeseed-guarantees-csv.ts';
import { sceneAuthRoleForGuarantee, sceneDeviceRunsForGuarantee, validateGuaranteeSceneJourneyContract } from './run-verifier-command.ts';
import { TreeseedGuaranteeDiagnostic, TreeseedGuaranteeManifest, TreeseedGuaranteeRegistryReport, TreeseedLoadedGuarantee } from './treeseed-guarantee-schema-version.ts';
import { refs } from './build-treeseed-guarantee-dependency-graph.ts';

export function sceneReportEvidencePaths(workspaceRoot: string, report: {
	artifacts?: { runRoot?: string; screenshotPaths?: string[] };
	playwrightTracePath?: string | null;
	steps?: Array<{ screenshotPath?: string | null }>;
}) {
	const primaryScreenshots = [
		...arrayOrEmpty(report.steps).map((step) => step.screenshotPath).filter(Boolean),
		...arrayOrEmpty(report.artifacts?.screenshotPaths),
	].filter((path): path is string => Boolean(path && !path.includes('/screenshots/viewport/')));
	return sortedUnique([
		...primaryScreenshots,
		report.playwrightTracePath ?? undefined,
		report.artifacts?.runRoot,
	].filter(Boolean).map((entry) => relativeEvidencePath(workspaceRoot, entry!)));
}

export async function defaultTreeseedGuaranteeSceneExecutor(input: TreeseedGuaranteeSceneExecutionInput): Promise<TreeseedGuaranteeVerifierExecutionResult> {
	try {
		const contractDiagnostics = validateGuaranteeSceneJourneyContract({ scenePath: input.scenePath, sourcePath: input.guarantee.sourcePath });
		const scenes = await import('../scenes/index.ts');
		const authRole = sceneAuthRoleForGuarantee(input.guarantee.manifest);
		const runs = sceneDeviceRunsForGuarantee(input.device ? [input.device] : input.guarantee.manifest.devices.required);
		if (runs.length > 1) {
			const runReports = [];
			for (const run of runs) {
				const report = await scenes.runTreeseedScene({
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
				});
				runReports.push(report);
			}
			const ok = contractDiagnostics.length === 0 && runReports.every((entry: { ok: boolean }) => entry.ok);
			return {
				status: ok ? 'passed' : 'failed',
				summary: ok ? 'Scene device matrix passed.' : contractDiagnostics.length > 0 ? 'Scene is not a complete service journey.' : 'Scene device matrix failed.',
				evidence: runReports.flatMap((entry) => sceneReportEvidencePaths(input.workspaceRoot, entry)),
				diagnostics: [...contractDiagnostics, ...runReports.flatMap((entry: { diagnostics?: unknown[] }) => arrayOrEmpty(entry.diagnostics))] as TreeseedGuaranteeDiagnostic[],
			};
		}
		const run = runs[0]!;
		const report = await scenes.runTreeseedScene({
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
		});
		const ok = contractDiagnostics.length === 0 && report.ok;
		return {
			status: ok ? 'passed' : 'failed',
			summary: ok ? 'Scene passed.' : contractDiagnostics.length > 0 ? 'Scene is not a complete service journey.' : 'Scene failed.',
			evidence: sceneReportEvidencePaths(input.workspaceRoot, report),
			diagnostics: [...contractDiagnostics, ...arrayOrEmpty(report.diagnostics)],
		};
	} catch (error) {
		return {
			status: 'failed',
			summary: error instanceof Error ? error.message : String(error),
			diagnostics: [diagnostic('error', 'guarantee.scene_execution_failed', error instanceof Error ? error.message : String(error), 'scene', input.guarantee.sourcePath)],
		};
	}
}

export function markdownRunReport(report: TreeseedGuaranteeRunReport) {
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

export function writeTreeseedGuaranteeRunReport(input: { report: TreeseedGuaranteeRunReport; registry?: TreeseedGuaranteeRegistryReport }): TreeseedGuaranteeReportWriteResult {
	const diagnostics: TreeseedGuaranteeDiagnostic[] = [];
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
		if (input.registry) writeFileSync(csvPath, exportTreeseedGuaranteesCsv({ guarantees: input.registry.guarantees, filter: input.report.filter }), 'utf8');
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

export function releaseBlocking(manifest: TreeseedGuaranteeManifest) {
	return manifest.run?.requiredForRelease === true || manifest.gates.includes('release') || manifest.gates.includes('security') || manifest.gates.includes('migration');
}

export async function runGuaranteeSteps(input: {
	workspaceRoot: string;
	environment: string;
	runId: string;
	outputRoot: string;
	guarantee: TreeseedLoadedGuarantee & { manifest: TreeseedGuaranteeManifest };
	selected: boolean;
	dependency: boolean;
	resolutions: Map<string, TreeseedGuaranteeVerifierResolution>;
	sceneExecutor: TreeseedGuaranteeSceneExecutor;
	verifierExecutor: TreeseedGuaranteeVerifierExecutor;
	verifierCache: Map<string, TreeseedGuaranteeVerifierExecutionResult>;
	record?: boolean;
	sceneArtifacts?: 'full' | 'screenshots';
	device?: string;
	onProgress?: (message: string, stream?: 'stdout' | 'stderr') => void;
}) {
	const startedAt = new Date().toISOString();
	const steps: TreeseedGuaranteeRunStep[] = [];
	const diagnostics: TreeseedGuaranteeDiagnostic[] = [];
	const evidence: string[] = [];
	const addStep = async (step: Omit<TreeseedGuaranteeRunStep, 'startedAt' | 'completedAt'>, run: () => Promise<TreeseedGuaranteeVerifierExecutionResult>) => {
		const stepStartedAt = new Date().toISOString();
		input.onProgress?.(`[guarantees][step] ${input.guarantee.manifest.id}: starting ${step.kind}${step.ref ? ` ${step.ref}` : ''}`);
		const result = await run();
		const completedAt = new Date().toISOString();
		const nextStep: TreeseedGuaranteeRunStep = {
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
			record: input.record ?? false,
			artifactMode: input.sceneArtifacts,
			device: input.device,
		}));
	}
	const verifierGroups: Array<{ kind: TreeseedGuaranteeRunStep['kind']; refs: string[] }> = [
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
	const status: TreeseedGuaranteeRunStatus = steps.some((step) => step.status === 'failed')
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
