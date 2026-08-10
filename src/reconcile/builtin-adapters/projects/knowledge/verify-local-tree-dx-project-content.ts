import { collectLocalTreeDxSeedFiles,verifyLocalTreeDxSeedFiles } from "../../../../platform/treedx/repositories/local-treedx-seed.ts";
import { TreeDxClient } from "../../../../treedx/support/client.ts";
import { checkHttpHealth } from "../../../providers/local-private.ts";
import type { ReconcileAdapter,UnitVerificationCheck,UnitVerificationResult } from "../../../support/contracts/contracts.ts";
import { desiredUnitSpecHash } from "../../../support/state/state.ts";
import { LocalTreeDxContentProject,ensureLocalTreeDxProjectRepositoryRef,localTreeDxProjects,mintLocalTreeDxJwt,nonEmptyString,recordValue,syncLocalTreeDxProjectContent,treeDxSeedFileRecord } from '../../capacity/providers/build-capacity-provider-adapter.ts';
import { verificationCheck } from '../../hosting/first-railway-domain-string.ts';
import { genericObservedState,genericResult,noopDiff } from '../../hosting/to-deploy-target.ts';
import { summarizeVerification } from '../../support/summarize-verification.ts';

const LOCAL_TREEDX_RECONCILIATION_TIMEOUT_MS = 120_000;

export function createLocalTreeDxReconciliationClient(
	baseUrl: string,
	token: string,
	fetchImpl?: typeof fetch,
	timeoutMs = LOCAL_TREEDX_RECONCILIATION_TIMEOUT_MS,
) {
	return new TreeDxClient({
		baseUrl,
		token,
		timeoutMs,
		...(fetchImpl ? { fetch: fetchImpl } : {}),
	});
}

async function verifyLocalTreeDxProjectContentOnce(
	client: TreeDxClient,
	project: LocalTreeDxContentProject,
	repositoryId: string,
) {
	const desiredFiles = collectLocalTreeDxSeedFiles(project);
	const response = desiredFiles.length
		? await client.readRepositoryFiles({ repoId: repositoryId, ref: project.defaultRef ?? 'refs/heads/main',
			paths: desiredFiles.map((file) => file.path), encoding: 'utf8', parseFrontmatter: false })
		: await client.listRepositoryPaths({ repoId: repositoryId, ref: project.defaultRef ?? 'refs/heads/main',
			paths: [`${project.contentPath}/**`], limit: 1 });
	const observedFiles = (Array.isArray(response.files) ? response.files : response.file ? [response.file] : [])
		.map(treeDxSeedFileRecord);
	const resolvedRef = typeof response.resolvedRef === 'string' ? response.resolvedRef : '';
	if (!/^[a-f0-9]{40}$/u.test(resolvedRef)) throw new Error(`TreeDX did not resolve an immutable commit for ${project.slug}.`);
	const ref = project.defaultRef ?? 'refs/heads/main';
	const frontmatterSource = desiredFiles.find((file) => /^---\r?\n/u.test(file.content));
	const [searchStatus, searchProbe, graphProbe, frontmatterProbe] = await Promise.all([
		client.getSearchIndexStatus({ repoId: repositoryId, ref }),
		client.searchRepositoryFiles({ repoId: repositoryId, ref, paths: project.seedPaths?.map((path) => `${path}/**`),
			query: 'TreeSeed', limit: 1, includeBody: false }),
		client.queryGraph({ repoId: repositoryId, ref, query: 'TreeSeed', options: { limit: 1 } }),
		frontmatterSource
			? client.readRepositoryFiles({ repoId: repositoryId, ref, paths: [frontmatterSource.path], encoding: 'utf8', parseFrontmatter: true })
			: Promise.resolve(null),
	]);
	const parsedFile = recordValue(frontmatterProbe?.file ?? (Array.isArray(frontmatterProbe?.files) ? frontmatterProbe.files[0] : null));
	const parsedFrontmatter = recordValue(parsedFile.frontmatter);
	const frontmatterVerified = !frontmatterSource
		|| (Object.keys(parsedFrontmatter).length > 0 && !parsedFile.frontmatterError && frontmatterProbe?.resolvedRef === resolvedRef);
	if (!searchStatus.ready || searchStatus.stale || searchStatus.resolvedRef !== resolvedRef
		|| (searchStatus.sourceCommit && searchStatus.sourceCommit !== resolvedRef)
		|| searchProbe.resolvedRef !== resolvedRef || !graphProbe.graphVersion
		|| (searchStatus.graphVersion && graphProbe.graphVersion !== searchStatus.graphVersion)
		|| !frontmatterVerified) {
		throw new Error(`TreeDX graph/search state is not at the exact repository commit for ${project.slug}.`);
	}
	return {
		...verifyLocalTreeDxSeedFiles(desiredFiles, observedFiles),
		ref, resolvedRef, graphVersion: graphProbe.graphVersion, searchIndexVersion: searchStatus.indexVersion,
		seedDigest: project.seedDigest ?? null, frontmatterVerified,
	};
}

export async function verifyLocalTreeDxProjectContent(
	client: TreeDxClient,
	project: LocalTreeDxContentProject,
	repositoryId: string,
) {
	for (let attempt = 1; attempt <= 3; attempt += 1) {
		try {
			return await verifyLocalTreeDxProjectContentOnce(client, project, repositoryId);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (!/shared cache load|cache_load_timeout/iu.test(message) || attempt === 3) throw error;
			await new Promise((resolvePromise) => setTimeout(resolvePromise, attempt * 500));
		}
	}
	throw new Error(`TreeDX content verification exhausted retries for ${project.slug}.`);
}

export function buildLocalTreeDxAdapter(): ReconcileAdapter {
	return {
		providerId: 'local',
		unitTypes: ['local-treedx'],
		supports(unitType, providerId) {
			return unitType === 'local-treedx' && providerId === 'local';
		},
		async refresh(input) {
			const baseUrl = nonEmptyString(input.unit.spec.baseUrl);
			const token = nonEmptyString(input.unit.spec.token) || mintLocalTreeDxJwt(recordValue(input.unit.spec.auth));
			const projects = localTreeDxProjects(input.unit.spec.projects);
			let repositories: unknown[] = [];
			const warnings: string[] = [];
			if (baseUrl && token) {
				try {
					const timeoutMs = input.context.session.get('treeseed:status-only') === true ? 5_000 : LOCAL_TREEDX_RECONCILIATION_TIMEOUT_MS;
					repositories = await createLocalTreeDxReconciliationClient(baseUrl, token, undefined, timeoutMs).listRepositories();
				} catch (error) {
					warnings.push(`TreeDX repositories could not be observed: ${error instanceof Error ? error.message : String(error)}`);
				}
			} else if (projects.length > 0) {
				warnings.push('TreeDX base URL or reconciliation token is missing.');
			}
			const registeredRepositoryNames = repositories.flatMap((entry) => {
				const record = recordValue(entry);
				const name = nonEmptyString(record.repositoryName) || nonEmptyString(record.name);
				return name ? [name] : [];
			});
			const allRegistered = projects.every((project) => registeredRepositoryNames.includes(project.repositoryName));
			return {
				...genericObservedState(input, warnings.length === 0, warnings),
				status: warnings.length > 0 ? 'error' : allRegistered ? 'ready' : 'pending',
				live: {
					...input.unit.spec,
					dependencies: input.unit.dependencies,
					registeredRepositoryNames,
				},
			};
		},
		diff(input) {
			const projects = localTreeDxProjects(input.unit.spec.projects);
			if (projects.length === 0) return noopDiff();
			if (input.observed.status === 'error') {
				return { action: 'blocked', reasons: input.observed.warnings, before: input.observed.live, after: input.unit.spec };
			}
			const registered = Array.isArray(input.observed.live.registeredRepositoryNames)
				? input.observed.live.registeredRepositoryNames.filter((entry): entry is string => typeof entry === 'string')
				: [];
			const missing = projects.filter((project) => !registered.includes(project.repositoryName));
			if (missing.length > 0) {
				return {
					action: 'update',
					reasons: [`TreeDX repositories are missing: ${missing.map((project) => project.repositoryName).join(', ')}`],
					before: input.observed.live,
					after: input.unit.spec,
				};
			}
			if (!input.persistedState?.lastReconciledAt || input.persistedState.desiredSpecHash !== desiredUnitSpecHash(input.unit)) {
				return {
					action: 'update',
					reasons: ['local TreeDX seed content changed or has not been reconciled'],
					before: input.observed.live,
					after: input.unit.spec,
				};
			}
			return noopDiff();
		},
		async apply(input) {
			if (input.diff.action === 'noop' || input.diff.action === 'blocked') return genericResult(input);
			const baseUrl = nonEmptyString(input.unit.spec.baseUrl);
			const token = nonEmptyString(input.unit.spec.token) || mintLocalTreeDxJwt(recordValue(input.unit.spec.auth));
			const projects = localTreeDxProjects(input.unit.spec.projects);
			if (!baseUrl || !token || projects.length === 0) return genericResult(input);
			const client = createLocalTreeDxReconciliationClient(baseUrl, token);
			const syncedProjects = [];
			const syncSeedContent = input.unit.spec.syncSeedContent !== false;
			for (const [index, project] of projects.entries()) {
				input.context.write?.(`Syncing local TreeDX project ${index + 1}/${projects.length} (${project.slug})...`);
				const synced = syncSeedContent
					? await syncLocalTreeDxProjectContent(client, project)
					: await ensureLocalTreeDxProjectRepositoryRef(client, project);
				syncedProjects.push(synced);
				input.context.write?.(`Synced local TreeDX project ${index + 1}/${projects.length} (${project.slug}, ${synced.files} files).`);
			}
			return genericResult(input, { ...input.observed.live, syncedProjects });
		},
		async verify(input) {
			const statusOnly = input.context.session.get('treeseed:status-only') === true;
			const dependencyResults = input.context.session.get('treeseed:verification-results') as Map<string, UnitVerificationResult> | undefined;
			const dependencyChecks = input.unit.dependencies.map((dependency) => {
				const verification = dependencyResults?.get(dependency);
				const ok = verification ? verification.verified === true : true;
				return verificationCheck(`dependency:${dependency}`, `TreeDX dependency ${dependency} is verified`, 'derived', {
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
				dependencyChecks.push(verificationCheck('treedx-health', `TreeDX health endpoint ${healthEndpoint} responds`, 'api', {
					exists: health.ok,
					configured: true,
					ready: health.ok,
					verified: health.ok,
					observed: health,
					issues: health.ok ? [] : [`TreeDX health endpoint ${healthEndpoint} did not respond successfully.`],
				}));
			}
			const contentIsTreeDx = input.unit.spec.contentRepositoryAccessMode === 'treedx';
			const siteIsFilesystem = input.unit.spec.siteRepositoryAccessMode === 'filesystem';
			const projectIsFilesystem = input.unit.spec.projectRepositoryAccessMode === 'filesystem';
			const topologyChecks = [
				verificationCheck('content-repository-plane', 'Content repositories use TreeDX by default', 'derived', {
					exists: true,
					configured: contentIsTreeDx,
					ready: contentIsTreeDx,
					verified: contentIsTreeDx,
					observed: input.unit.spec.contentRepositoryAccessMode,
					issues: contentIsTreeDx ? [] : ['Content repository access mode is not treedx.'],
				}),
				verificationCheck('site-repository-plane', 'Project site repositories use local filesystem/worktrees by default', 'derived', {
					exists: true,
					configured: siteIsFilesystem,
					ready: siteIsFilesystem,
					verified: siteIsFilesystem,
					observed: input.unit.spec.siteRepositoryAccessMode,
					issues: siteIsFilesystem ? [] : ['Site repository access mode is not filesystem.'],
				}),
				verificationCheck('project-repository-plane', 'Super-project repositories use local filesystem/worktrees by default', 'derived', {
					exists: true,
					configured: projectIsFilesystem,
					ready: projectIsFilesystem,
					verified: projectIsFilesystem,
					observed: input.unit.spec.projectRepositoryAccessMode,
					issues: projectIsFilesystem ? [] : ['Project repository access mode is not filesystem.'],
				}),
			];
			const repositoryChecks: UnitVerificationCheck[] = [];
			const baseUrl = nonEmptyString(input.unit.spec.baseUrl);
			const token = nonEmptyString(input.unit.spec.token) || mintLocalTreeDxJwt(recordValue(input.unit.spec.auth));
			if (baseUrl && token) {
				const client = createLocalTreeDxReconciliationClient(baseUrl, token);
				let repositories: unknown[] = statusOnly
					? (Array.isArray(input.observed.live.registeredRepositoryNames)
						? input.observed.live.registeredRepositoryNames.map((repositoryName) => ({ repositoryName }))
						: [])
					: [];
				if (!statusOnly) {
					try {
						repositories = await client.listRepositories();
					} catch {
						repositories = [];
					}
				}
				for (const project of localTreeDxProjects(input.unit.spec.projects)) {
					const repo = repositories.find((entry) => {
						const record = recordValue(entry);
						return record.repositoryName === project.repositoryName || record.name === project.repositoryName;
					});
					if (repo) {
						const repositoryId = nonEmptyString(recordValue(repo).repoId);
						repositoryChecks.push(verificationCheck(`treedx-repo:${project.slug}`, `TreeDX repository ${project.repositoryId} is registered`, 'api', {
							exists: true,
							configured: true,
							ready: true,
							verified: true,
							observed: repo,
						}));
						if (!statusOnly && input.unit.spec.syncSeedContent !== false && repositoryId) {
							try {
								const content = await verifyLocalTreeDxProjectContent(client, project, repositoryId);
								repositoryChecks.push(verificationCheck(`treedx-content:${project.slug}`, `TreeDX repository ${project.repositoryId} exposes the exact desired seed content from ${project.defaultRef ?? 'refs/heads/main'}`, 'api', {
									exists: content.verifiedFileCount > 0 || content.desiredFileCount === 0,
									configured: true,
									ready: content.verified,
									verified: content.verified,
									observed: content,
									issues: content.verified ? [] : [
										...(content.missingPaths.length ? [`Missing paths: ${content.missingPaths.join(', ')}`] : []),
										...(content.mismatchedPaths.length ? [`Content differs: ${content.mismatchedPaths.join(', ')}`] : []),
									],
								}));
							} catch (error) {
								repositoryChecks.push(verificationCheck(`treedx-content:${project.slug}`, `TreeDX repository ${project.repositoryId} exposes the exact desired seed content from ${project.defaultRef ?? 'refs/heads/main'}`, 'api', {
									exists: false,
									configured: true,
									ready: false,
									verified: false,
									observed: { repositoryId, ref: project.defaultRef ?? 'refs/heads/main' },
									issues: [error instanceof Error ? error.message : String(error)],
								}));
							}
						}
					} else {
						repositoryChecks.push(verificationCheck(`treedx-repo:${project.slug}`, `TreeDX repository ${project.repositoryId} is registered`, 'api', {
							exists: false,
							configured: true,
							ready: false,
							verified: false,
							observed: { repositoryName: project.repositoryName },
							issues: [`TreeDX repository ${project.repositoryId} is not registered.`],
						}));
					}
				}
			}
			return summarizeVerification(input.unit.unitId, [...dependencyChecks, ...topologyChecks, ...repositoryChecks], input.observed.warnings);
		},
		destroy(input) {
			return genericResult({
				...input,
				diff: { action: 'delete', reasons: ['selected local TreeDX topology for destroy'], before: input.observed.live, after: {} },
			});
		},
	};
}
