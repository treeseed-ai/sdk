import { spawnSync } from 'node:child_process';
import { RemoteAuthClient,RemoteClient } from '../../../entrypoints/clients/remote.ts';
import {
collectToolStatus,
formatDependencyReport,
installDependencies,
} from '../../../entrypoints/runtime/managed-dependencies.ts';
import type {
OperationContext
} from '../../operations-types.ts';
import {
clearRemoteSession,
resolveRemoteConfig,
setRemoteSession
} from '../../services/configuration/config-runtime.ts';
import {
collectCliPreflight
} from '../../services/treedx/workspaces/workspace-preflight.ts';
import { resolveWorkflowState } from '../../workflow-state.ts';
import { BaseOperation,failureResult,operationEnv,operationResult } from './run-git.ts';

export class DoctorOperation extends BaseOperation {
	async execute(_input: Record<string, unknown>, context: OperationContext) {
		const state = resolveWorkflowState(context.cwd);
		const preflight = collectCliPreflight({ cwd: context.cwd, requireAuth: false });
		return operationResult(this.metadata, {
			state,
			preflight,
		}, {
			ok: preflight.ok,
			exitCode: preflight.ok ? 0 : 1,
		});
	}
}

export class InstallOperation extends BaseOperation<{ force?: boolean }> {
	async execute(input: { force?: boolean }, context: OperationContext) {
		const result = await installDependencies({
			tenantRoot: context.cwd,
			force: input.force === true,
			env: context.env,
			write: context.outputFormat === 'json' ? undefined : context.write,
		});
		const stdout = [formatDependencyReport(result)];
		return operationResult(this.metadata, result, {
			ok: result.ok,
			exitCode: result.ok ? 0 : 1,
			stdout,
			report: {
				ok: result.ok,
				toolsHome: result.toolsHome,
				ghConfigDir: result.ghConfigDir,
				npmInstalls: result.npmInstalls,
				tools: result.reports,
			},
		});
	}
}

export class ToolsOperation extends BaseOperation {
	async execute(_input: Record<string, unknown>, context: OperationContext) {
		const result = collectToolStatus({
			tenantRoot: context.cwd,
			env: operationEnv(context),
			spawn: context.spawn as typeof spawnSync | undefined,
		});
		const stdout = [
			'Treeseed managed tools',
			`Tools home: ${result.toolsHome}`,
			`GitHub CLI config: ${result.ghConfigDir}`,
			...result.tools.map((entry) => {
				const invocation = entry.invocation.command
					? `${entry.invocation.command}${entry.invocation.argsPrefix.length > 0 ? ` ${entry.invocation.argsPrefix.join(' ')}` : ''}`
					: '(unavailable)';
				return `- ${entry.name}: ${entry.status} (${entry.binaryPath ?? 'no binary'}; ${entry.invocation.mode}; ${invocation})`;
			}),
			`GitHub auth: ${result.auth.github.authenticated ? 'authenticated' : 'not authenticated'} - ${result.auth.github.detail}`,
		];
		return operationResult(this.metadata, result, {
			ok: true,
			exitCode: 0,
			stdout,
			report: {
				ok: true,
				dependenciesOk: result.ok,
				toolsHome: result.toolsHome,
				ghConfigDir: result.ghConfigDir,
				npmInstalls: result.npmInstalls,
				tools: result.tools,
				auth: result.auth,
			},
		});
	}
}

export class AuthLoginOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: OperationContext) {
		const tenantRoot = context.cwd;
		const remoteConfig = resolveRemoteConfig(tenantRoot, context.env);
		const hostId = typeof input.host === 'string' ? input.host : remoteConfig.activeHostId;
		const client = new RemoteAuthClient(new RemoteClient({
			...remoteConfig,
			activeHostId: hostId,
		}));
		const started = await client.startDeviceFlow({
			clientName: 'treeseed-sdk',
			scopes: ['auth:me', 'sdk', 'operations'],
		});
		const deadline = Date.parse(started.expiresAt);
		while (Date.now() < deadline) {
			const response = await client.pollDeviceFlow({ deviceCode: started.deviceCode });
			if (response.ok && response.status === 'approved') {
				setRemoteSession(tenantRoot, {
					hostId,
					accessToken: response.accessToken,
					refreshToken: response.refreshToken,
					expiresAt: response.expiresAt,
					principal: response.principal,
				});
				return operationResult(this.metadata, {
					hostId,
					verificationUriComplete: started.verificationUriComplete,
					userCode: started.userCode,
					principal: response.principal,
				});
			}
			if (!response.ok && response.status !== 'already_used') {
				return failureResult(this.metadata, response.error);
			}
			await new Promise((resolveTimer) => setTimeout(resolveTimer, started.intervalSeconds * 1000));
		}
		return failureResult(this.metadata, 'Treeseed API login expired before approval completed.');
	}
}

export class AuthLogoutOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: OperationContext) {
		const remoteConfig = resolveRemoteConfig(context.cwd, context.env);
		const hostId = typeof input.host === 'string' ? input.host : remoteConfig.activeHostId;
		clearRemoteSession(context.cwd, hostId);
		return operationResult(this.metadata, { hostId });
	}
}
