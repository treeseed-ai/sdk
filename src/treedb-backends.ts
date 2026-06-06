import path from 'node:path';
import { TreeDbApiError, TreeDbClient, type TreeDbClientConfig } from './treedb-client.ts';
import { ContentStore } from './content-store.ts';
import { parseFrontmatterDocument, serializeFrontmatterDocument } from './frontmatter.ts';
import { ContentGraphRuntime } from './graph.ts';
import { resolveModelDefinition } from './model-registry.ts';
import { applyFilters, applySort } from './sdk-filters.ts';
import {
	canonicalizeFrontmatter,
	normalizeFilterFields,
	normalizeMutationData,
	normalizeRecordToCanonicalShape,
	normalizeSortFields,
	readCanonicalFieldValue,
} from './sdk-fields.ts';
import { assertExpectedVersion } from './sdk-version.ts';
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
} from './sdk-types.ts';

export interface TreeSeedTreeDbRepositoryHint {
	name?: string;
	owner?: string;
	remoteUrl?: string;
	defaultBranch?: string;
	purpose?: 'project_content' | 'site_code' | 'optional_project';
	metadata?: Record<string, unknown>;
}

export interface TreeSeedTreeDbContentPathRule {
	paths: string[];
	repositoryHints?: TreeSeedTreeDbRepositoryHint[];
}

export interface AgentSdkTreeDbOptions {
	baseUrl?: string;
	token?: string;
	ref?: string;
	workspaceId?: string;
	contentPathMap?: Record<string, string | TreeSeedTreeDbContentPathRule>;
	repositoryHints?: TreeSeedTreeDbRepositoryHint[];
	fetchImpl?: typeof fetch;
}

export interface AgentSdkContentRepositoryOptions {
	adapter?: 'treedb' | 'local';
}

export interface ResolvedTreeDbOptions {
	baseUrl: string;
	token?: string;
	ref?: string;
	workspaceId?: string;
	contentPathMap?: Record<string, string | TreeSeedTreeDbContentPathRule>;
	repositoryHints: TreeSeedTreeDbRepositoryHint[];
	fetchImpl?: typeof fetch;
}

export interface ContentBackend {
	list(model: string): Promise<SdkContentEntry[]>;
	get(request: SdkGetRequest): Promise<SdkContentEntry | null>;
	search(request: SdkSearchRequest): Promise<SdkContentEntry[]>;
	follow(request: SdkFollowRequest): Promise<{ items: SdkContentEntry[]; since: string }>;
	pick(request: SdkPickRequest): Promise<SdkPickResult<SdkContentEntry>>;
	create(request: SdkMutationRequest): Promise<unknown>;
	update(request: SdkUpdateRequest): Promise<unknown>;
}

export interface GraphBackend {
	refresh(request?: SdkGraphRefreshRequest): Promise<unknown>;
	queryGraph(request: SdkGraphQueryRequest): Promise<unknown>;
	buildContextPack(request: SdkContextPackRequest): Promise<unknown>;
	parseGraphDsl(source: string): Promise<SdkGraphDslParseResult>;
}

export interface ExecBackend {
	run(input: unknown): Promise<unknown>;
}

export interface TreeDbRepositoryCandidate {
	repoId: string;
	ref?: string;
	path: string;
	repository: Record<string, unknown>;
}

export interface TreeDbPortfolioResolverOptions {
	client: TreeDbClient;
	ref?: string;
	repositoryHints?: TreeSeedTreeDbRepositoryHint[];
}

export class TreeDbContentRepositoryConfigError extends Error {
	constructor(message = 'TreeDB content repository is not configured. Set TREESEED_TREEDB_BASE_URL or pass treeDb.baseUrl, or select contentRepository.adapter = "local".') {
		super(message);
		this.name = 'TreeDbContentRepositoryConfigError';
	}
}

function compactObject<T extends Record<string, unknown>>(input: T): T {
	return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as T;
}

function stringValue(value: unknown) {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function arrayFromPayload(value: unknown): unknown[] {
	if (Array.isArray(value)) return value;
	if (value && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		for (const key of ['items', 'repositories', 'repos', 'data']) {
			if (Array.isArray(record[key])) return record[key] as unknown[];
		}
	}
	return [];
}

function repoIdFromRepository(repository: Record<string, unknown>) {
	return stringValue(repository.id)
		?? stringValue(repository.repoId)
		?? stringValue(repository.repo_id)
		?? stringValue(repository.name)
		?? stringValue(repository.slug);
}

function repositoryMatchesHint(repository: Record<string, unknown>, hint: TreeSeedTreeDbRepositoryHint) {
	const name = stringValue(repository.name) ?? stringValue(repository.slug);
	const owner = stringValue(repository.owner) ?? stringValue((repository.metadata as Record<string, unknown> | undefined)?.owner);
	const remoteUrl =
		stringValue(repository.remoteUrl)
		?? stringValue(repository.remote_url)
		?? stringValue(repository.cloneUrl)
		?? stringValue(repository.clone_url)
		?? stringValue(repository.url);
	const defaultBranch =
		stringValue(repository.defaultBranch)
		?? stringValue(repository.default_branch)
		?? stringValue(repository.branch);
	const metadata = repository.metadata && typeof repository.metadata === 'object'
		? repository.metadata as Record<string, unknown>
		: {};
	if (hint.purpose && metadata.purpose !== hint.purpose && repository.purpose !== hint.purpose) return false;
	if (hint.name && name !== hint.name) return false;
	if (hint.owner && owner !== hint.owner) return false;
	if (hint.remoteUrl && remoteUrl !== hint.remoteUrl) return false;
	if (hint.defaultBranch && defaultBranch !== hint.defaultBranch) return false;
	return true;
}

function normalizePathPattern(pattern: string) {
	return pattern.replace(/\\/g, '/').replace(/^\.\//, '');
}

function isMarkdownPath(value: string) {
	return /\.(md|mdx)$/i.test(value);
}

function inferSlug(filePath: string, pathPattern: string) {
	const normalizedPath = normalizePathPattern(filePath);
	const root = normalizePathPattern(pathPattern).replace(/\*\*.*$/u, '').replace(/\/?$/u, '/');
	const withoutRoot = normalizedPath.startsWith(root) ? normalizedPath.slice(root.length) : normalizedPath;
	return withoutRoot.replace(/\.(md|mdx)$/i, '');
}

function normalizePathList(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.flatMap((entry) => {
			if (typeof entry === 'string') return [entry];
			if (entry && typeof entry === 'object') {
				const record = entry as Record<string, unknown>;
				const candidate = stringValue(record.path) ?? stringValue(record.file) ?? stringValue(record.key);
				return candidate ? [candidate] : [];
			}
			return [];
		});
	}
	if (value && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		for (const key of ['paths', 'items', 'files', 'results', 'data']) {
			const normalized = normalizePathList(record[key]);
			if (normalized.length > 0) return normalized;
		}
	}
	return [];
}

function extractTextPayload(value: unknown) {
	if (typeof value === 'string') return value;
	if (value && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		for (const key of ['content', 'body', 'text', 'source', 'data']) {
			const candidate = record[key];
			if (typeof candidate === 'string') return candidate;
			if (candidate && typeof candidate === 'object') {
				const nested = extractTextPayload(candidate);
				if (nested) return nested;
			}
		}
	}
	return '';
}

function entryMatchesIdentity(entry: SdkContentEntry, request: SdkGetRequest) {
	return [request.id, request.slug, request.key].filter(Boolean).includes(entry.id)
		|| [request.id, request.slug, request.key].filter(Boolean).includes(entry.slug);
}

function sanitizeFrontmatterInput(data: Record<string, unknown>) {
	const next = { ...data };
	delete next.body;
	delete next.branchPrefix;
	return next;
}

function ensureMutationAllowed(definition: SdkModelDefinition, operation: 'create' | 'update') {
	if (!definition.operations.includes(operation)) {
		throw new Error(`Model "${definition.name}" does not allow ${operation}.`);
	}
}

function titleForEntry(definition: SdkModelDefinition, frontmatter: Record<string, unknown>) {
	const titleField = definition.fields.title ? readCanonicalFieldValue(definition, { frontmatter }, 'title') : undefined;
	const nameField = definition.fields.name ? readCanonicalFieldValue(definition, { frontmatter }, 'name') : undefined;
	return typeof titleField === 'string' ? String(titleField) : typeof nameField === 'string' ? String(nameField) : undefined;
}

function dateForEntry(definition: SdkModelDefinition, frontmatter: Record<string, unknown>, field: 'created_at' | 'updated_at') {
	const value = definition.fields[field] ? readCanonicalFieldValue(definition, { frontmatter }, field) : undefined;
	return typeof value === 'string' ? String(value) : null;
}

function relativeContentDir(repoRoot: string, definition: SdkModelDefinition) {
	if (!definition.contentDir) return undefined;
	return normalizePathPattern(path.relative(repoRoot, definition.contentDir));
}

function makeDefaultPathRule(repoRoot: string, definition: SdkModelDefinition): TreeSeedTreeDbContentPathRule {
	const relative = relativeContentDir(repoRoot, definition) ?? `src/content/${definition.contentCollection ?? definition.name}`;
	return { paths: [`${relative.replace(/\/$/u, '')}/**`] };
}

function normalizePathRule(input: string | TreeSeedTreeDbContentPathRule | undefined, fallback: TreeSeedTreeDbContentPathRule) {
	if (!input) return fallback;
	if (typeof input === 'string') return { paths: [input] };
	return input;
}

function mutationPath(definition: SdkModelDefinition, repoRoot: string, slug: string) {
	const relative = relativeContentDir(repoRoot, definition) ?? `src/content/${definition.contentCollection ?? definition.name}`;
	const extension = definition.name === 'knowledge' ? '.md' : '.mdx';
	return `${relative.replace(/\/$/u, '')}/${slug}${extension}`;
}

export function resolveTreeDbOptions(input?: AgentSdkTreeDbOptions): ResolvedTreeDbOptions | null {
	const baseUrl = stringValue(input?.baseUrl) ?? stringValue(process.env.TREESEED_TREEDB_BASE_URL);
	if (!baseUrl) return null;
	return {
		baseUrl,
		token: stringValue(input?.token) ?? stringValue(process.env.TREESEED_TREEDB_TOKEN),
		ref: stringValue(input?.ref) ?? stringValue(process.env.TREESEED_TREEDB_REF),
		workspaceId: stringValue(input?.workspaceId) ?? stringValue(process.env.TREESEED_TREEDB_WORKSPACE_ID),
		contentPathMap: input?.contentPathMap,
		repositoryHints: input?.repositoryHints ?? [],
		fetchImpl: input?.fetchImpl,
	};
}

export function createTreeDbClientFromAgentOptions(options: ResolvedTreeDbOptions) {
	const config: TreeDbClientConfig = compactObject({
		baseUrl: options.baseUrl,
		token: options.token,
		fetchImpl: options.fetchImpl,
	}) as TreeDbClientConfig;
	return new TreeDbClient(config);
}

export class TreeDbPortfolioResolver {
	private repositoryCache: Promise<Record<string, unknown>[]> | null = null;
	private candidateCache = new Map<string, Promise<TreeDbRepositoryCandidate[]>>();

	constructor(private readonly options: TreeDbPortfolioResolverOptions) {}

	async listRepositories() {
		this.repositoryCache ??= this.options.client.repositories.list().then((response) =>
			arrayFromPayload(response)
				.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object' && !Array.isArray(entry))),
		);
		return this.repositoryCache;
	}

	async resolveCandidates(rule: TreeSeedTreeDbContentPathRule) {
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

	private async resolveCandidatesUncached(rule: TreeSeedTreeDbContentPathRule) {
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

export class MissingTreeDbContentBackend implements ContentBackend {
	private fail(): never {
		throw new TreeDbContentRepositoryConfigError();
	}

	list(): Promise<SdkContentEntry[]> { this.fail(); }
	get(): Promise<SdkContentEntry | null> { this.fail(); }
	search(): Promise<SdkContentEntry[]> { this.fail(); }
	follow(): Promise<{ items: SdkContentEntry[]; since: string }> { this.fail(); }
	pick(): Promise<SdkPickResult<SdkContentEntry>> { this.fail(); }
	create(): Promise<unknown> { this.fail(); }
	update(): Promise<unknown> { this.fail(); }
}

export class TreeDbContentBackend implements ContentBackend {
	constructor(
		private readonly options: {
			client: TreeDbClient;
			repoRoot: string;
			models: SdkModelRegistry;
			resolver: TreeDbPortfolioResolver;
			ref?: string;
			workspaceId?: string;
			contentPathMap?: Record<string, string | TreeSeedTreeDbContentPathRule>;
			localLeaseStore: ContentStore;
		},
	) {}

	private definition(model: string) {
		const definition = resolveModelDefinition(model, this.options.models);
		if (definition.storage !== 'content') {
			throw new Error(`Model "${model}" is not content-backed.`);
		}
		return definition;
	}

	private pathRule(definition: SdkModelDefinition) {
		const configured = this.options.contentPathMap?.[definition.name];
		return normalizePathRule(configured, makeDefaultPathRule(this.options.repoRoot, definition));
	}

	private async readEntry(definition: SdkModelDefinition, candidate: TreeDbRepositoryCandidate, filePath: string) {
		const payload = await this.options.client.query.readFile(candidate.repoId, compactObject({
			ref: candidate.ref,
			path: filePath,
		}));
		const parsed = parseFrontmatterDocument(extractTextPayload(payload));
		const slug = inferSlug(filePath, candidate.path);
		return {
			id: slug,
			slug,
			model: definition.name,
			title: titleForEntry(definition, parsed.frontmatter),
			path: filePath,
			body: parsed.body,
			frontmatter: parsed.frontmatter,
			createdAt: dateForEntry(definition, parsed.frontmatter, 'created_at'),
			updatedAt: dateForEntry(definition, parsed.frontmatter, 'updated_at'),
		} satisfies SdkContentEntry;
	}

	async list(model: string) {
		const definition = this.definition(model);
		const rule = this.pathRule(definition);
		const candidates = await this.options.resolver.resolveCandidates(rule);
		const entries = (await Promise.all(candidates.map(async (candidate) => {
			const listPayload = await this.options.client.query.listPaths(candidate.repoId, compactObject({
				ref: candidate.ref,
				path: candidate.path,
			}));
			const paths = normalizePathList(listPayload).filter(isMarkdownPath);
			return await Promise.all(paths.map((filePath) => this.readEntry(definition, candidate, filePath)));
		}))).flat();
		const deduped = new Map<string, SdkContentEntry>();
		for (const entry of entries) {
			const existing = deduped.get(entry.id);
			if (!existing || new Date(entry.updatedAt ?? 0).valueOf() >= new Date(existing.updatedAt ?? 0).valueOf()) {
				deduped.set(entry.id, entry);
			}
		}
		return [...deduped.values()];
	}

	async get(request: SdkGetRequest) {
		const entries = await this.list(request.model);
		return entries.find((entry) => entryMatchesIdentity(entry, request)) ?? null;
	}

	async search(request: SdkSearchRequest) {
		const definition = this.definition(request.model);
		const items = await this.list(definition.name);
		const filtered = applyFilters(items, normalizeFilterFields(definition, request.filters), definition);
		const sorted = applySort(filtered, normalizeSortFields(definition, request.sort), definition);
		return sorted.slice(0, request.limit ?? sorted.length);
	}

	async follow(request: SdkFollowRequest) {
		const items = await this.search({
			model: request.model,
			filters: [
				...(request.filters ?? []),
				{ field: 'updatedAt', op: 'updated_since', value: request.since },
			],
		});
		return { items, since: request.since };
	}

	pick(request: SdkPickRequest) {
		return this.options.localLeaseStore.pick(request);
	}

	private async resolveWritePath(definition: SdkModelDefinition, slug: string) {
		if (this.options.workspaceId) return mutationPath(definition, this.options.repoRoot, slug);
		const candidates = await this.options.resolver.resolveCandidates(this.pathRule(definition));
		const repositoryIds = new Set(candidates.map((candidate) => candidate.repoId));
		if (repositoryIds.size === 0) {
			throw new Error(`No TreeDB repository candidate found for ${definition.name} content.`);
		}
		if (repositoryIds.size > 1) {
			throw new Error(`Ambiguous TreeDB repository candidates for ${definition.name} content. Configure repositoryHints or provide a workspaceId.`);
		}
		return mutationPath(definition, this.options.repoRoot, slug);
	}

	private requireWorkspaceId() {
		if (!this.options.workspaceId) {
			throw new Error('TreeDB content writes require treeDb.workspaceId in Phase 9.');
		}
		return this.options.workspaceId;
	}

	async create(request: SdkMutationRequest) {
		const definition = this.definition(request.model);
		ensureMutationAllowed(definition, 'create');
		const slug = String(request.data.slug ?? request.data.id ?? cryptoRandomId());
		const body = typeof request.data.body === 'string' ? request.data.body : '';
		const mutationData = normalizeMutationData(definition, sanitizeFrontmatterInput(request.data));
		const frontmatter = canonicalizeFrontmatter(definition, {}, {
			...mutationData,
			slug,
			updated_at: mutationData.updated_at ?? new Date().toISOString(),
		});
		const filePath = await this.resolveWritePath(definition, slug);
		const workspaceId = this.requireWorkspaceId();
		await this.options.client.files.write(workspaceId, {
			path: filePath,
			content: serializeFrontmatterDocument(frontmatter, body),
		});
		return {
			item: {
				id: slug,
				slug,
				model: definition.name,
				title: titleForEntry(definition, frontmatter),
				path: filePath,
				body,
				frontmatter,
				createdAt: dateForEntry(definition, frontmatter, 'created_at'),
				updatedAt: dateForEntry(definition, frontmatter, 'updated_at'),
			} satisfies SdkContentEntry,
			git: null,
		};
	}

	async update(request: SdkUpdateRequest) {
		const definition = this.definition(request.model);
		ensureMutationAllowed(definition, 'update');
		const workspaceId = this.requireWorkspaceId();
		const existing = await this.get(request);
		if (!existing) {
			throw new Error(`No ${request.model} entry found for update.`);
		}
		assertExpectedVersion(request.expectedVersion, existing, `${definition.name} "${existing.slug}"`);
		const mutationData = normalizeMutationData(definition, sanitizeFrontmatterInput(request.data));
		const nextFrontmatter = canonicalizeFrontmatter(
			definition,
			normalizeRecordToCanonicalShape(definition, existing.frontmatter),
			{
				...mutationData,
				updated_at: mutationData.updated_at ?? new Date().toISOString(),
			},
		);
		const nextBody = typeof request.data.body === 'string' ? request.data.body : existing.body;
		await this.options.client.files.patch(workspaceId, {
			path: existing.path,
			content: serializeFrontmatterDocument(nextFrontmatter, nextBody),
		});
		return {
			item: {
				...existing,
				title: titleForEntry(definition, nextFrontmatter),
				body: nextBody,
				frontmatter: nextFrontmatter,
				updatedAt: dateForEntry(definition, nextFrontmatter, 'updated_at'),
			} satisfies SdkContentEntry,
			git: null,
		};
	}
}

function cryptoRandomId() {
	return globalThis.crypto?.randomUUID?.() ?? `treedb-${Date.now()}`;
}

export class LocalGraphBackend implements GraphBackend {
	constructor(private readonly runtime: ContentGraphRuntime) {}
	refresh(request?: SdkGraphRefreshRequest) { return this.runtime.refresh(request); }
	queryGraph(request: SdkGraphQueryRequest) { return this.runtime.queryGraph(request); }
	buildContextPack(request: SdkContextPackRequest) { return this.runtime.buildContextPack(request); }
	parseGraphDsl(source: string) { return this.runtime.parseGraphDsl(source); }
}

export class TreeDbGraphBackend implements GraphBackend {
	constructor(
		private readonly options: {
			client: TreeDbClient;
			resolver: TreeDbPortfolioResolver;
			localRuntime: ContentGraphRuntime;
			ref?: string;
		},
	) {}

	async refresh(request?: SdkGraphRefreshRequest) {
		const candidates = await this.options.resolver.resolveCandidates({
			paths: request?.paths?.length ? request.paths : ['**'],
		});
		return Promise.all(candidates.map((candidate) =>
			this.options.client.graph.refresh(candidate.repoId, compactObject({
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
		return this.options.client.federation.graphQuery({
			...request,
			repoIds: await this.repoIds(),
			ref: this.options.ref,
		});
	}

	async buildContextPack(request: SdkContextPackRequest) {
		return this.options.client.federation.contextBuild({
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

export class TreeDbExecBackend implements ExecBackend {
	constructor(
		private readonly client: TreeDbClient,
		private readonly workspaceId?: string,
	) {}

	run(input: unknown) {
		if (!this.workspaceId) {
			throw new Error('TreeDB exec requires treeDb.workspaceId.');
		}
		return this.client.exec.run(this.workspaceId, input);
	}
}

export { TreeDbApiError };
