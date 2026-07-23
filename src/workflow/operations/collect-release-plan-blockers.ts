import { resolveTreeseedMachineEnvironmentValues } from "../../operations/services/config-runtime.ts";
import { STAGING_BRANCH } from "../../operations/services/git-workflow.ts";
import { resolveGitHubRepositorySlug } from "../../operations/services/github-automation.ts";
import { resolveGitHubCredentialForRepository } from "../../operations/services/github-credentials.ts";
import { collectPublicPackageReleaseLineState } from "../../operations/services/workspace-save.ts";
import { checkedOutWorkspacePackageRepos, type TreeseedWorkflowMode, type TreeseedWorkflowSession } from ".././session.ts";
import type { TreeseedWorkflowCiMode } from "../../workflow.ts";
import { validatePackageReleaseWorkflows } from './fail-workflow-run.ts';
import { workflowError } from './run-release-production-guarantees.ts';
import { stringRecord } from './gates-for-saved-repository-reports.ts';

export function collectReleasePlanBlockers(
	session: TreeseedWorkflowSession,
	mode: TreeseedWorkflowMode,
	selectedPackageNames: string[],
	options: { level?: string; repairVersionLine?: boolean } = {},
) {
	const blockers: string[] = [];
	if (session.branchName !== STAGING_BRANCH) {
		blockers.push('Release must start from staging.');
	}
	if (session.rootRepo.dirty) {
		blockers.push('@treeseed/market has uncommitted changes.');
	}
	if (!session.rootRepo.hasOriginRemote) {
		blockers.push('@treeseed/market is missing origin remote.');
	}
	if (mode === 'recursive-workspace') {
		const lineState = collectPublicPackageReleaseLineState(session.root);
		if (options.repairVersionLine !== true && options.level === 'patch' && lineState.drifted) {
			blockers.push(`Public package version line drift detected (${lineState.packages.map((pkg) => `${pkg.name}@${pkg.version}`).join(', ')}). Run \`treeseed release --repair-version-line --target-version-line ${lineState.highestLine} --plan\` first.`);
		}
		for (const repo of session.packageRepos) {
			if (!selectedPackageNames.includes(repo.name)) continue;
			if (repo.detached) blockers.push(`${repo.name} is detached.`);
			if (repo.branchName !== STAGING_BRANCH) blockers.push(`${repo.name} is on ${repo.branchName ?? '(detached)'} instead of staging.`);
			if (repo.dirty) blockers.push(`${repo.name} has uncommitted changes.`);
			if (!repo.hasOriginRemote) blockers.push(`${repo.name} is missing origin remote.`);
		}
		try {
			validatePackageReleaseWorkflows(session.root, selectedPackageNames);
		} catch (error) {
			blockers.push(error instanceof Error ? error.message : String(error));
		}
	}
	return blockers;
}

export function assertReleaseGitHubAutomationReady(root: string, selectedPackageNames: Set<string>, ciMode: TreeseedWorkflowCiMode) {
	if (ciMode === 'off') {
		return;
	}
	const values = resolveTreeseedMachineEnvironmentValues(root, 'prod');
	const missing: Array<{ packageName: string; repository: string; envName: string }> = [];
	for (const pkg of checkedOutWorkspacePackageRepos(root)) {
		if (!selectedPackageNames.has(pkg.name)) continue;
		const repository = resolveGitHubRepositorySlug(pkg.dir);
		const credential = resolveGitHubCredentialForRepository(repository, { values, env: process.env });
		if (!credential.token) {
			missing.push({ packageName: pkg.name, repository: credential.repository, envName: credential.envName });
		}
	}
	if (missing.length > 0) {
		workflowError(
			'release', 			'github_auth_unavailable',
			[
				'Treeseed release automation requires Treeseed-prefixed GitHub credentials.',
				...missing.map((pkg) => `- ${pkg.packageName}: configure ${pkg.envName} for ${pkg.repository}, or TREESEED_GITHUB_TOKEN as a fallback.`),
			].join('\n'),
			{ details: { missing } },
		);
	}
}

export function assertReleaseGitHubWorkflowSucceeded(packageName: string, workflow: Record<string, unknown> | null | undefined) {
	if (!workflow || workflow.status !== 'completed') {
		return;
	}
	if (workflow.conclusion === 'success') {
		return;
	}
	const workflowName = typeof workflow.workflow === 'string' ? workflow.workflow : 'publish.yml';
	const repository = typeof workflow.repository === 'string' ? workflow.repository : packageName;
	const url = typeof workflow.url === 'string' && workflow.url ? `\n${workflow.url}` : '';
	const conclusion = typeof workflow.conclusion === 'string' && workflow.conclusion ? workflow.conclusion : 'unknown';
	workflowError('release', 'github_workflow_failed', `${packageName} ${workflowName} completed with conclusion ${conclusion} in ${repository}.${url}`, {
		details: {
			packageName, 			workflow,
		},
	});
}

export type PublishedArtifactCheck = {
	id: string;
	kind: 'npm' | 'docker' | 'pypi' | 'crates' | 'hex' | 'github-tag';
	name: string;
	version: string;
	url: string;
	ok: boolean;
	status?: number | null;
	message?: string;
};

export function npmRegistryPackageUrl(packageName: string) {
	return `https://registry.npmjs.org/${packageName.replace('/', '%2f')}`;
}

export async function fetchJsonForArtifact(url: string): Promise<{ ok: boolean; status: number; json: unknown }> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 20000);
	try {
		const response = await fetch(url, {
			headers: {
				accept: 'application/json', 				'user-agent': 'treeseed-release-verifier/1.0 (https://treeseed.dev)',
			},
			signal: controller.signal,
		});
		let json: unknown = null;
		try {
			json = await response.json();
		} catch {
			json = null;
		}
		return { ok: response.ok, status: response.status, json };
	} finally {
		clearTimeout(timeout);
	}
}

export function hasObjectKey(value: unknown, key: string) {
	return Boolean(value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key));
}

export async function verifyNpmArtifact(packageName: string, version: string): Promise<PublishedArtifactCheck> {
	const url = npmRegistryPackageUrl(packageName);
	try {
		const response = await fetchJsonForArtifact(url);
		const versions = stringRecord(response.json)?.versions;
		const ok = response.ok && hasObjectKey(versions, version);
		return {
			id: `npm:${packageName}:${version}`,
			kind: 'npm', 			name: packageName, 			version, 			url, 			ok, 			status: response.status,
			...(ok ? {} : { message: `${packageName}@${version} was not found in npm registry metadata.` }),
		};
	} catch (error) {
		return {
			id: `npm:${packageName}:${version}`,
			kind: 'npm', 			name: packageName, 			version, 			url, 			ok: false, 			status: null, 			message: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function fetchDockerRegistryManifestStatus(image: string, version: string): Promise<{ ok: boolean; status: number | null; message?: string }> {
	const [namespace, repository] = image.split('/');
	if (!namespace || !repository) {
		return { ok: false, status: null, message: `Invalid Docker image name ${image}.` };
	}
	const tokenUrl = `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${namespace}/${repository}:pull`;
	try {
		const tokenResponse = await fetchJsonForArtifact(tokenUrl);
		const token = typeof stringRecord(tokenResponse.json)?.token === 'string'
			? String(stringRecord(tokenResponse.json)?.token)
			: '';
		if (!tokenResponse.ok || !token) {
			return { ok: false, status: tokenResponse.status, message: `Docker registry token request failed for ${image}.` };
		}
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 20000);
		try {
			const manifestResponse = await fetch(`https://registry-1.docker.io/v2/${namespace}/${repository}/manifests/${version}`, {
				method: 'HEAD',
				headers: {
					accept: [
						'application/vnd.docker.distribution.manifest.list.v2+json', 						'application/vnd.oci.image.index.v1+json', 						'application/vnd.docker.distribution.manifest.v2+json',
					].join(', '),
					authorization: `Bearer ${token}`,
					'user-agent': 'treeseed-release-verifier/1.0 (https://treeseed.dev)',
				},
				signal: controller.signal,
			});
			return {
				ok: manifestResponse.ok, 				status: manifestResponse.status,
				...(manifestResponse.ok ? {} : { message: `Docker registry manifest for ${image}:${version} is not pullable yet.` }),
			};
		} finally {
			clearTimeout(timeout);
		}
	} catch (error) {
		return { ok: false, status: null, message: error instanceof Error ? error.message : String(error) };
	}
}

export async function verifyDockerHubArtifact(image: string, version: string): Promise<PublishedArtifactCheck> {
	const [namespace, repository] = image.split('/');
	const url = `https://hub.docker.com/v2/repositories/${namespace}/${repository}/tags/${version}`;
	try {
		const response = await fetchJsonForArtifact(url);
		const images = Array.isArray(stringRecord(response.json)?.images) ? stringRecord(response.json)?.images as unknown[] : [];
		const architectures = new Set(images
			.map((entry) => stringRecord(entry))
			.map((entry) => typeof entry?.architecture === 'string' ? entry.architecture : null)
			.filter((entry): entry is string => Boolean(entry)));
		const registry = await fetchDockerRegistryManifestStatus(image, version);
		const ok = response.ok && architectures.has('amd64') && architectures.has('arm64') && registry.ok;
		return {
			id: `docker:${image}:${version}`,
			kind: 'docker', 			name: image, 			version, 			url, 			ok, 			status: registry.status ?? response.status,
			...(ok ? {} : { message: registry.message ?? `${image}:${version} was not found on Docker Hub with amd64 and arm64 images.` }),
		};
	} catch (error) {
		return {
			id: `docker:${image}:${version}`,
			kind: 'docker', 			name: image, 			version, 			url, 			ok: false, 			status: null, 			message: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function verifyGitHubTagArtifact(repository: string, version: string): Promise<PublishedArtifactCheck> {
	const url = `https://api.github.com/repos/${repository}/git/ref/tags/${encodeURIComponent(version)}`;
	try {
		const response = await fetchJsonForArtifact(url);
		return {
			id: `github-tag:${repository}:${version}`,
			kind: 'github-tag', 			name: repository, 			version, 			url, 			ok: response.ok, 			status: response.status,
			...(response.ok ? {} : { message: `GitHub tag ${repository}@${version} was not found.` }),
		};
	} catch (error) {
		return {
			id: `github-tag:${repository}:${version}`,
			kind: 'github-tag', 			name: repository, 			version, 			url, 			ok: false, 			status: null, 			message: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function verifySimpleRegistryArtifact(input: {
	kind: 'pypi' | 'crates' | 'hex';
	name: string;
	version: string;
	url: string;
}): Promise<PublishedArtifactCheck> {
	try {
		const response = await fetchJsonForArtifact(input.url);
		return {
			id: `${input.kind}:${input.name}:${input.version}`,
			kind: input.kind, 			name: input.name, 			version: input.version, 			url: input.url, 			ok: response.ok, 			status: response.status,
			...(response.ok ? {} : { message: `${input.name} ${input.version} was not found in ${input.kind}.` }),
		};
	} catch (error) {
		return {
			id: `${input.kind}:${input.name}:${input.version}`,
			kind: input.kind, 			name: input.name, 			version: input.version, 			url: input.url, 			ok: false, 			status: null, 			message: error instanceof Error ? error.message : String(error),
		};
	}
}
