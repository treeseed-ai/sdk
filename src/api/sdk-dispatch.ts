import type { RemoteSdkOperationRequest } from '../remote.ts';
import type { AgentSdk } from '../sdk.ts';
import { AgentSdk as AgentSdkClass } from '../sdk.ts';
import { executeSdkOperation, findSdkOperation, listSdkOperationNames } from '../sdk-dispatch.ts';
import type { ApiConfig } from './types.ts';

export {
	executeSdkOperation,
	findSdkOperation,
	listSdkOperationNames,
};

export function resolveSdkInstance(
	sharedSdk: AgentSdk | undefined,
	config: ApiConfig,
	request: RemoteSdkOperationRequest,
) {
	if (!request.repoRoot || request.repoRoot === config.repoRoot) {
		return sharedSdk ?? new AgentSdkClass({ repoRoot: config.repoRoot });
	}
	return new AgentSdkClass({ repoRoot: request.repoRoot });
}
