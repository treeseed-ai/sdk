import { TreeDbClient, type TreeDbClientOptions } from './client.ts';
import { TreeDbFederatedClient } from './federated-client.ts';
import { TreeDbRegistryClient, type TreeDbRegistryClientOptions } from './registry-client.ts';

export interface AgentSdkTreeDbOptions {
	enabled: boolean;
	client?: TreeDbClient | TreeDbClientOptions;
	baseUrl?: string;
	token?: string;
	repoId?: string;
	contentPathMap?: Record<string, string>;
	registryRouting?: boolean;
	registryClient?: TreeDbRegistryClient | TreeDbRegistryClientOptions;
	federatedClient?: TreeDbFederatedClient;
	defaultRef?: string;
	defaultAuthor?: { name: string; email: string };
	branchPrefix?: string;
}

export interface AgentSdkTreeDbIntegration {
	client: TreeDbClient;
	repoId: string;
	registry?: TreeDbRegistryClient;
	federated?: TreeDbFederatedClient;
}

function optionsRepoId(options: AgentSdkTreeDbOptions) {
	if (options.repoId) {
		return options.repoId;
	}
	if (options.client && !(options.client instanceof TreeDbClient)) {
		return options.client.repoId;
	}
	return undefined;
}

function optionsToken(options: AgentSdkTreeDbOptions) {
	if (options.token) {
		return options.token;
	}
	if (options.client && !(options.client instanceof TreeDbClient)) {
		return options.client.token;
	}
	return undefined;
}

function optionsFetch(options: AgentSdkTreeDbOptions) {
	if (options.client && !(options.client instanceof TreeDbClient)) {
		return options.client.fetch;
	}
	return undefined;
}

function buildClient(options: AgentSdkTreeDbOptions) {
	if (options.client instanceof TreeDbClient) {
		return options.client;
	}
	if (options.client) {
		return new TreeDbClient(options.client);
	}
	if (!options.baseUrl) {
		throw new Error('AgentSdk TreeDB mode requires a client or baseUrl.');
	}
	return new TreeDbClient({
		baseUrl: options.baseUrl,
		token: options.token,
		repoId: options.repoId,
	});
}

export function resolveAgentTreeDbIntegration(options: AgentSdkTreeDbOptions): AgentSdkTreeDbIntegration {
	const client = buildClient(options);
	const repoId = optionsRepoId(options);
	if (!repoId) {
		throw new Error('AgentSdk TreeDB mode requires a repoId.');
	}
	if (!options.registryRouting && !options.registryClient && !options.federatedClient) {
		return { client, repoId };
	}

	const registry = options.registryClient instanceof TreeDbRegistryClient
		? options.registryClient
		: new TreeDbRegistryClient(options.registryClient ?? client);
	const federated = options.federatedClient ?? new TreeDbFederatedClient({
		registry,
		token: optionsToken(options),
		fetch: optionsFetch(options),
	});
	return { client, repoId, registry, federated };
}
