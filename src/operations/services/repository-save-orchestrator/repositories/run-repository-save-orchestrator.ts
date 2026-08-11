import {
PRODUCTION_BRANCH,
STAGING_BRANCH,
headCommit
} from '../../operations/git-workflow.ts';
import { createPackageDependencyReference,type PackageDependencyReference } from '../../packages/package-reference-policy.ts';
import { createReport } from '../support/classify-repo-kind.ts';
import { RepositorySaveError,RepositorySaveOptions,RepositorySaveResult,SaveState } from '../support/repo-kind.ts';
import { publishDeferredRepositoryPushes } from '../support/run-script.ts';
import { tagState } from '../support/tag-state.ts';
import { compareNodes,discoverRepositorySaveNodes,repositorySaveConcurrency,repositorySaveWaves,runLimited,selectRepositorySaveNodes } from './discover-repository-save-nodes.ts';
import { saveOneRepository } from './save-one-repository.ts';

export function initialPackageDependencyReferences(
	nodes: RepositorySaveNode[],
	options: Pick<RepositorySaveOptions, 'devDependencyReferenceMode' | 'gitDependencyProtocol'>,
) {
	const references = new Map<string, PackageDependencyReference>();
	for (const node of nodes) {
		const version = typeof node.packageJson?.version === 'string' ? node.packageJson.version : null;
		const commitSha = node.kind === 'package' ? headCommit(node.path) : null;
		if (!version || !commitSha || !node.remoteUrl) continue;
		references.set(node.name, createPackageDependencyReference({
			packageName: node.name,
			version,
			branchMode: node.branchMode === 'package-release-main' ? 'package-release-main' : 'package-dev-save',
			remoteUrl: node.remoteUrl,
			commitSha,
			devDependencyReferenceMode: options.devDependencyReferenceMode ?? 'git-commit',
			gitDependencyProtocol: options.gitDependencyProtocol ?? 'preserve-origin',
			sourcePath: node.path,
		}));
	}
	return references;
}

export async function runRepositorySaveOrchestrator(options: RepositorySaveOptions): Promise<RepositorySaveResult> {
	const root = options.root;
	const gitRoot = options.gitRoot;
	const branch = options.branch;
	const scope = branch === STAGING_BRANCH ? 'staging' : branch === PRODUCTION_BRANCH ? 'prod' : 'local';
	const allNodes = discoverRepositorySaveNodes(root, gitRoot, branch, {
		stablePackageRelease: options.stablePackageRelease === true,
	});
	const includedNodes = options.includeRoot === false ? allNodes.filter((node) => node.id !== '.') : allNodes;
	const nodes = selectRepositorySaveNodes(includedNodes, options.selectedRepositoryPath);
	const mode = nodes.length > 1 ? 'recursive-workspace' : 'root-only';
	const repositoryScope = options.selectedRepositoryPath ? 'repository' : 'federated';
	const waves = repositorySaveWaves(nodes);
	const state: SaveState = {
		finalizedVersions: new Map(),
		finalizedReferences: initialPackageDependencyReferences(nodes, options),
		finalizedCommits: new Map(),
		localGitRepositories: new Map(),
		reports: new Map(nodes.map((node) => [node.id, createReport(node)])),
		remoteAccessChecked: new Set(),
		workflowGates: [],
		deferredPushes: [],
	};
	const concurrency = repositorySaveConcurrency(options);

	for (const [index, wave] of waves.entries()) {
		await runLimited(wave, concurrency, async (node) => {
			try {
				await saveOneRepository(node, options, state);
				if (node.remoteUrl) {
					state.localGitRepositories.set(node.id, { sourcePath: node.path,remoteUrl: node.remoteUrl });
				}
			} catch (error) {
				const existing = repositorySaveErrorDetails(error);
				throw new RepositorySaveError(error instanceof Error ? error.message : String(error), {
					exitCode: existing.exitCode,
					details: {
						...(existing.details ?? {}),
						partialFailure: {
							message: `Treeseed save stopped while saving ${node.name}.`,
							failingRepo: node.name,
							phase: typeof existing.details?.phase === 'string' ? existing.details.phase : null,
							currentVersion: typeof node.packageJson?.version === 'string' ? node.packageJson.version : null,
							expectedTag: node.plannedTag,
							tagState: node.plannedTag ? tagState(node.path, node.plannedTag) : null,
							nextCommand: `treeseed resume ${options.workflowRunId ?? '<run-id>'}`,
							repos: [...state.reports.entries()]
								.filter(([id]) => id !== '.')
								.map(([, report]) => report),
							rootRepo: state.reports.get('.') ?? null,
							error: error instanceof Error ? error.message : String(error),
						},
					},
				});
			}
		});
		const waveReports = wave.map((node) => state.reports.get(node.id) ?? createReport(node));
		const allReports = [...state.reports.values()];
		let waveGates: Array<Record<string, unknown>> | undefined;
		try {
			waveGates = await options.onWaveSaved?.({
				index: index + 1,
				nodes: wave,
				reports: waveReports,
				allReports,
				rootRepo: state.reports.get('.') ?? null,
			});
		} catch (error) {
			const existing = repositorySaveErrorDetails(error);
			const errorDetails = existing.details
				?? (error && typeof error === 'object' && 'details' in error && error.details && typeof error.details === 'object'
					? error.details as Record<string, unknown>
					: undefined);
			const errorExitCode = existing.exitCode
				?? (error && typeof error === 'object' && 'exitCode' in error && typeof error.exitCode === 'number'
					? error.exitCode
					: undefined);
			const gate = errorDetails?.gate;
			const failingRepo = gate && typeof gate === 'object' && 'name' in gate && typeof gate.name === 'string'
				? gate.name
				: wave.map((node) => node.name).join(', ');
			throw new RepositorySaveError(error instanceof Error ? error.message : String(error), {
				exitCode: errorExitCode,
				details: {
					...(errorDetails ?? {}),
					partialFailure: {
						message: `Treeseed save stopped while waiting for hosted gates after wave ${index + 1}.`,
						failingRepo,
						nextCommand: `treeseed resume ${options.workflowRunId ?? '<run-id>'}`,
						repos: allReports.filter((report) => report.name !== '@treeseed/market'),
						rootRepo: state.reports.get('.') ?? null,
						error: error instanceof Error ? error.message : String(error),
					},
				},
			});
		}
		if (Array.isArray(waveGates)) {
			state.workflowGates.push(...waveGates);
		}
	}

	await publishDeferredRepositoryPushes(options, state);

	const rootNode = nodes.find((node) => node.id === '.') ?? nodes[0];
	const rootReport = rootNode
		? (state.reports.get(rootNode.id) ?? createReport(rootNode))
		: createReport({
			id: '.',
			checkoutAliases: ['.'],
			name: '@treeseed/market',
			path: gitRoot,
			relativePath: '.',
			kind: 'project',
			branch,
			branchMode: 'project-save',
			packageJsonPath: null,
			packageJson: null,
			scripts: {},
			remoteUrl: null,
			dependencies: [],
			dependents: [],
			submoduleDependencies: [],
			plannedVersion: null,
			plannedTag: null,
			plannedDependencySpec: null,
		});
	const packageReports = nodes
		.filter((node) => node.id !== rootNode?.id)
		.sort(compareNodes)
		.map((node) => state.reports.get(node.id) ?? createReport(node));

	return {
		mode,
		repositoryScope,
		repositoryIds: nodes.map((node) => node.id),
		branch,
		scope,
		repos: packageReports,
		rootRepo: rootReport,
		waves: waves.map((wave) => wave.map((node) => node.name)),
		plannedVersions: Object.fromEntries(state.finalizedVersions.entries()),
		workflowGates: state.workflowGates,
	};
}

export function repositorySaveErrorDetails(error: unknown) {
	if (error instanceof RepositorySaveError) {
		return {
			exitCode: error.exitCode,
			details: error.details,
		};
	}
	return {
		exitCode: undefined,
		details: undefined,
	};
}
