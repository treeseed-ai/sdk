import crypto from 'node:crypto';
import path from 'node:path';
import { resolveModelDefinition } from '../model-registry.ts';
import { serializeFrontmatterDocument } from '../frontmatter.ts';
import {
	canonicalizeFrontmatter,
	normalizeFilterFields,
	normalizeMutationData,
	normalizeRecordToCanonicalShape,
	normalizeSortFields,
	readCanonicalFieldValue,
} from '../sdk-fields.ts';
import type {
	SdkContentEntry,
	SdkFilterCondition,
	SdkFollowRequest,
	SdkGetRequest,
	SdkModelDefinition,
	SdkModelRegistry,
	SdkMutationRequest,
	SdkPickRequest,
	SdkPickResult,
	SdkSearchRequest,
	SdkSortSpec,
	SdkUpdateRequest,
} from '../sdk-types.ts';
import { TreeDbClient } from './client.ts';
import { TreeDbApiError } from './errors.ts';
import type { TreeDbCommitResult, TreeDbRepositoryQueryResult } from './types.ts';

export interface TreeDbRepositoryAdapterOptions {
	client: TreeDbClient;
	models: SdkModelRegistry;
	repoRoot?: string;
	defaultRef?: string;
	defaultAuthor?: { name: string; email: string };
	contentPathMap?: Record<string, string>;
	branchPrefix?: string;
}

export interface TreeDbContentMutationResult {
	item: SdkContentEntry;
	git: TreeDbCommitResult;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeRepoPath(value: string) {
	return value.replace(/\\/g, '/').replace(/^\/+/u, '').replace(/\/+$/u, '');
}

function stripExtension(value: string) {
	return value.replace(/\.(md|mdx)$/iu, '');
}

function sanitizeFrontmatterInput(data: Record<string, unknown>) {
	const next = { ...data };
	delete next.body;
	delete next.branchPrefix;
	return next;
}

function ensureContentModel(definition: SdkModelDefinition) {
	if (definition.storage !== 'content' || !definition.contentDir) {
		throw new TreeDbApiError(`Model "${definition.name}" is not content-backed.`, {
			status: 400,
			code: 'model_not_content_backed',
		});
	}
}

function ensureMutationAllowed(definition: SdkModelDefinition, operation: 'create' | 'update') {
	if (!definition.operations.includes(operation)) {
		throw new TreeDbApiError(`Model "${definition.name}" does not allow ${operation}.`, {
			status: 403,
			code: 'operation_not_allowed',
		});
	}
}

export function resolveContentDir(
	definition: SdkModelDefinition,
	options: Pick<TreeDbRepositoryAdapterOptions, 'contentPathMap' | 'repoRoot'>,
) {
	ensureContentModel(definition);
	const mapped = options.contentPathMap?.[definition.name];
	if (mapped) {
		return normalizeRepoPath(mapped);
	}
	const contentDir = definition.contentDir!;
	if (!path.isAbsolute(contentDir)) {
		return normalizeRepoPath(contentDir);
	}
	if (options.repoRoot) {
		return normalizeRepoPath(path.relative(options.repoRoot, contentDir));
	}
	const marker = `${path.sep}src${path.sep}content${path.sep}`;
	const index = contentDir.lastIndexOf(marker);
	if (index >= 0) {
		return normalizeRepoPath(path.join('src', 'content', contentDir.slice(index + marker.length)));
	}
	throw new TreeDbApiError(`Model "${definition.name}" needs a TreeDB content path mapping.`, {
		status: 400,
		code: 'missing_content_path_mapping',
	});
}

function treeDbField(field: string) {
	if (['path', 'name', 'extension', 'body', 'content', 'title'].includes(field)) {
		return field;
	}
	return `frontmatter.${field}`;
}

export function mapFilters(definition: SdkModelDefinition, filters: SdkFilterCondition[] = []) {
	return normalizeFilterFields(definition, filters).map((filter) => ({
		...filter,
		field: treeDbField(filter.field),
	}));
}

export function mapSort(definition: SdkModelDefinition, sort: SdkSortSpec[] = []) {
	return normalizeSortFields(definition, sort).map((entry) => ({
		...entry,
		field: treeDbField(entry.field),
	}));
}

function titleFrom(definition: SdkModelDefinition, frontmatter: Record<string, unknown>) {
	const titleField = definition.fields.title
		? readCanonicalFieldValue(definition, { frontmatter }, 'title')
		: undefined;
	const nameField = definition.fields.name
		? readCanonicalFieldValue(definition, { frontmatter }, 'name')
		: undefined;
	return typeof titleField === 'string'
		? titleField
		: typeof nameField === 'string'
			? nameField
			: undefined;
}

export function entryFromTreeDbFile(
	definition: SdkModelDefinition,
	value: unknown,
	contentDir: string,
): SdkContentEntry {
	const file = isRecord(value) && isRecord(value.file) ? value.file : value;
	if (!isRecord(file)) {
		throw new TreeDbApiError('TreeDB file response was not an object.', {
			status: 500,
			code: 'invalid_response',
			payload: value,
		});
	}
	const filePath = String(file.path ?? '');
	const frontmatter = isRecord(file.frontmatter) ? file.frontmatter : {};
	const body = typeof file.body === 'string'
		? file.body
		: typeof file.content === 'string'
			? file.content
			: '';
	const slug = stripExtension(normalizeRepoPath(path.posix.relative(contentDir, filePath)));
	const created = frontmatter.created_at ?? frontmatter.createdAt ?? null;
	const updated = frontmatter.updated_at ?? frontmatter.updatedAt ?? null;
	return {
		id: slug,
		slug,
		model: definition.name,
		title: titleFrom(definition, frontmatter),
		path: filePath,
		body,
		frontmatter,
		createdAt: typeof created === 'string' ? created : null,
		updatedAt: typeof updated === 'string' ? updated : null,
	};
}

function pickSortForStrategy(definition: SdkModelDefinition, request: SdkPickRequest) {
	switch (request.strategy) {
		case 'oldest':
			return [{ field: definition.pickField, direction: 'asc' as const }];
		case 'highest_priority':
			if (definition.sortableFields.includes('priority') || definition.filterableFields.includes('priority')) {
				return [
					{ field: 'priority', direction: 'desc' as const },
					{ field: definition.pickField, direction: 'desc' as const },
				];
			}
			return [{ field: definition.pickField, direction: 'desc' as const }];
		case 'latest':
		default:
			return [{ field: definition.pickField, direction: 'desc' as const }];
	}
}

export class TreeDbRepositoryAdapter {
	constructor(private readonly options: TreeDbRepositoryAdapterOptions) {}

	async list(model: string): Promise<SdkContentEntry[]> {
		const definition = resolveModelDefinition(model, this.options.models);
		const contentDir = resolveContentDir(definition, this.options);
		const paths = await this.options.client.listRepositoryPaths({
			ref: this.options.defaultRef,
			paths: [`${contentDir}/**`],
			extensions: ['.md', '.mdx'],
			limit: 500,
		});
		const filePaths = (paths.entries ?? [])
			.filter(isRecord)
			.map((entry) => String(entry.path ?? ''))
			.filter(Boolean);
		if (filePaths.length === 0) {
			return [];
		}
		const files = await this.options.client.readRepositoryFiles({
			ref: this.options.defaultRef,
			paths: filePaths,
			parseFrontmatter: true,
		});
		return (files.files ?? []).map((file) => entryFromTreeDbFile(definition, file, contentDir));
	}

	async get(request: SdkGetRequest): Promise<SdkContentEntry | null> {
		const definition = resolveModelDefinition(request.model, this.options.models);
		const contentDir = resolveContentDir(definition, this.options);
		const candidates = [request.id, request.slug, request.key].filter((value): value is string => Boolean(value));
		for (const candidate of candidates) {
			for (const extension of ['.mdx', '.md']) {
				try {
					const response = await this.options.client.readRepositoryFile({
						ref: this.options.defaultRef,
						path: `${contentDir}/${candidate}${extension}`,
						parseFrontmatter: true,
					});
					if (response.file) {
						return entryFromTreeDbFile(definition, response.file, contentDir);
					}
				} catch (error) {
					if (!(error instanceof TreeDbApiError) || error.status !== 404) {
						throw error;
					}
				}
			}
		}
		return null;
	}

	async search(request: SdkSearchRequest): Promise<SdkContentEntry[]> {
		const definition = resolveModelDefinition(request.model, this.options.models);
		const contentDir = resolveContentDir(definition, this.options);
		const response = await this.options.client.searchRepositoryFiles({
			ref: this.options.defaultRef,
			paths: [`${contentDir}/**`],
			query: '',
			filters: mapFilters(definition, request.filters),
			sort: mapSort(definition, request.sort),
			limit: request.limit,
			includeBody: true,
			includeFrontmatter: true,
		});
		const results = response.results ?? response.files ?? [];
		return results.map((file) => entryFromTreeDbFile(definition, file, contentDir));
	}

	async follow(request: SdkFollowRequest) {
		const items = await this.search({
			model: request.model,
			filters: [
				...(request.filters ?? []),
				{ field: 'updated_at', op: 'updated_since', value: request.since },
			],
		});
		return { items, since: request.since };
	}

	async pick(request: SdkPickRequest): Promise<SdkPickResult<SdkContentEntry>> {
		throw new TreeDbApiError('TreeDB remote content leases are not implemented by the TreeDB remote graph adapter.', {
			status: 501,
			code: 'not_implemented',
			details: { strategy: request.strategy ?? 'latest', sort: pickSortForStrategy(resolveModelDefinition(request.model, this.options.models), request) },
		});
	}

	async create(request: SdkMutationRequest): Promise<TreeDbContentMutationResult> {
		const definition = resolveModelDefinition(request.model, this.options.models);
		ensureMutationAllowed(definition, 'create');
		const contentDir = resolveContentDir(definition, this.options);
		const slug = String(request.data.slug ?? request.data.id ?? crypto.randomUUID());
		const extension = definition.name === 'knowledge' ? '.md' : '.mdx';
		const filePath = `${contentDir}/${slug}${extension}`;
		const mutationData = normalizeMutationData(definition, sanitizeFrontmatterInput(request.data));
		const body = typeof request.data.body === 'string' ? request.data.body : '';
		const frontmatter = canonicalizeFrontmatter(definition, {}, {
			...mutationData,
			slug,
			updated_at: mutationData.updated_at ?? new Date().toISOString(),
		});
		return this.writeAndCommit(definition, contentDir, filePath, serializeFrontmatterDocument(frontmatter, body), {
			branchName: `refs/heads/${String(request.data.branchPrefix ?? this.options.branchPrefix ?? 'agent')}/${definition.name}-${slug}`,
			message: `agent(${definition.name}): create ${slug}`,
		});
	}

	async update(request: SdkUpdateRequest): Promise<TreeDbContentMutationResult> {
		const definition = resolveModelDefinition(request.model, this.options.models);
		ensureMutationAllowed(definition, 'update');
		const contentDir = resolveContentDir(definition, this.options);
		const existing = await this.get(request);
		if (!existing) {
			throw new TreeDbApiError(`No ${request.model} entry found for update.`, {
				status: 404,
				code: 'not_found',
			});
		}
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
		return this.writeAndCommit(definition, contentDir, existing.path, serializeFrontmatterDocument(nextFrontmatter, nextBody), {
			branchName: `refs/heads/${String(request.data.branchPrefix ?? this.options.branchPrefix ?? 'agent')}/${definition.name}-${existing.slug}`,
			message: `agent(${definition.name}): update ${existing.slug}`,
			expectedSha: request.expectedVersion,
		});
	}

	private async writeAndCommit(
		definition: SdkModelDefinition,
		contentDir: string,
		filePath: string,
		content: string,
		options: { branchName: string; message: string; expectedSha?: string },
	): Promise<TreeDbContentMutationResult> {
		const workspace = await this.options.client.createWorkspace({
			baseRef: this.options.defaultRef ?? 'refs/heads/main',
			branchName: options.branchName,
			mode: 'writable',
			allowedPaths: [`${contentDir}/**`],
		});
		try {
			await this.options.client.writeFile({
				workspaceId: workspace.workspaceId,
				path: filePath,
				encoding: 'utf8',
				content,
				expectedSha: options.expectedSha,
			});
			const git = await this.options.client.commit({
				workspaceId: workspace.workspaceId,
				message: options.message,
				author: this.options.defaultAuthor ?? {
					name: 'TreeDB SDK',
					email: 'sdk@example.invalid',
				},
			});
			const response = await this.options.client.readRepositoryFile({
				ref: git.branchName,
				path: filePath,
				parseFrontmatter: true,
			});
			return {
				item: entryFromTreeDbFile(definition, response.file, contentDir),
				git,
			};
		} catch (error) {
			await this.options.client.closeWorkspace(workspace.workspaceId).catch(() => {});
			throw error;
		}
	}

}
