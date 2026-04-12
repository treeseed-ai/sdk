import { loadTreeseedDeployConfig } from '../platform/deploy-config.ts';
import { createDefaultTreeseedOperationsProvider } from './providers/default.ts';
import { withProcessCwd } from '../operations/services/runtime-tools.ts';
import {
	findTreeseedOperation,
	TRESEED_OPERATION_SPECS,
} from '../operations-registry.ts';
import {
	TreeseedOperationError,
	type TreeseedOperationContext,
	type TreeseedOperationProvider,
	type TreeseedOperationRequest,
} from '../operations-types.ts';

function defaultContext(overrides: Partial<TreeseedOperationContext> = {}): TreeseedOperationContext {
	return {
		cwd: overrides.cwd ?? process.cwd(),
		env: overrides.env ?? process.env,
		write: overrides.write,
		spawn: overrides.spawn,
		outputFormat: overrides.outputFormat ?? 'human',
		prompt: overrides.prompt,
		confirm: overrides.confirm,
		transport: overrides.transport ?? 'sdk',
	};
}

function resolveBuiltinProvider(providerId: string): TreeseedOperationProvider {
	if (providerId === 'default') {
		return createDefaultTreeseedOperationsProvider();
	}
	throw new TreeseedOperationError('operations', 'provider_resolution_failed', `Unknown Treeseed operations provider "${providerId}".`);
}

export class TreeseedOperationsSdk {
	listOperations() {
		return [...TRESEED_OPERATION_SPECS];
	}

	findOperation(name: string | null | undefined) {
		return findTreeseedOperation(name);
	}

	resolveProvider(cwd = process.cwd()) {
		return withProcessCwd(cwd, () => {
			const deployConfig = loadTreeseedDeployConfig();
			const selectedProviderId = deployConfig.providers.operations ?? 'default';
			return resolveBuiltinProvider(selectedProviderId);
		});
	}

	async execute(
		request: TreeseedOperationRequest,
		contextOverrides: Partial<TreeseedOperationContext> = {},
	) {
		const context = defaultContext(contextOverrides);
		const provider = this.resolveProvider(context.cwd);
		const operation = provider.findOperation(request.operationName);
		if (!operation) {
			throw new TreeseedOperationError(
				request.operationName,
				'validation_failed',
				`Unknown Treeseed operation "${request.operationName}".`,
				{ exitCode: 1 },
			);
		}
		return operation.execute(request.input ?? {}, context);
	}
}
