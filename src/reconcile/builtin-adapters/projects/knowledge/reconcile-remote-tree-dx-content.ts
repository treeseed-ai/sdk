import type { TreeDxClient } from '../../../../treedx/support/client.ts';
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
	const sourceRef = `refs/heads/${project.sourceBranch ?? 'staging'}`;
	const destinationRef = project.defaultRef ?? sourceRef;
	await client.fetchRemote({
		repoId: repository.repoId,
		remoteName: 'origin',
		remoteUrl: project.remoteUrl,
		refspecs: [`+${sourceRef}:${destinationRef}`],
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
