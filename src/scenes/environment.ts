import { readTreeseedDevInstance, startTreeseedManagedDev } from '../local-dev/managed-dev.ts';
import { collectTreeseedDeploymentReadiness } from '../workflow-support.ts';
import { sceneErrorDiagnostic, sceneWarningDiagnostic } from './diagnostics.ts';
import type { TreeseedSceneEnvironmentPrepareOptions, TreeseedSceneEnvironmentPrepareReport } from './types.ts';

function healthUrl(instance: unknown) {
	const candidate = instance as { health?: Array<{ kind?: string; url?: string }> } | null;
	return candidate?.health?.find((entry) => entry.kind === 'http' && typeof entry.url === 'string')?.url ?? null;
}

function running(instance: unknown) {
	return Boolean((instance as { running?: boolean } | null)?.running);
}

export async function prepareTreeseedSceneEnvironment(input: TreeseedSceneEnvironmentPrepareOptions): Promise<TreeseedSceneEnvironmentPrepareReport> {
	const diagnostics = [];
	let readiness: unknown | null = null;
	try {
		readiness = collectTreeseedDeploymentReadiness({ tenantRoot: input.projectRoot, environment: input.environment });
		if (input.environment !== 'local' && (readiness as { ok?: boolean } | null)?.ok === false) {
			diagnostics.push(sceneErrorDiagnostic('scene.readiness_failed', `Treeseed ${input.environment} readiness failed. Run trsd ready ${input.environment} --json for details.`, 'setup.readiness'));
		}
	} catch (error) {
		const diagnostic = sceneWarningDiagnostic('scene.readiness_unavailable', error instanceof Error ? error.message : String(error ?? 'Readiness could not be collected.'), 'setup.readiness');
		if (input.environment === 'local') diagnostics.push(diagnostic);
		else diagnostics.push({ ...diagnostic, severity: 'error' as const, code: 'scene.readiness_failed' });
	}

	const requested = input.environment === 'local' && input.scene.setup.dev?.required === true;
	const command = input.scene.setup.dev?.command;
	if (command) {
		diagnostics.push(sceneWarningDiagnostic('scene.setup_command_not_executed', `Scene setup command is informational in Phase 3 and was not executed: ${command}`, 'setup.dev.command'));
	}
	let reused = false;
	let started = false;
	let instances: unknown[] = [];
	let baseUrl: string | null = null;
	if (requested) {
		const existing = readTreeseedDevInstance({ cwd: input.projectRoot, surface: 'web' });
		const existingApi = readTreeseedDevInstance({ cwd: input.projectRoot, surface: 'api' });
		if (running(existing) && healthUrl(existing) && running(existingApi) && healthUrl(existingApi)) {
			reused = true;
			instances = [existing, existingApi];
			baseUrl = healthUrl(existing);
		} else {
			try {
				const result = await startTreeseedManagedDev({ cwd: input.projectRoot, surfaces: 'web,api,operations-runner', webRuntime: 'local', env: input.env });
				instances = result.instances;
				const web = result.instances.find((entry) => entry.surface === 'web' || entry.id === 'web');
				started = Boolean(web && running(web));
				baseUrl = web ? healthUrl(web) : null;
				if (!started || !baseUrl) {
					diagnostics.push(sceneErrorDiagnostic('scene.local_dev_start_failed', 'Local dev was requested but the managed web surface did not start.', 'setup.dev'));
				}
			} catch (error) {
				diagnostics.push(sceneErrorDiagnostic('scene.local_dev_start_failed', error instanceof Error ? error.message : String(error ?? 'Local dev start failed.'), 'setup.dev'));
			}
		}
	}
	return {
		ok: !diagnostics.some((entry) => entry.severity === 'error'),
		environment: input.environment,
		readiness,
		dev: { requested, reused, started, instances, baseUrl },
		diagnostics,
	};
}
