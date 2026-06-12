import { TreeDxClient, type TreeDxClientOptions } from './client.ts';
import { TreeDxFederatedClient } from './federated-client.ts';
import { TreeDxRegistryClient, type TreeDxRegistryClientOptions } from './registry-client.ts';

export interface AgentSdkTreeDxOptions {
	enabled: boolean;
	client?: TreeDxClient | TreeDxClientOptions;
	baseUrl?: string;
	token?: string;
	repoId?: string;
	contentPathMap?: Record<string, string>;
	registryRouting?: boolean;
	registryClient?: TreeDxRegistryClient | TreeDxRegistryClientOptions;
	federatedClient?: TreeDxFederatedClient;
	defaultRef?: string;
	defaultAuthor?: { name: string; email: string };
	branchPrefix?: string;
}

export interface AgentSdkTreeDxIntegration {
	client: TreeDxClient;
	repoId: string;
	registry?: TreeDxRegistryClient;
	federated?: TreeDxFederatedClient;
}

function optionsRepoId(options: AgentSdkTreeDxOptions) {
	if (options.repoId) {
		return options.repoId;
	}
	if (options.client && !(options.client instanceof TreeDxClient)) {
		return options.client.repoId;
	}
	return undefined;
}

function optionsToken(options: AgentSdkTreeDxOptions) {
	if (options.token) {
		return options.token;
	}
	if (options.client && !(options.client instanceof TreeDxClient)) {
		return options.client.token;
	}
	return undefined;
}

function optionsFetch(options: AgentSdkTreeDxOptions) {
	if (options.client && !(options.client instanceof TreeDxClient)) {
		return options.client.fetch;
	}
	return undefined;
}

function buildClient(options: AgentSdkTreeDxOptions) {
	if (options.client instanceof TreeDxClient) {
		return options.client;
	}
	if (options.client) {
		return new TreeDxClient(options.client);
	}
	if (!options.baseUrl) {
		throw new Error('AgentSdk TreeDX mode requires a client or baseUrl.');
	}
	return new TreeDxClient({
		baseUrl: options.baseUrl,
		token: options.token,
		repoId: options.repoId,
	});
}

export function resolveAgentTreeDxIntegration(options: AgentSdkTreeDxOptions): AgentSdkTreeDxIntegration {
	const client = buildClient(options);
	const repoId = optionsRepoId(options);
	if (!repoId) {
		throw new Error('AgentSdk TreeDX mode requires a repoId.');
	}
	if (!options.registryRouting && !options.registryClient && !options.federatedClient) {
		return { client, repoId };
	}

	const registry = options.registryClient instanceof TreeDxRegistryClient
		? options.registryClient
		: new TreeDxRegistryClient(options.registryClient ?? client);
	const federated = options.federatedClient ?? new TreeDxFederatedClient({
		registry,
		token: optionsToken(options),
		fetch: optionsFetch(options),
	});
	return { client, repoId, registry, federated };
}
