import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { listSceneDeviceProfiles, resolveSceneDeviceProfile } from './devices.ts';
import { validateScene } from '../support/execution/planner.ts';
import { runScene } from '../operations/runner.ts';
import type {
	SceneDeviceMatrixOptions,
	SceneDeviceMatrixReport,
	SceneDeviceProfileId,
	SceneDiagnostic,
} from '../types.ts';

function splitDiagnostics(diagnostics: SceneDiagnostic[], severity: 'error' | 'warning') {
	return diagnostics.filter((entry) => entry.severity === severity);
}

function timestampId(value?: string) {
	return value ?? new Date().toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z');
}

export async function runSceneDeviceMatrix(input: SceneDeviceMatrixOptions): Promise<SceneDeviceMatrixReport> {
	const validation = validateScene({ projectRoot: input.projectRoot, scene: input.scene });
	if (!validation.ok || !validation.scene) {
		return {
			ok: false,
			phase: 11,
			sceneId: validation.scene?.id ?? null,
			matrixId: null,
			scenePath: validation.scenePath,
			devices: input.devices ?? [],
			runReports: [],
			matrixRoot: null,
			matrixPath: null,
			diagnostics: validation.diagnostics,
			warnings: splitDiagnostics(validation.diagnostics, 'warning'),
			blockers: splitDiagnostics(validation.diagnostics, 'error'),
		};
	}
	const scene = validation.scene;
	const requested = input.devices?.length ? input.devices : listSceneDeviceProfiles(scene).map((profile) => profile.id);
	const diagnostics: SceneDiagnostic[] = [];
	const profiles: SceneDeviceProfileId[] = [];
	for (const device of requested) {
		const resolved = resolveSceneDeviceProfile({ scene, device });
		diagnostics.push(...resolved.diagnostics);
		if (resolved.profile) profiles.push(resolved.profile.id);
	}
	if (diagnostics.some((entry) => entry.severity === 'error')) {
		return {
			ok: false,
			phase: 11,
			sceneId: scene.id,
			matrixId: null,
			scenePath: validation.scenePath,
			devices: requested,
			runReports: [],
			matrixRoot: null,
			matrixPath: null,
			diagnostics,
			warnings: splitDiagnostics(diagnostics, 'warning'),
			blockers: splitDiagnostics(diagnostics, 'error'),
		};
	}
	const matrixId = timestampId(input.timestamp).toLowerCase();
	const matrixRoot = join(input.projectRoot, '.treeseed', 'scenes', 'matrix', scene.id, `${timestampId(input.timestamp)}-${matrixId}`);
	const matrixPath = join(matrixRoot, 'matrix.json');
	mkdirSync(matrixRoot, { recursive: true });
	const runReports = [];
	for (const device of profiles) {
		const runReport = await runScene({
			projectRoot: input.projectRoot,
			scene: input.scene,
			environment: input.environment,
			device,
			browser: input.browser,
			authRole: input.authRole,
			record: input.record,
			artifactMode: input.artifactMode,
			mode: input.mode,
			timestamp: input.timestamp,
			runId: `${matrixId}-${device}`,
			browserAdapter: input.browserAdapter,
		});
		runReports.push(runReport);
	}
	const ok = runReports.every((report) => report.ok);
	const runDiagnostics = runReports.flatMap((entry) => entry.diagnostics ?? []);
	const allDiagnostics = [...diagnostics, ...runDiagnostics];
	const report: SceneDeviceMatrixReport = {
		ok,
		phase: 11,
		sceneId: scene.id,
		matrixId,
		scenePath: validation.scenePath,
		devices: profiles,
		runReports,
		matrixRoot,
		matrixPath,
		diagnostics: allDiagnostics,
		warnings: splitDiagnostics(allDiagnostics, 'warning'),
		blockers: splitDiagnostics(allDiagnostics, 'error'),
	};
	writeFileSync(matrixPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
	return report;
}
