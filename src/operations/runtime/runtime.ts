import { loadDeployConfig } from '../../platform/hosting/deploy-config.ts';
import { createDefaultOperationsProvider } from '../providers/default.ts';
import { withProcessCwd } from '../services/agents/runtime-tools.ts';
import {
	findOperation,
	TRESEED_OPERATION_SPECS,
} from '../operations-registry.ts';
import {
	OperationError,
	type OperationContext,
	type OperationProvider,
	type OperationRequest,
} from '../operations-types.ts';

export function defaultContext(overrides: Partial<OperationContext> = {}): OperationContext {
	return {
		cwd: overrides.cwd ?? process.cwd(),
		env: overrides.env ?? process.env,
		write: overrides.write,
		onProgress: overrides.onProgress,
		spawn: overrides.spawn,
		outputFormat: overrides.outputFormat ?? 'human',
		prompt: overrides.prompt,
		confirm: overrides.confirm,
		transport: overrides.transport ?? 'sdk',
	};
}

export function resolveBuiltinProvider(providerId: string): OperationProvider {
	if (providerId === 'default') {
		return createDefaultOperationsProvider();
	}
	throw new OperationError('operations', 'provider_resolution_failed', `Unknown Treeseed operations provider "${providerId}".`);
}

export class OperationsSdk {
	listOperations() {
		return [...TRESEED_OPERATION_SPECS];
	}

	findOperation(name: string | null | undefined) {
		return findOperation(name);
	}

	resolveProvider(cwd = process.cwd()) {
		return withProcessCwd(cwd, () => {
			const deployConfig = loadDeployConfig();
			const selectedProviderId = deployConfig.providers.operations ?? 'default';
			return resolveBuiltinProvider(selectedProviderId);
		});
	}

	async execute(
		request: OperationRequest,
		contextOverrides: Partial<OperationContext> = {},
	) {
		const context = defaultContext(contextOverrides);
		const provider = this.resolveProvider(context.cwd);
		const operation = provider.findOperation(request.operationName);
		if (!operation) {
			throw new OperationError(
				request.operationName,
				'validation_failed',
				`Unknown Treeseed operation "${request.operationName}".`,
				{ exitCode: 1 },
			);
		}
		return operation.execute(request.input ?? {}, context);
	}
}
