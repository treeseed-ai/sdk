import { resolve } from 'node:path';
import { TreeDxClient } from "../../treedx/client.ts";
import { mintTreeDxHs256Token } from "../../treedx/auth.ts";
import { observeCapacityProviderRuntimeStatus } from "../../capacity-provider/runtime-status.ts";
import { collectLocalTreeDxSeedFiles } from "../../platform/local-treedx-seed.ts";
import type { TreeseedReconcileAdapter, TreeseedUnitVerificationResult } from ".././contracts.ts";
import { checkHttpHealth } from ".././providers/local-private.ts";
import { genericObservedState, genericResult, noopDiff } from './to-deploy-target.ts';
import { verificationCheck } from './first-railway-domain-string.ts';
import { summarizeVerification } from './summarize-verification.ts';

export function buildCapacityProviderAdapter(providerId: 'local' | 'railway'): TreeseedReconcileAdapter {
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
			const dependencyResults = input.context.session.get('treeseed:verification-results') as Map<string, TreeseedUnitVerificationResult> | undefined;
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

export async function syncLocalTreeDxProjectContent(client: TreeDxClient, project: LocalTreeDxContentProject) {
	const files = collectLocalTreeDxSeedFiles(project);
	const repository = await ensureLocalTreeDxProjectRepository(client, project);
	if (files.length === 0) {
		return { project: project.slug, repositoryId: repository.repoId, repositoryName: project.repositoryName, files: 0, committed: false };
	}
	const workspace = recordValue(await client.createWorkspace({
			repoId: repository.repoId,
			baseRef: project.defaultRef ?? 'refs/heads/main',
			branchName: project.defaultRef ?? 'refs/heads/main',
			mode: 'writable',
			allowedPaths: [`${project.contentPath.replace(/\/+$/u, '')}/**`],
			ttlSeconds: 900,
	}));
	const workspaceId = nonEmptyString(workspace.workspaceId);
	if (!workspaceId) throw new Error(`TreeDX did not return a workspace id for ${project.slug}.`);
	try {
		for (const file of files) {
			await client.writeFile({
				workspaceId,
				path: file.path,
				content: file.content,
				encoding: 'utf8',
			});
		}
		const commit = recordValue(await client.commit({
			workspaceId,
				message: `Sync ${project.slug} knowledge hub seed content`,
				author: { name: 'TreeSeed Reconciler', email: 'reconciler@treeseed.local' },
		}));
		const graphRefresh = recordValue(await client.refreshGraph({
			repoId: repository.repoId,
				paths: project.seedPaths?.length ? project.seedPaths.map((seedPath) => `${seedPath.replace(/\/+$/u, '')}/**`) : [`${project.contentPath.replace(/\/+$/u, '')}/**`],
		}).catch((error) => ({
			error: error instanceof Error ? error.message : String(error),
		})));
		return {
			project: project.slug,
			repositoryId: repository.repoId,
			repositoryName: project.repositoryName,
			files: files.length,
			committed: true,
			commitSha: nonEmptyString(commit.commitSha) || null,
			graphRefresh,
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
