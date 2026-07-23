import path from 'node:path';
import { TreeDxClient } from '../treedx/client.ts';
import { TreeDxApiError } from '../treedx/errors.ts';
import type { TreeDxClientOptions } from '../treedx/types.ts';
import { ContentStore } from '../content-store.ts';
import { parseFrontmatterDocument, serializeFrontmatterDocument } from '../frontmatter.ts';
import { ContentGraphRuntime } from '../graph.ts';
import { resolveModelDefinition } from '../model-registry.ts';
import { applyFilters, applySort } from '../sdk-filters.ts';
import {
	canonicalizeFrontmatter,
	normalizeFilterFields,
	normalizeMutationData,
	normalizeRecordToCanonicalShape,
	normalizeSortFields,
	readCanonicalFieldValue,
} from '../sdk-fields.ts';
import { assertExpectedVersion } from '../sdk-version.ts';
import type {
	SdkContentEntry,
	SdkContextPackRequest,
	SdkFollowRequest,
	SdkGetRequest,
	SdkGraphDslParseResult,
	SdkGraphQueryRequest,
	SdkGraphRefreshRequest,
	SdkModelDefinition,
	SdkModelRegistry,
	SdkMutationRequest,
	SdkPickRequest,
	SdkPickResult,
	SdkSearchRequest,
	SdkUpdateRequest,
} from '../sdk-types.ts';
import { ExecBackend, GraphBackend, compactObject, isGraphNotReadyError, repoIdFromRepository } from './tree-seed-tree-dx-repository-hint.ts';
import { TreeDxPortfolioResolver } from './normalize-path-rule.ts';

export class TreeDxGraphBackend implements GraphBackend {
	constructor(
		private readonly options: {
			client: TreeDxClient;
			resolver: TreeDxPortfolioResolver;
			localRuntime: ContentGraphRuntime;
			directRepoId?: string;
			ref?: string;
		},
	) {}

	async refresh(request?: SdkGraphRefreshRequest) {
		const candidates = await this.options.resolver.resolveCandidates({
			paths: request?.paths?.length ? request.paths : ['**'],
		});
		return Promise.all(candidates.map((candidate) =>
			this.options.client.refreshGraph(compactObject({
				repoId: candidate.repoId,
				ref: candidate.ref ?? this.options.ref,
				paths: request?.paths,
			})),
		));
	}

	private async repoIds() {
		const repositories = await this.options.resolver.listRepositories();
		return repositories.flatMap((repository) => {
			const repoId = repoIdFromRepository(repository);
			return repoId ? [repoId] : [];
		});
	}

	async queryGraph(request: SdkGraphQueryRequest) {
		if (this.options.directRepoId) {
			return this.options.client.queryGraph(compactObject({
				repoId: this.options.directRepoId,
					...request,
					ref: this.options.ref,
				}));
		}
		return this.options.client.federatedGraph({
			...request,
			repoIds: await this.repoIds(),
			ref: this.options.ref,
		});
	}

	async buildContextPack(request: SdkContextPackRequest) {
		if (this.options.directRepoId) {
			const build = () =>
				this.options.client.buildContext(compactObject({
					repoId: this.options.directRepoId,
						...request,
						ref: this.options.ref,
					}));
			try {
				return await build();
			} catch (error) {
				if (!isGraphNotReadyError(error)) throw error;
				await this.options.client.refreshGraph(compactObject({
					repoId: this.options.directRepoId,
					ref: this.options.ref,
					paths: ['**'],
				}));
				return await build();
			}
		}
		return this.options.client.federatedContext({
			...request,
			repoIds: await this.repoIds(),
			ref: this.options.ref,
		});
	}

	parseGraphDsl(source: string) {
		return this.options.localRuntime.parseGraphDsl(source);
	}
}

export class LocalExecBackend implements ExecBackend {
	async run(input: unknown) {
		return input;
	}
}

export class TreeDxExecBackend implements ExecBackend {
	constructor(
		private readonly client: TreeDxClient,
		private readonly workspaceId?: string,
	) {}

	run(input: unknown) {
		if (!this.workspaceId) {
			throw new Error('TreeDX exec requires treeDx.workspaceId.');
		}
		const request = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
		return this.client.exec({
			workspaceId: this.workspaceId,
			cmd: String(request.cmd ?? request.command ?? ''),
			...(request.mode ? { mode: request.mode as 'read_only' | 'verification' | 'write_limited' } : {}),
		});
	}
}

export { TreeDxApiError };
