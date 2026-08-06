import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { observeCapacityProviderRuntimeStatus } from "../../../../capacity-provider/runtime-status.ts";
import { collectLocalTreeDxSeedFiles } from "../../../../platform/treedx/repositories/local-treedx-seed.ts";
import { mintTreeDxHs256Token } from "../../../../treedx/accounts/auth.ts";
import { TreeDxClient } from "../../../../treedx/support/client.ts";
import { checkHttpHealth } from "../../../providers/local-private.ts";
import type { ReconcileAdapter,UnitVerificationResult } from "../../../support/contracts/contracts.ts";
import { verificationCheck } from '../../hosting/first-railway-domain-string.ts';
import { genericObservedState,genericResult,noopDiff } from '../../hosting/to-deploy-target.ts';
import { summarizeVerification } from '../../support/summarize-verification.ts';

export function buildCapacityProviderAdapter(providerId: 'local' | 'railway'): ReconcileAdapter {
	return {
		providerId,
		unitTypes: ['capacity-provider'],
		supports(unitType, candidateProviderId) {
			return unitType === 'capacity-provider' && candidateProviderId === providerId;
		},
		refresh(input) {
			const dependencies = input.unit.dependencies;
			return {
				...genericObservedState(input),
				live: {
					...input.unit.spec,
					dependencies,
				},
			};
		},
		diff() {
			return noopDiff();
		},
		apply(input) {
			return genericResult(input);
		},
		async verify(input) {
			const dependencyResults = input.context.session.get('treeseed:verification-results') as Map<string, UnitVerificationResult> | undefined;
			const checks = input.unit.dependencies.map((dependency) => {
				const verification = dependencyResults?.get(dependency);
				const ok = verification ? verification.verified === true : true;
				return verificationCheck(`dependency:${dependency}`, `Capacity provider dependency ${dependency} is verified`, 'derived', {
					exists: ok,
					configured: ok,
					ready: ok,
					verified: ok,
					observed: verification ?? null,
					issues: ok ? [] : [`Dependency ${dependency} is not verified.`],
				});
			});
			const healthEndpoint = typeof input.unit.spec.healthEndpoint === 'string' ? input.unit.spec.healthEndpoint : null;
			if (healthEndpoint) {
				const health = await checkHttpHealth(healthEndpoint);
				checks.push(verificationCheck('capacity-provider-health', `Capacity provider health endpoint ${healthEndpoint} responds`, 'api', {
					exists: health.ok,
					configured: true,
					ready: health.ok,
					verified: health.ok,
					observed: health,
					issues: health.ok ? [] : [`Capacity provider health endpoint ${healthEndpoint} did not respond successfully.`],
				}));
			}
			const runtimeStatus = input.unit.spec.runtimeStatus && typeof input.unit.spec.runtimeStatus === 'object'
				? input.unit.spec.runtimeStatus as Record<string, unknown>
				: null;
			if (runtimeStatus && typeof runtimeStatus.path === 'string') {
				const expectedConnectionCount = typeof input.unit.spec.expectedConnectionCount === 'number'
					? Math.max(0, Math.floor(input.unit.spec.expectedConnectionCount))
					: 1;
				const requireConnected = expectedConnectionCount > 0;
				const maxAgeSeconds = typeof runtimeStatus.maxAgeSeconds === 'number' && Number.isFinite(runtimeStatus.maxAgeSeconds)
					? Math.max(1, runtimeStatus.maxAgeSeconds)
					: 180;
				const attempts = typeof runtimeStatus.attempts === 'number' && Number.isFinite(runtimeStatus.attempts)
					? Math.max(1, Math.floor(runtimeStatus.attempts))
					: 60;
				const intervalMs = typeof runtimeStatus.intervalMs === 'number' && Number.isFinite(runtimeStatus.intervalMs)
					? Math.max(100, Math.floor(runtimeStatus.intervalMs))
					: 500;
				const statusPath = resolve(input.context.tenantRoot, runtimeStatus.path);
				let observedStatus = observeCapacityProviderRuntimeStatus(statusPath, maxAgeSeconds, new Date(), requireConnected);
				const runtimeReady = () => observedStatus.valid && observedStatus.fresh && (!requireConnected || observedStatus.connected);
				for (let attempt = 1; attempt < attempts && !runtimeReady(); attempt += 1) {
					await new Promise((resolveWait) => setTimeout(resolveWait, intervalMs));
					observedStatus = observeCapacityProviderRuntimeStatus(statusPath, maxAgeSeconds, new Date(), requireConnected);
				}
				const ready = runtimeReady();
				checks.push(verificationCheck('capacity-provider-runtime-status', requireConnected
					? 'Provider manager has a fresh approved connection and published availability session'
					: 'Provider manager is fresh and ready for provider connections', 'sdk', {
					exists: observedStatus.exists,
					configured: true,
					ready,
					verified: ready,
					observed: observedStatus,
					issues: observedStatus.issues,
				}));
			}
			if (checks.length === 0) {
				checks.push(verificationCheck('capacity-provider', 'Capacity provider desired topology is observable', 'derived', {
					exists: input.observed.exists,
					configured: input.observed.exists,
					ready: input.observed.status !== 'error',
					verified: input.observed.exists && input.observed.status !== 'error',
					observed: input.observed.live,
				}));
			}
			return summarizeVerification(input.unit.unitId, checks, input.observed.warnings);
		},
		destroy(input) {
			return genericResult({
				...input,
				diff: { action: 'delete', reasons: ['selected capacity provider for destroy'], before: input.observed.live, after: {} },
			});
		},
	};
}

export interface LocalTreeDxContentProject {
	projectKey?: string;
	slug: string;
	repositoryName: string;
	repositoryId: string;
	localRoot: string;
	contentPath: string;
	defaultRef?: string;
	seedPaths?: string[];
	seedDigest?: string;
}

export function recordValue(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function nonEmptyString(value: unknown) {
	return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function localTreeDxProjects(value: unknown): LocalTreeDxContentProject[] {
	return Array.isArray(value)
		? value.flatMap((entry) => {
			const record = recordValue(entry);
			const slug = nonEmptyString(record.slug);
			const repositoryName = nonEmptyString(record.repositoryName);
			const repositoryId = nonEmptyString(record.repositoryId) || repositoryName;
			const localRoot = nonEmptyString(record.localRoot);
			const contentPath = nonEmptyString(record.contentPath);
			if (!slug || !repositoryName || !repositoryId || !localRoot || !contentPath) return [];
			return [{
				projectKey: nonEmptyString(record.projectKey) || undefined,
				slug,
				repositoryName,
				repositoryId,
				localRoot,
				contentPath,
				defaultRef: nonEmptyString(record.defaultRef) || 'refs/heads/main',
				seedPaths: Array.isArray(record.seedPaths) ? record.seedPaths.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [],
				seedDigest: nonEmptyString(record.seedDigest) || undefined,
			}];
		})
		: [];
}

export function mintLocalTreeDxJwt(auth: Record<string, unknown>) {
	const secret = nonEmptyString(auth.TREESEED_TREEDX_JWT_HS256_SECRET);
	const issuer = nonEmptyString(auth.TREESEED_TREEDX_JWT_ISSUER);
	const audience = nonEmptyString(auth.TREESEED_TREEDX_JWT_AUDIENCE);
	if (!secret || !issuer || !audience) return '';
	const actorId = nonEmptyString(auth.TREESEED_TREEDX_PROXY_ACTOR_ID) || 'treeseed-sdk-reconciler';
	const tenantId = nonEmptyString(auth.TREESEED_TREEDX_PROXY_TENANT_ID) || 'treeseed-control-plane';
	return mintTreeDxHs256Token({ secret, issuer, audience, actorId, tenantId, repoIds: ['*'], capabilities: ['*'], refs: ['*'], paths: ['**'], ttlSeconds: 3600 });
}

export async function ensureLocalTreeDxProjectRepository(client: TreeDxClient, project: LocalTreeDxContentProject) {
	const repositories = await client.listRepositories();
	const existing = repositories.find((entry) => recordValue(entry).repositoryName === project.repositoryName || recordValue(entry).name === project.repositoryName);
	const existingRepoId = nonEmptyString(recordValue(existing).repoId);
	if (existingRepoId) return { repoId: existingRepoId, created: false };
	const registered = recordValue(await client.registerRepository({
		name: project.repositoryName,
		repositoryName: project.repositoryName,
		createIfMissing: true,
		defaultRef: project.defaultRef ?? 'refs/heads/main',
	}));
	const repoId = nonEmptyString(registered.repoId);
	if (!repoId) throw new Error(`TreeDX did not return a repository id for ${project.repositoryName}.`);
	return { repoId, created: true };
}

function projectIndexPaths(project: LocalTreeDxContentProject) {
	return project.seedPaths?.length
		? project.seedPaths.map((seedPath) => /\.[a-z0-9]+$/iu.test(seedPath) ? seedPath : `${seedPath.replace(/\/+$/u, '')}/**`)
		: [`${project.contentPath.replace(/\/+$/u, '')}/**`];
}

function localTreeDxSeedOperation(project: LocalTreeDxContentProject, files: ReturnType<typeof collectLocalTreeDxSeedFiles>) {
	const digest = project.seedDigest || createHash('sha256')
		.update(files.map((file) => `${file.path}\0${file.content}\0`).join(''))
		.digest('hex');
	return {
		workspaceId: `ws_seed_${digest.slice(0, 32)}`,
		branchName: `refs/heads/treeseed-seed-${digest.slice(0, 24)}`,
	};
}

export async function refreshLocalTreeDxProjectIndexes(client: TreeDxClient, project: LocalTreeDxContentProject,
	repositoryId: string, commitSha: string) {
	const ref = project.defaultRef ?? 'refs/heads/main';
	const paths = projectIndexPaths(project);
	const requested = await client.refreshGraph({ repoId: repositoryId, ref, paths, forceFull: true });
	let graph: Record<string, unknown> = recordValue(requested);
	if (requested.jobId) {
		for (let attempt = 0; attempt < 120; attempt += 1) {
			const job = await client.getGraphRefreshJob({ repoId: repositoryId, ref, jobId: requested.jobId });
			if (job.status === 'completed') { graph = { ...graph, ...recordValue(job) }; break; }
			if (job.status === 'failed') throw new Error(`TreeDX graph refresh failed for ${project.slug}: ${job.errorCode ?? 'unknown error'}.`);
			await new Promise((resolveWait) => setTimeout(resolveWait, 250));
		}
		if (graph.status !== 'completed') throw new Error(`TreeDX graph refresh timed out for ${project.slug}.`);
	}
	const search = await client.refreshSearchIndex({ repoId: repositoryId, ref, paths });
	const resolved = nonEmptyString(search.resolvedRef) || nonEmptyString(search.sourceCommit);
	if (search.stale || (commitSha && resolved !== commitSha)) {
		throw new Error(`TreeDX search index did not resolve the reconciled commit for ${project.slug}.`);
	}
	return { graphRefresh: graph, searchIndex: search };
}

async function localTreeDxSeedDelta(client: TreeDxClient, project: LocalTreeDxContentProject, repositoryId: string,
	desiredFiles: ReturnType<typeof collectLocalTreeDxSeedFiles>, requestedRef?: string) {
	const ref = requestedRef ?? project.defaultRef ?? 'refs/heads/main';
	const entries: unknown[] = []; let cursor: string | null = null; let resolvedRef = '';
	for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
		const page = await client.listRepositoryPaths({ repoId: repositoryId, ref, paths: projectIndexPaths(project),
			extensions: ['.json', '.md', '.mdx', '.toml', '.yaml', '.yml'], limit: 500, ...(cursor ? { cursor } : {}) });
		entries.push(...(page.entries ?? [])); resolvedRef ||= nonEmptyString(page.resolvedRef);
		if (!page.page?.hasMore) break;
		const next = nonEmptyString(page.page.nextCursor);
		if (!next || next === cursor) throw new Error(`TreeDX path pagination stalled while reconciling ${project.slug}.`);
		cursor = next;
		if (pageNumber === 99) throw new Error(`TreeDX seed reconciliation for ${project.slug} exceeds the bounded 50,000-file snapshot.`);
	}
	const currentPaths = entries.flatMap((entry) => {
		const path = nonEmptyString(recordValue(entry).path);
		return path ? [path] : [];
	});
	const files: unknown[] = [];
	for (let offset = 0; offset < currentPaths.length; offset += 200) {
		const current = await client.readRepositoryFiles({ repoId: repositoryId, ref: resolvedRef || ref, paths: currentPaths.slice(offset, offset + 200), encoding: 'utf8', parseFrontmatter: false });
		files.push(...(current.files ?? [])); resolvedRef ||= nonEmptyString(current.resolvedRef);
	}
	const observed = files.map(treeDxSeedFileRecord);
	const observedByPath = new Map(observed.map((file) => [file.path, file.content]));
	const desiredByPath = new Map(desiredFiles.map((file) => [file.path, file.content]));
	return {
		changed: desiredFiles.filter((file) => observedByPath.get(file.path) !== file.content),
		removed: currentPaths.filter((path) => !desiredByPath.has(path)),
		resolvedRef,
	};
}

async function resumeCommittedLocalTreeDxSeed(client: TreeDxClient, project: LocalTreeDxContentProject,
	repositoryId: string, files: ReturnType<typeof collectLocalTreeDxSeedFiles>, operation: ReturnType<typeof localTreeDxSeedOperation>,
	expectedDestinationHead: string) {
	const refs = await client.listRepositoryRefs(repositoryId);
	const source = refs.find((ref) => ref.name === operation.branchName);
	const sourceHead = nonEmptyString(source?.target) || nonEmptyString(source?.sha);
	if (!sourceHead) return null;
	const sourceDelta = await localTreeDxSeedDelta(client, project, repositoryId, files, operation.branchName);
	if (sourceDelta.changed.length > 0 || sourceDelta.removed.length > 0) return null;
	const destinationRef = project.defaultRef ?? 'refs/heads/main';
	const destination = refs.find((ref) => ref.name === destinationRef);
	const destinationHead = nonEmptyString(destination?.target) || nonEmptyString(destination?.sha);
	if (destinationHead !== sourceHead) {
		if (destinationHead !== expectedDestinationHead) {
			throw new Error(`TreeDX publication ref changed while resuming seed reconciliation for ${project.slug}.`);
		}
		await client.promoteRef({
			repoId: repositoryId, sourceRef: operation.branchName, destinationRef,
			expectedDestinationHead,
		});
	}
	const indexes = await refreshLocalTreeDxProjectIndexes(client, project, repositoryId, sourceHead);
	await client.retireRef({
		repoId: repositoryId, ref: operation.branchName, mergedIntoRef: destinationRef,
		expectedHead: sourceHead, expectedMergedIntoHead: sourceHead,
	});
	await client.closeWorkspace(operation.workspaceId).catch(() => null);
	return { commitSha: sourceHead, ...indexes };
}

async function applyLocalTreeDxSeedDelta(client: TreeDxClient, workspaceId: string,
	delta: Awaited<ReturnType<typeof localTreeDxSeedDelta>>) {
	if (delta.changed.length > 0) {
		await client.writeFiles({
			workspaceId,
			files: delta.changed.map((file) => ({ path: file.path, content: file.content, encoding: 'utf8' })),
		});
	}
	for (const path of delta.removed) await client.deleteFile({ workspaceId, path });
}

export async function syncLocalTreeDxProjectContent(client: TreeDxClient, project: LocalTreeDxContentProject) {
	const files = collectLocalTreeDxSeedFiles(project);
	const repository = await ensureLocalTreeDxProjectRepository(client, project);
	if (files.length === 0) {
		return { project: project.slug, repositoryId: repository.repoId, repositoryName: project.repositoryName, files: 0, committed: false };
	}
	const delta = await localTreeDxSeedDelta(client, project, repository.repoId, files);
	if (delta.changed.length === 0 && delta.removed.length === 0) {
		return {
			project: project.slug,
			repositoryId: repository.repoId,
			repositoryName: project.repositoryName,
			files: files.length,
			changedFiles: 0,
			removedFiles: 0,
			committed: false,
			commitSha: delta.resolvedRef,
		};
	}
	if (!delta.resolvedRef) throw new Error(`TreeDX did not resolve the current publication ref for ${project.slug}.`);
	const operation = localTreeDxSeedOperation(project, files);
	const resumed = await resumeCommittedLocalTreeDxSeed(client, project, repository.repoId, files, operation, delta.resolvedRef);
	if (resumed) {
		return {
			project: project.slug, repositoryId: repository.repoId, repositoryName: project.repositoryName,
			files: files.length, changedFiles: delta.changed.length, removedFiles: delta.removed.length,
			committed: true, resumed: true, ...resumed,
		};
	}
	const workspace = recordValue(await client.createWorkspace({
		repoId: repository.repoId,
		baseRef: project.defaultRef ?? 'refs/heads/main',
		branchName: operation.branchName,
		workspaceId: operation.workspaceId,
		mode: 'writable',
		allowedPaths: projectIndexPaths(project),
		ttlSeconds: 900,
	}));
	const workspaceId = nonEmptyString(workspace.workspaceId);
	if (!workspaceId) throw new Error(`TreeDX did not return a workspace id for ${project.slug}.`);
	try {
		await applyLocalTreeDxSeedDelta(client, workspaceId, delta);
		const commit = recordValue(await client.commit({
			workspaceId,
				message: `Sync ${project.slug} knowledge hub seed content`,
				author: { name: 'TreeSeed Reconciler', email: 'reconciler@treeseed.local' },
		}));
		const commitSha = nonEmptyString(commit.commitSha);
		if (!commitSha) throw new Error(`TreeDX did not return a seed commit for ${project.slug}.`);
		await client.promoteRef({
			repoId: repository.repoId,
			sourceRef: operation.branchName,
			destinationRef: project.defaultRef ?? 'refs/heads/main',
			expectedDestinationHead: delta.resolvedRef,
		});
		const indexes = await refreshLocalTreeDxProjectIndexes(client, project, repository.repoId, commitSha);
		await client.retireRef({
			repoId: repository.repoId,
			ref: operation.branchName,
			mergedIntoRef: project.defaultRef ?? 'refs/heads/main',
			expectedHead: commitSha,
			expectedMergedIntoHead: commitSha,
		});
		return {
			project: project.slug,
			repositoryId: repository.repoId,
			repositoryName: project.repositoryName,
			files: files.length,
			changedFiles: delta.changed.length,
			removedFiles: delta.removed.length,
			committed: true,
			commitSha,
			...indexes,
		};
	} finally {
		await client.closeWorkspace(workspaceId).catch(() => null);
	}
}

export async function ensureLocalTreeDxProjectRepositoryRef(client: TreeDxClient, project: LocalTreeDxContentProject) {
	const repository = await ensureLocalTreeDxProjectRepository(client, project);
	return {
		project: project.slug,
		repositoryId: repository.repoId,
		repositoryName: project.repositoryName,
		files: 0,
		committed: false,
		skippedContentSync: true,
	};
}

export function treeDxSeedFileRecord(value: unknown) {
	const record = recordValue(value);
	const nested = recordValue(record.file);
	const path = nonEmptyString(record.path) || nonEmptyString(nested.path);
	const content = typeof record.content === 'string'
		? record.content
		: typeof nested.content === 'string'
			? nested.content
			: '';
	return { path, content };
}
