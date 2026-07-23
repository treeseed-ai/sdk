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
import { ContentBackend, GraphBackend, TreeDxRepositoryCandidate, TreeSeedTreeDxContentPathRule, compactObject, dateForEntry, ensureMutationAllowed, entryMatchesIdentity, extractTextPayload, inferSlug, isMarkdownPath, makeDefaultPathRule, normalizePathList, pathMatchesPattern, sanitizeFrontmatterInput, stringValue, titleForEntry } from './tree-seed-tree-dx-repository-hint.ts';
import { TreeDxPortfolioResolver, mutationPath, normalizePathRule } from './normalize-path-rule.ts';

export class TreeDxContentBackend implements ContentBackend {
	constructor(
		private readonly options: {
			client: TreeDxClient;
			repoRoot: string;
			models: SdkModelRegistry;
			resolver: TreeDxPortfolioResolver;
			directRepoId?: string;
			ref?: string;
			workspaceId?: string;
			contentPathMap?: Record<string, string | TreeSeedTreeDxContentPathRule>;
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

	private async readEntry(definition: SdkModelDefinition, candidate: TreeDxRepositoryCandidate, filePath: string) {
		const payload = await this.options.client.readRepositoryFiles(compactObject({
			repoId: candidate.repoId,
			ref: candidate.ref,
			path: filePath,
		}));
		const payloadRecord = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
		const payloadFile = payloadRecord.file && typeof payloadRecord.file === 'object' ? payloadRecord.file as Record<string, unknown> : {};
		const parsed = parseFrontmatterDocument(extractTextPayload(payloadFile) || extractTextPayload(payload));
		const resolvedPath = stringValue(payloadFile.path) ?? stringValue(payloadRecord.path) ?? filePath;
		const slug = inferSlug(resolvedPath, candidate.path);
		return {
			id: slug,
			slug,
			model: definition.name,
			title: titleForEntry(definition, parsed.frontmatter),
			path: resolvedPath,
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
			const listPayload = await this.options.client.listRepositoryPaths(compactObject({
				repoId: candidate.repoId,
				ref: candidate.ref,
				paths: [candidate.path],
			}));
			const paths = normalizePathList(listPayload)
				.filter((filePath) => pathMatchesPattern(filePath, candidate.path))
				.filter(isMarkdownPath);
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
		if (this.options.directRepoId) {
			const definition = this.definition(request.model);
			const rule = this.pathRule(definition);
			const identities = [request.id, request.slug, request.key].filter((value): value is string => Boolean(value));
			for (const identity of identities) {
				for (const basePath of rule.paths) {
					for (const extension of ['.md', '.mdx']) {
						try {
							return await this.readEntry(definition, {
								repoId: this.options.directRepoId,
								ref: this.options.ref,
								path: basePath,
								repository: { repoId: this.options.directRepoId },
							}, `${basePath.replace(/\/$/u, '')}/${identity}${extension}`);
						} catch {
							// Try the next identity/path/extension candidate.
						}
					}
				}
			}
			return null;
		}
		const entries = await this.list(request.model);
		return entries.find((entry) => entryMatchesIdentity(entry, request)) ?? null;
	}

	async search(request: SdkSearchRequest) {
		const definition = this.definition(request.model);
		if (this.options.directRepoId) {
			const items = await this.list(definition.name);
			const filtered = applyFilters(items, normalizeFilterFields(definition, request.filters), definition);
			const sorted = applySort(filtered, normalizeSortFields(definition, request.sort), definition);
			return sorted.slice(0, request.limit ?? sorted.length);
		}
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
			throw new Error(`No TreeDX repository candidate found for ${definition.name} content.`);
		}
		if (repositoryIds.size > 1) {
			throw new Error(`Ambiguous TreeDX repository candidates for ${definition.name} content. Configure repositoryHints or provide a workspaceId.`);
		}
		return mutationPath(definition, this.options.repoRoot, slug);
	}

	private requireWorkspaceId() {
		if (!this.options.workspaceId) {
			throw new Error('TreeDX content writes require treeDx.workspaceId in Phase 9.');
		}
		return this.options.workspaceId;
	}

	private async createDirectWorkspace() {
		if (!this.options.directRepoId) return null;
		const payload = await this.options.client.createWorkspace({
			repoId: this.options.directRepoId,
			mode: 'writable',
		});
		return stringValue(payload.workspaceId) ?? stringValue(payload.id) ?? null;
	}

	private async commitDirectWorkspace(workspaceId: string, filePath: string) {
		await this.options.client.commit({
			workspaceId,
			message: `Update ${filePath}`,
			author: { name: 'TreeSeed SDK', email: 'sdk@treeseed.local' },
		});
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
		const workspaceId = this.options.workspaceId ?? await this.createDirectWorkspace() ?? this.requireWorkspaceId();
		await this.options.client.writeFile({
			workspaceId,
			path: filePath,
			content: serializeFrontmatterDocument(frontmatter, body),
		});
		if (!this.options.workspaceId && this.options.directRepoId) {
			await this.commitDirectWorkspace(workspaceId, filePath);
			return {
				item: await this.readEntry(definition, {
					repoId: this.options.directRepoId,
					ref: this.options.ref,
					path: this.pathRule(definition).paths[0] ?? '',
					repository: { repoId: this.options.directRepoId },
				}, filePath),
				git: null,
			};
		}
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
		await this.options.client.patchFile({
			workspaceId,
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

export function cryptoRandomId() {
	return globalThis.crypto?.randomUUID?.() ?? `treedx-${Date.now()}`;
}

export class LocalGraphBackend implements GraphBackend {
	constructor(private readonly runtime: ContentGraphRuntime) {}
	refresh(request?: SdkGraphRefreshRequest) { return this.runtime.refresh(request); }
	queryGraph(request: SdkGraphQueryRequest) { return this.runtime.queryGraph(request); }
	buildContextPack(request: SdkContextPackRequest) { return this.runtime.buildContextPack(request); }
	parseGraphDsl(source: string) { return this.runtime.parseGraphDsl(source); }
}
