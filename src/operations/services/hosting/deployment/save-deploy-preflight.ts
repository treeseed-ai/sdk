import { spawnSync } from 'node:child_process';
import { packageScriptPath } from '../../agents/runtime-tools.ts';
import { applyEnvironmentToProcess, assertCommandEnvironment } from '../../configuration/config-runtime.ts';
import { collectCliPreflight } from '../../treedx/workspaces/workspace-preflight.ts';
import { requiredGitHubEnvironment } from '../../repositories/github-automation.ts';

function runStep(label, scriptName, { cwd, env } = {}) {
	const startedAt = Date.now();
	process.stderr.write(`[preflight] ${label} start (${scriptName})\n`);
	const result = spawnSync(process.execPath, [packageScriptPath(scriptName)], {
		cwd,
		env: { ...process.env, ...(env ?? {}) },
		stdio: 'inherit',
	});
	const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);

	if (result.status !== 0) {
		process.stderr.write(`[preflight] ${label} failed after ${elapsedSeconds}s (${scriptName})\n`);
		const error = new Error(`${label} failed.`);
		error.kind = `${label}_failed`;
		error.exitCode = result.status ?? 1;
		throw error;
	}
	process.stderr.write(`[preflight] ${label} complete after ${elapsedSeconds}s (${scriptName})\n`);
}

function missingRequiredEnv(requiredKeys) {
	return requiredKeys.filter((key) => {
		const value = process.env[key];
		return typeof value !== 'string' || value.length === 0;
	});
}

export function validateSaveAutomationPrerequisites({ cwd }) {
	applyEnvironmentToProcess({ tenantRoot: cwd, scope: 'prod', override: true });
	assertCommandEnvironment({ tenantRoot: cwd, scope: 'prod', purpose: 'save' });

	const preflight = collectCliPreflight({ cwd, requireAuth: true });
	if (!preflight.ok) {
		const error = new Error('Treeseed save prerequisites failed: required GitHub, Cloudflare, or Railway tokens are missing.');
		error.kind = 'auth_failed';
		error.details = preflight;
		throw error;
	}

	const required = requiredGitHubEnvironment(cwd, { scope: 'prod', purpose: 'save' });
	const missingEnv = missingRequiredEnv([...required.secrets, ...required.variables]);
	if (missingEnv.length > 0) {
		const error = new Error(
			`Treeseed save is missing required environment variables: ${missingEnv.join(', ')}.`,
		);
		error.kind = 'missing_required_env';
		error.missingEnv = missingEnv;
		throw error;
	}

	return {
		ok: true,
		mode: 'real',
		missingEnv: [],
		preflight,
	};
}

export function runWorkspaceSavePreflight({ cwd }) {
	runStep('lint', 'treedx/workspaces/workspace-lint', { cwd });
	runStep('test', 'treedx/workspaces/workspace-release-test', { cwd });
	runStep('build', 'build/tenant-build', { cwd });
}

export function runWorkspaceReleasePreflight({ cwd }) {
	runStep('lint', 'treedx/workspaces/workspace-lint', { cwd });
	runStep('test', 'treedx/workspaces/workspace-release-test', { cwd });
	runStep('build', 'build/tenant-build', { cwd });
}

export function runTenantDeployPreflight({ cwd, scope = 'prod' }) {
	applyEnvironmentToProcess({ tenantRoot: cwd, scope, override: true });
	assertCommandEnvironment({ tenantRoot: cwd, scope, purpose: 'deploy' });
	runStep('lint', 'tenant/tenant-lint', { cwd });
	runStep('test', 'testing/tenant-test', { cwd });
	runStep('build', 'build/tenant-build', { cwd });
}
