import type { SdkContentEntry, SdkGetRequest, SdkModelRegistry, SdkSearchRequest } from '../sdk-types.ts';
import { TreeDbClient } from './client.ts';
import type { TreeDbRepositoryQueryRequest, TreeDbRepositoryQueryResult } from './types.ts';
import {
	entryFromTreeDbFile,
	mapFilters,
	mapSort,
	resolveContentDir,
} from './repository-adapter.ts';
import { resolveModelDefinition } from '../model-registry.ts';

export interface TreeDbQueryAdapterOptions {
	client: TreeDbClient;
	models: SdkModelRegistry;
	repoRoot?: string;
	contentPathMap?: Record<string, string>;
	defaultRef?: string;
}

export class TreeDbQueryAdapter {
	constructor(private readonly options: TreeDbQueryAdapterOptions) {}

	async readContent(request: SdkGetRequest): Promise<SdkContentEntry | null> {
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
				} catch {
					// Try the next candidate/extension. TreeDB 404s are normal for identity probing.
				}
			}
		}
		return null;
	}

	async search(request: SdkSearchRequest): Promise<SdkContentEntry[]> {
		return this.searchContent(request);
	}

	async searchContent(request: SdkSearchRequest): Promise<SdkContentEntry[]> {
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

	query(input: TreeDbRepositoryQueryRequest): Promise<TreeDbRepositoryQueryResult> {
		return this.options.client.queryRepository(input);
	}

	queryRepository(input: TreeDbRepositoryQueryRequest): Promise<TreeDbRepositoryQueryResult> {
		return this.query(input);
	}
}
