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


export interface TreeSeedTreeDxRepositoryHint {
	name?: string;
	owner?: string;
	remoteUrl?: string;
	defaultBranch?: string;
	purpose?: 'project_content' | 'site_code' | 'optional_project';
	metadata?: Record<string, unknown>;
}

export interface TreeSeedTreeDxContentPathRule {
	paths: string[];
	repositoryHints?: TreeSeedTreeDxRepositoryHint[];
}

export interface AgentSdkTreeDxOptions {
	enabled?: boolean;
	baseUrl?: string;
	token?: string;
	repoId?: string;
	ref?: string;
	workspaceId?: string;
	contentPathMap?: Record<string, string | TreeSeedTreeDxContentPathRule>;
	repositoryHints?: TreeSeedTreeDxRepositoryHint[];
	fetchImpl?: typeof fetch;
}

export interface AgentSdkContentRepositoryOptions {
	adapter?: 'treedx' | 'local';
	allowLocalFallback?: boolean;
}

export interface ResolvedTreeDxOptions {
	baseUrl: string;
	token?: string;
	repoId?: string;
	ref?: string;
	workspaceId?: string;
	contentPathMap?: Record<string, string | TreeSeedTreeDxContentPathRule>;
	repositoryHints: TreeSeedTreeDxRepositoryHint[];
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

export interface TreeDxRepositoryCandidate {
	repoId: string;
	ref?: string;
	path: string;
	repository: Record<string, unknown>;
}

export interface TreeDxPortfolioResolverOptions {
	client: TreeDxClient;
	repoId?: string;
	ref?: string;
	repositoryHints?: TreeSeedTreeDxRepositoryHint[];
}

export class TreeDxContentRepositoryConfigError extends Error {
	constructor(message = 'TreeDX content repository is required. Configure TREESEED_TREEDX_BASE_URL or TREESEED_TREEDX_URL for content model access.') {
		super(message);
		this.name = 'TreeDxContentRepositoryConfigError';
	}
}

export function compactObject<T extends Record<string, unknown>>(input: T): T {
	return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as T;
}

export function stringValue(value: unknown) {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function arrayFromPayload(value: unknown): unknown[] {
	if (Array.isArray(value)) return value;
	if (value && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		for (const key of ['items', 'repositories', 'repos', 'data']) {
			if (Array.isArray(record[key])) return record[key] as unknown[];
		}
	}
	return [];
}

export function repoIdFromRepository(repository: Record<string, unknown>) {
	return stringValue(repository.id)
		?? stringValue(repository.repoId)
		?? stringValue(repository.repo_id)
		?? stringValue(repository.name)
		?? stringValue(repository.slug);
}

export function repositoryMatchesHint(repository: Record<string, unknown>, hint: TreeSeedTreeDxRepositoryHint) {
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

export function normalizePathPattern(pattern: string) {
	return pattern.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function segment(value: string) {
	return encodeURIComponent(value);
}

export function isMarkdownPath(value: string) {
	return /\.(md|mdx)$/i.test(value);
}

export function isGraphNotReadyError(error: unknown) {
	return error instanceof TreeDxApiError && error.code === 'graph_not_ready';
}

export function inferSlug(filePath: string, pathPattern: string) {
	const normalizedPath = normalizePathPattern(filePath);
	const root = normalizePathPattern(pathPattern).replace(/\*\*.*$/u, '').replace(/\/?$/u, '/');
	const withoutRoot = normalizedPath.startsWith(root) ? normalizedPath.slice(root.length) : normalizedPath;
	return withoutRoot.replace(/\.(md|mdx)$/i, '');
}

export function pathMatchesPattern(filePath: string, pathPattern: string) {
	const normalizedPath = normalizePathPattern(filePath);
	const normalizedPattern = normalizePathPattern(pathPattern);
	const wildcardIndex = normalizedPattern.indexOf('**');
	const root = (wildcardIndex >= 0 ? normalizedPattern.slice(0, wildcardIndex) : normalizedPattern)
		.replace(/\/+$/u, '');
	if (!root) return true;
	return normalizedPath === root || normalizedPath.startsWith(`${root}/`);
}

export function normalizePathList(value: unknown): string[] {
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
		for (const key of ['paths', 'items', 'files', 'entries', 'results', 'data']) {
			const normalized = normalizePathList(record[key]);
			if (normalized.length > 0) return normalized;
		}
	}
	return [];
}

export function extractTextPayload(value: unknown) {
	if (typeof value === 'string') return value;
	if (value && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		for (const key of ['content', 'body', 'text', 'source', 'file', 'data']) {
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

export function entryMatchesIdentity(entry: SdkContentEntry, request: SdkGetRequest) {
	return [request.id, request.slug, request.key].filter(Boolean).includes(entry.id)
		|| [request.id, request.slug, request.key].filter(Boolean).includes(entry.slug);
}

export function sanitizeFrontmatterInput(data: Record<string, unknown>) {
	const next = { ...data };
	delete next.body;
	delete next.branchPrefix;
	return next;
}

export function ensureMutationAllowed(definition: SdkModelDefinition, operation: 'create' | 'update') {
	if (!definition.operations.includes(operation)) {
		throw new Error(`Model "${definition.name}" does not allow ${operation}.`);
	}
}

export function titleForEntry(definition: SdkModelDefinition, frontmatter: Record<string, unknown>) {
	const titleField = definition.fields.title ? readCanonicalFieldValue(definition, { frontmatter }, 'title') : undefined;
	const nameField = definition.fields.name ? readCanonicalFieldValue(definition, { frontmatter }, 'name') : undefined;
	return typeof titleField === 'string' ? String(titleField) : typeof nameField === 'string' ? String(nameField) : undefined;
}

export function dateForEntry(definition: SdkModelDefinition, frontmatter: Record<string, unknown>, field: 'created_at' | 'updated_at') {
	const value = definition.fields[field] ? readCanonicalFieldValue(definition, { frontmatter }, field) : undefined;
	return typeof value === 'string' ? String(value) : null;
}

export function relativeContentDir(repoRoot: string, definition: SdkModelDefinition) {
	if (!definition.contentDir) return undefined;
	return normalizePathPattern(path.relative(repoRoot, definition.contentDir));
}

export function makeDefaultPathRule(repoRoot: string, definition: SdkModelDefinition): TreeSeedTreeDxContentPathRule {
	const relative = relativeContentDir(repoRoot, definition) ?? `src/content/${definition.contentCollection ?? definition.name}`;
	return { paths: [`${relative.replace(/\/$/u, '')}/**`] };
}
