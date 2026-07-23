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
import { AgentSdkTreeDxOptions, ContentBackend, ResolvedTreeDxOptions, TreeDxContentRepositoryConfigError, TreeDxPortfolioResolverOptions, TreeDxRepositoryCandidate, TreeSeedTreeDxContentPathRule, arrayFromPayload, compactObject, normalizePathPattern, relativeContentDir, repoIdFromRepository, repositoryMatchesHint, stringValue } from './tree-seed-tree-dx-repository-hint.ts';

export function normalizePathRule(input: string | TreeSeedTreeDxContentPathRule | undefined, fallback: TreeSeedTreeDxContentPathRule) {
	if (!input) return fallback;
	if (typeof input === 'string') return { paths: [input] };
	return input;
}

export function mutationPath(definition: SdkModelDefinition, repoRoot: string, slug: string) {
	const relative = relativeContentDir(repoRoot, definition) ?? `src/content/${definition.contentCollection ?? definition.name}`;
	const extension = definition.name === 'knowledge' ? '.md' : '.mdx';
	return `${relative.replace(/\/$/u, '')}/${slug}${extension}`;
}

export function resolveTreeDxOptions(input?: AgentSdkTreeDxOptions): ResolvedTreeDxOptions | null {
	const baseUrl = stringValue(input?.baseUrl)
		?? stringValue(process.env.TREESEED_TREEDX_BASE_URL)
		?? stringValue(process.env.TREESEED_TREEDX_URL);
	if (!baseUrl) return null;
	return {
		baseUrl,
		token: stringValue(input?.token) ?? stringValue(process.env.TREESEED_TREEDX_TOKEN),
		repoId: stringValue(input?.repoId) ?? stringValue(process.env.TREESEED_TREEDX_REPO_ID),
		ref: stringValue(input?.ref) ?? stringValue(process.env.TREESEED_TREEDX_REF),
		workspaceId: stringValue(input?.workspaceId) ?? stringValue(process.env.TREESEED_TREEDX_WORKSPACE_ID),
		contentPathMap: input?.contentPathMap,
		repositoryHints: input?.repositoryHints ?? [],
		fetchImpl: input?.fetchImpl,
	};
}

export function createTreeDxClientFromAgentOptions(options: ResolvedTreeDxOptions) {
	const config: TreeDxClientOptions = compactObject({
		baseUrl: options.baseUrl,
		token: options.token,
		fetch: options.fetchImpl,
	}) as TreeDxClientOptions;
	return new TreeDxClient(config);
}

export class TreeDxPortfolioResolver {
	private repositoryCache: Promise<Record<string, unknown>[]> | null = null;
	private candidateCache = new Map<string, Promise<TreeDxRepositoryCandidate[]>>();

	constructor(private readonly options: TreeDxPortfolioResolverOptions) {}

	async listRepositories() {
		this.repositoryCache ??= this.options.client.listRepositories().then((response) =>
			arrayFromPayload(response)
				.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object' && !Array.isArray(entry))),
		);
		return this.repositoryCache;
	}

	async resolveCandidates(rule: TreeSeedTreeDxContentPathRule) {
		if (this.options.repoId) {
			return rule.paths.map((path) => ({
				repoId: this.options.repoId!,
				ref: this.options.ref,
				path,
				repository: { repoId: this.options.repoId },
			}));
		}
		const cacheKey = JSON.stringify({
			paths: rule.paths,
			hints: [...(this.options.repositoryHints ?? []), ...(rule.repositoryHints ?? [])],
			ref: this.options.ref,
		});
		const cached = this.candidateCache.get(cacheKey);
		if (cached) return cached;
		const promise = this.resolveCandidatesUncached(rule);
		this.candidateCache.set(cacheKey, promise);
		return promise;
	}

	private async resolveCandidatesUncached(rule: TreeSeedTreeDxContentPathRule) {
		const repositories = await this.listRepositories();
		const hints = [...(this.options.repositoryHints ?? []), ...(rule.repositoryHints ?? [])]
			.filter((hint) => hint.purpose !== 'site_code' && hint.purpose !== 'optional_project');
		const matching = hints.length > 0
			? repositories.filter((repository) => hints.some((hint) => repositoryMatchesHint(repository, hint)))
			: repositories.filter((repository) => {
				const metadata = repository.metadata && typeof repository.metadata === 'object'
					? repository.metadata as Record<string, unknown>
					: {};
				return repository.purpose !== 'site_code'
					&& repository.purpose !== 'optional_project'
					&& metadata.purpose !== 'site_code'
					&& metadata.purpose !== 'optional_project';
			});
		return matching.flatMap((repository) => {
			const repoId = repoIdFromRepository(repository);
			if (!repoId) return [];
			return rule.paths.map((rulePath) => ({
				repoId,
				ref: this.options.ref,
				path: normalizePathPattern(rulePath),
				repository,
			}));
		});
	}
}

export class LocalContentBackend implements ContentBackend {
	constructor(private readonly store: ContentStore) {}

	list(model: string) { return this.store.list(model); }
	get(request: SdkGetRequest) { return this.store.get(request); }
	search(request: SdkSearchRequest) { return this.store.search(request); }
	follow(request: SdkFollowRequest) { return this.store.follow(request); }
	pick(request: SdkPickRequest) { return this.store.pick(request); }
	create(request: SdkMutationRequest) { return this.store.create(request); }
	update(request: SdkUpdateRequest) { return this.store.update(request); }
}

export class MissingTreeDxContentBackend implements ContentBackend {
	private fail(): never {
		throw new TreeDxContentRepositoryConfigError();
	}

	list(): Promise<SdkContentEntry[]> { this.fail(); }
	get(): Promise<SdkContentEntry | null> { this.fail(); }
	search(): Promise<SdkContentEntry[]> { this.fail(); }
	follow(): Promise<{ items: SdkContentEntry[]; since: string }> { this.fail(); }
	pick(): Promise<SdkPickResult<SdkContentEntry>> { this.fail(); }
	create(): Promise<unknown> { this.fail(); }
	update(): Promise<unknown> { this.fail(); }
}
