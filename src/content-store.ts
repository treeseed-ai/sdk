import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseFrontmatterDocument, serializeFrontmatterDocument } from './frontmatter.ts';
import { resolveModelDefinition } from './model-registry.ts';
import { applyFilters, applySort } from './sdk-filters.ts';
import type {
	SdkContentEntry,
	SdkFollowRequest,
	SdkGetRequest,
	SdkModelDefinition,
	SdkMutationRequest,
	SdkPickRequest,
	SdkPickResult,
	SdkSearchRequest,
	SdkUpdateRequest,
} from './sdk-types.ts';
import type { AgentDatabase } from './d1-store.ts';
import { GitRuntime } from './git-runtime.ts';

async function walkMarkdownFiles(root: string): Promise<string[]> {
	try {
		const entries = await readdir(root, { withFileTypes: true });
		const files = await Promise.all(
			entries.map(async (entry) => {
				const fullPath = path.join(root, entry.name);
				if (entry.isDirectory()) {
					return walkMarkdownFiles(fullPath);
				}
				if (entry.isFile() && /\.(md|mdx)$/i.test(entry.name)) {
					return [fullPath];
				}
				return [];
			}),
		);

		return files.flat();
	} catch {
		return [];
	}
}

async function findWorktreeRoots(root: string): Promise<string[]> {
	const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
	const names = new Set(entries.map((entry) => entry.name));
	const nested = await Promise.all(
		entries
			.filter((entry) => entry.isDirectory())
			.map((entry) => findWorktreeRoots(path.join(root, entry.name))),
	);

	return [
		...(names.has('.git') ? [root] : []),
		...nested.flat(),
	];
}

function inferSlug(filePath: string, root: string) {
	const relativePath = path.relative(root, filePath).replace(/\\/g, '/');
	return relativePath.replace(/\.(md|mdx)$/i, '');
}

async function readContentEntry(
	definition: SdkModelDefinition,
	filePath: string,
	contentDir: string,
): Promise<SdkContentEntry> {
	const source = await readFile(filePath, 'utf8');
	const parsed = parseFrontmatterDocument(source);
	const fileStats = await stat(filePath);
	const slug = inferSlug(filePath, contentDir);

	return {
		id: slug,
		slug,
		model: definition.name,
		title: typeof parsed.frontmatter.title === 'string' ? parsed.frontmatter.title : undefined,
		path: filePath,
		body: parsed.body,
		frontmatter: parsed.frontmatter,
		createdAt:
			typeof parsed.frontmatter.date === 'string'
				? String(parsed.frontmatter.date)
				: fileStats.birthtime.toISOString(),
		updatedAt:
			typeof parsed.frontmatter.updated === 'string'
				? String(parsed.frontmatter.updated)
				: fileStats.mtime.toISOString(),
	};
}

function entryMatchesIdentity(entry: SdkContentEntry, request: SdkGetRequest) {
	return [request.id, request.slug, request.key].filter(Boolean).includes(entry.id);
}

function ensureMutationAllowed(definition: SdkModelDefinition, operation: 'create' | 'update') {
	if (!definition.operations.includes(operation)) {
		throw new Error(`Model "${definition.name}" does not allow ${operation}.`);
	}
}

function sanitizeFrontmatterInput(data: Record<string, unknown>) {
	const next = { ...data };
	delete next.body;
	delete next.branchPrefix;
	return next;
}

export class ContentStore {
	private readonly gitRuntime: GitRuntime;

	constructor(
		private readonly repoRoot: string,
		private readonly database: AgentDatabase,
	) {
		this.gitRuntime = new GitRuntime(
			repoRoot,
			process.env.TREESEED_AGENT_DISABLE_GIT === 'true',
		);
	}

	async list(model: string) {
		const definition = resolveModelDefinition(model);
		if (definition.storage !== 'content' || !definition.contentDir) {
			throw new Error(`Model "${model}" is not content-backed.`);
		}

		const roots = [
			{
				contentDir: definition.contentDir,
			},
		];
		const worktreeRoot = path.join(this.repoRoot, '.agent-worktrees');
		const worktrees = await findWorktreeRoots(worktreeRoot);
		const relativeContentDir = path.relative(this.repoRoot, definition.contentDir);
		for (const worktree of worktrees) {
			roots.push({
				contentDir: path.join(worktree, relativeContentDir),
			});
		}

		const files = (
			await Promise.all(roots.map((root) => walkMarkdownFiles(root.contentDir)))
		).flat();
		const entries = await Promise.all(
			files.map(async (filePath) => {
				const matchingRoot = roots.find((root) => filePath.startsWith(root.contentDir));
				return readContentEntry(definition, filePath, matchingRoot?.contentDir ?? definition.contentDir!);
			}),
		);
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
		const items = await this.list(request.model);
		const filtered = applyFilters(items, request.filters);
		const sorted = applySort(filtered, request.sort);
		return sorted.slice(0, request.limit ?? sorted.length);
	}

	async follow(request: SdkFollowRequest) {
		const items = await this.search({
			model: request.model,
			filters: [
				...(request.filters ?? []),
				{
					field: 'updatedAt',
					op: 'updated_since',
					value: request.since,
				},
			],
		});
		return {
			items,
			since: request.since,
		};
	}

	async pick(request: SdkPickRequest): Promise<SdkPickResult<SdkContentEntry>> {
		const definition = resolveModelDefinition(request.model);
		const sorted = await this.search({
			model: request.model,
			filters: request.filters,
			sort: [{ field: definition.pickField, direction: 'desc' }],
			limit: 25,
		});

		for (const item of sorted) {
			const lease = await this.database.tryClaimContentLease({
				model: definition.name,
				itemKey: item.id,
				claimedBy: request.workerId,
				leaseSeconds: request.leaseSeconds,
			});

			if (lease) {
				return {
					item,
					leaseToken: lease,
				};
			}
		}

		return {
			item: null,
			leaseToken: null,
		};
	}

	async create(request: SdkMutationRequest) {
		const definition = resolveModelDefinition(request.model);
		ensureMutationAllowed(definition, 'create');
		if (!definition.contentDir) {
			throw new Error(`Model "${request.model}" is not content-backed.`);
		}

		const slug = String(request.data.slug ?? request.data.id ?? crypto.randomUUID());
		const extension = definition.name === 'knowledge' ? '.md' : '.mdx';
		const body = typeof request.data.body === 'string' ? request.data.body : '';
		const branchName = `${String(request.data.branchPrefix ?? 'agent')}/${definition.name}-${slug}`;
		const worktreePath = await this.gitRuntime.ensureWorktree(branchName);
		const contentDirInWorktree = path.join(worktreePath, path.relative(this.repoRoot, definition.contentDir));
		const relativePath = path.relative(this.repoRoot, path.join(definition.contentDir, `${slug}${extension}`));
		const filePath = path.join(worktreePath, relativePath);
		const frontmatter = {
			...sanitizeFrontmatterInput(request.data),
			slug,
			updated: new Date().toISOString(),
		};

		await mkdir(path.dirname(filePath), { recursive: true });
		await writeFile(filePath, serializeFrontmatterDocument(frontmatter, body), 'utf8');
		const git = await this.gitRuntime.commitFileChange(
			filePath,
			branchName,
			`agent(${definition.name}): create ${slug}`,
		);

		return {
			item: await readContentEntry(definition, filePath, contentDirInWorktree),
			git,
		};
	}

	async update(request: SdkUpdateRequest) {
		const definition = resolveModelDefinition(request.model);
		ensureMutationAllowed(definition, 'update');
		const existing = await this.get(request);
		if (!existing) {
			throw new Error(`No ${request.model} entry found for update.`);
		}

		const branchName = `${String(request.data.branchPrefix ?? 'agent')}/${definition.name}-${existing.slug}`;
		const worktreePath = await this.gitRuntime.ensureWorktree(branchName);
		const relativePath = path.relative(this.repoRoot, existing.path);
		const targetPath = path.join(worktreePath, relativePath);
		const nextFrontmatter = {
			...existing.frontmatter,
			...sanitizeFrontmatterInput(request.data),
			updated: new Date().toISOString(),
		};
		const nextBody = typeof request.data.body === 'string' ? request.data.body : existing.body;
		await mkdir(path.dirname(targetPath), { recursive: true });
		await writeFile(targetPath, serializeFrontmatterDocument(nextFrontmatter, nextBody), 'utf8');
		const git = await this.gitRuntime.commitFileChange(
			targetPath,
			branchName,
			`agent(${definition.name}): update ${existing.slug}`,
		);

		return {
			item: await readContentEntry(definition, targetPath, path.join(worktreePath, path.relative(this.repoRoot, definition.contentDir!))),
			git,
		};
	}
}
