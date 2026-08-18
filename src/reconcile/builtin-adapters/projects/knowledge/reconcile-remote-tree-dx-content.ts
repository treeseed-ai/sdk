import type { TreeDxClient } from '../../../../treedx/support/client.ts';
import { createHash } from 'node:crypto';
import type { LocalTreeDxContentProject } from '../../capacity/providers/build-capacity-provider-adapter.ts';
import {
	ensureLocalTreeDxProjectRepository,
	nonEmptyString,
	recordValue,
	refreshLocalTreeDxProjectIndexes,
} from '../../capacity/providers/build-capacity-provider-adapter.ts';

function remoteIdentity(project: LocalTreeDxContentProject) {
	if (project.remoteOwner && project.remoteName) return { owner: project.remoteOwner, name: project.remoteName };
	const url = project.remoteUrl ? new URL(project.remoteUrl) : null;
	const [owner, rawName] = url?.pathname.replace(/^\/+|\/+$/gu, '').split('/') ?? [];
	const name = rawName?.replace(/\.git$/u, '');
	if (!owner || !name || url?.hostname.toLowerCase() !== 'github.com') {
		throw new Error(`TreeDX remote content repository for ${project.slug} must be a canonical GitHub HTTPS URL.`);
	}
	return { owner, name };
}

export async function observeRemoteContentHead(
	project: LocalTreeDxContentProject,
	env: NodeJS.ProcessEnv,
	fetchImpl: typeof fetch = fetch,
) {
	if (!project.remoteUrl) return null;
	const { owner, name } = remoteIdentity(project);
	const branch = project.sourceBranch ?? 'staging';
	const token = env.TREESEED_GITHUB_TOKEN?.trim();
	const response = await fetchImpl(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/ref/heads/${encodeURIComponent(branch)}`, {
		headers: {
			accept: 'application/vnd.github+json',
			...(token ? { authorization: `Bearer ${token}` } : {}),
			'x-github-api-version': '2022-11-28',
		},
	});
	if (!response.ok) throw new Error(`GitHub could not observe ${owner}/${name} ${branch} (${response.status}).`);
	const body = recordValue(await response.json());
	const sha = nonEmptyString(recordValue(body.object).sha);
	if (!/^[a-f0-9]{40}$/u.test(sha)) throw new Error(`GitHub returned an invalid ${branch} head for ${owner}/${name}.`);
	return sha;
}

export async function localTreeDxRemoteHead(client: TreeDxClient, repositoryId: string, project: LocalTreeDxContentProject) {
	const ref = project.defaultRef ?? `refs/heads/${project.sourceBranch ?? 'staging'}`;
	const refs = await client.listRepositoryRefs(repositoryId);
	const candidate = refs.find((entry) => entry.name === ref);
	return nonEmptyString(candidate?.target) || nonEmptyString(candidate?.sha) || null;
}

export async function observeUnpublishedTreeDxAuthoring(
	project: LocalTreeDxContentProject,
	env: NodeJS.ProcessEnv,
	fetchImpl: typeof fetch = fetch,
) {
	if (!project.teamSlug) throw new Error(`TreeDX authoring journal requires the team identity for ${project.slug}.`);
	const apiUrl = nonEmptyString(env.TREESEED_API_BASE_URL) || 'http://127.0.0.1:3000';
	const runnerSecret = nonEmptyString(env.TREESEED_PLATFORM_RUNNER_SECRET) || 'treeseed-platform-runner-dev-secret';
	const url = new URL('/v1/internal/treedx/authoring-journal/status',apiUrl);
	url.searchParams.set('teamSlug',project.teamSlug);
	url.searchParams.set('projectSlug',project.slug);
	const response = await fetchImpl(url,{ headers:{ authorization:`Bearer ${runnerSecret}`,accept:'application/json' } });
	const envelope = recordValue(await response.json().catch(() => ({})));
	const payload = recordValue(envelope.payload);
	if (!response.ok) throw new Error(`TreeDX authoring journal could not be observed for ${project.slug} (${response.status}).`);
	return Array.isArray(payload.unpublished) ? payload.unpublished.map(recordValue) : [];
}

export async function syncRemoteTreeDxProjectContent(input: {
	client: TreeDxClient;
	project: LocalTreeDxContentProject;
	expectedRemoteHead: string;
	env: NodeJS.ProcessEnv;
}) {
	const { client, project, expectedRemoteHead, env } = input;
	if (!project.remoteUrl) throw new Error(`TreeDX remote content repository URL is missing for ${project.slug}.`);
	const before = await observeRemoteContentHead(project, env);
	if (before !== expectedRemoteHead) throw new Error(`GitHub ${project.slug} content ref changed after planning. Run the plan again.`);
	const repository = await ensureLocalTreeDxProjectRepository(client, project);
	const currentLocalHead = await localTreeDxRemoteHead(client,repository.repoId,project);
	if (currentLocalHead && currentLocalHead !== expectedRemoteHead) {
		const unpublished = await observeUnpublishedTreeDxAuthoring(project,env);
		if (unpublished.some((entry) => nonEmptyString(entry.commitSha) === currentLocalHead)) {
			throw new Error(`TreeDX ${project.slug} contains journaled unpublished authoring commit ${currentLocalHead}; publish or resume it before reconciliation.`);
		}
	}
	const sourceRef = `refs/heads/${project.sourceBranch ?? 'staging'}`;
	const destinationRef = project.defaultRef ?? sourceRef;
	const refspec = `+${sourceRef}:${destinationRef}`;
	let credentialId: string | undefined;
	if (project.remoteVisibility === 'private') {
		const placement = await client.getPlacement(repository.repoId);
		const nodeId = nonEmptyString(placement.primaryNodeId);
		const apiUrl = nonEmptyString(env.TREESEED_API_BASE_URL) || 'http://127.0.0.1:3000';
		const runnerSecret = nonEmptyString(env.TREESEED_PLATFORM_RUNNER_SECRET) || 'treeseed-platform-runner-dev-secret';
		if (!nodeId || !runnerSecret) throw new Error(`Private TreeDX content credential authority is unavailable for ${project.slug}.`);
		const idempotencyKey = createHash('sha256').update([
			project.projectKey ?? project.slug, expectedRemoteHead, nodeId, refspec,
		].join('\n')).digest('hex');
		const response = await fetch(`${apiUrl.replace(/\/+$/u, '')}/v1/internal/treedx/credential-deliveries/prepare`, {
			method: 'POST',
			headers: { authorization: `Bearer ${runnerSecret}`, 'content-type': 'application/json' },
			body: JSON.stringify({ teamSlug: project.teamSlug, projectSlug: project.slug,
				owner: project.remoteOwner, name: project.remoteName, nodeId, sourceRef, destinationRef,
				expectedRemoteHead, refspec, idempotencyKey }),
		});
		const envelope = recordValue(await response.json().catch(() => ({})));
		const payload = recordValue(envelope.payload);
		credentialId = nonEmptyString(payload.deliveryId);
		if (!response.ok || !credentialId) {
			const detail = nonEmptyString(envelope.error) || nonEmptyString(envelope.code) || `HTTP ${response.status}`;
			throw new Error(`Private TreeDX content credential preparation failed for ${project.slug}: ${detail}.`);
		}
	}
	await client.fetchRemote({
		repoId: repository.repoId,
		remoteName: 'origin',
		remoteUrl: project.remoteUrl,
		...(credentialId ? { credentialId } : {}),
		refspecs: [refspec],
	});
	const localHead = await localTreeDxRemoteHead(client, repository.repoId, project);
	const after = await observeRemoteContentHead(project, env);
	if (after !== expectedRemoteHead || localHead !== expectedRemoteHead) {
		throw new Error(`TreeDX did not reconcile ${project.slug} to the exact live GitHub content commit.`);
	}
	const indexes = await refreshLocalTreeDxProjectIndexes(client, project, repository.repoId, localHead);
	return {
		project: project.slug,
		repositoryId: repository.repoId,
		repositoryName: project.repositoryName,
		remoteUrl: project.remoteUrl,
		ref: destinationRef,
		commitSha: localHead,
		files: 0,
		committed: false,
		fetched: true,
		...indexes,
	};
}
