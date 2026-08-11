import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { UnitVerificationResult } from '../../reconcile/support/contracts/contracts.js';
import { CONTENT_PUBLICATION_CONTRACT } from '../../platform/published-content/publication-contracts.js';
import { credentialEnvironment, git, migrationCredential, remoteHead } from './repository-history.js';
import type { SeedManifest } from '../types.js';

type HistoryReceipt = {
	branch: string;
	sourceCommit: string | null;
	contentPath: string | null;
	targetCommit: string | null;
	verified: boolean;
};

type PublicationReceipt = {
	repository: string;
	contract: string;
	projectId: string;
	sourceCommit: string;
	revision: string;
	verified: boolean;
};

export type ContentCutoverEvidence = {
	project: string;
	branch: string;
	sourceRepository: string;
	targetRepository: string;
	contentPath: string | null;
	sourceCommit: string | null;
	targetCommit: string | null;
	sourceTree: string | null;
	targetTree: string | null;
	historyVerified: boolean;
	publicationContract: string | null;
	publicationRevision: string | null;
	publicationVerified: boolean;
	treeDxResolvedRef: string | null;
	treeDxVerified: boolean;
};

export type ContentCutoverPlan = ContentCutoverEvidence & {
	status: 'ready' | 'blocked';
	blockers: string[];
};

function readJson<T>(path: string): T | null {
	try {
		return JSON.parse(readFileSync(path, 'utf8')) as T;
	} catch {
		return null;
	}
}

function historyPath(root: string, repository: string) {
	return resolve(root, '.treeseed', 'repository-migrations', `${repository.replace('/', '--')}.json`);
}

function publicationPath(root: string, seed: string, branch: string) {
	return resolve(root, '.treeseed', 'content-publications', seed, `${branch}.json`);
}

function cutoverPath(root: string, repository: string, branch: string) {
	return resolve(root, '.treeseed', 'content-cutovers', `${repository.replace('/', '--')}--${branch}.json`);
}

function verificationCheck(verification: UnitVerificationResult | null | undefined, key: string) {
	return verification?.checks.find((check) => check.key === key) ?? null;
}

function resolvedRef(check: ReturnType<typeof verificationCheck>) {
	if (!check) return null;
	if (typeof check.observed === 'string') return check.observed;
	if (check.observed && typeof check.observed === 'object' && 'resolvedRef' in check.observed) {
		const value = (check.observed as { resolvedRef?: unknown }).resolvedRef;
		return typeof value === 'string' ? value : null;
	}
	return null;
}

export function classifyContentCutover(evidence: ContentCutoverEvidence): ContentCutoverPlan {
	const blockers = [
		!evidence.sourceCommit ? 'The live software branch is missing.' : null,
		!evidence.targetCommit ? 'The live content branch is missing.' : null,
		!evidence.sourceTree ? 'The live software branch has no legacy content tree to verify.' : null,
		evidence.sourceTree !== evidence.targetTree ? 'The software and content repository trees differ.' : null,
		!evidence.historyVerified ? 'The exact content-history migration receipt is not verified.' : null,
		evidence.publicationContract !== CONTENT_PUBLICATION_CONTRACT ? `The R2 publication is not ${CONTENT_PUBLICATION_CONTRACT}.` : null,
		!evidence.publicationVerified ? 'The R2 publication receipt is not verified at the live content commit.' : null,
		!evidence.treeDxVerified ? 'TreeDX has not freshly verified graph, search, and content at the live content commit.' : null,
	].filter((value): value is string => Boolean(value));
	return { ...evidence, status: blockers.length ? 'blocked' : 'ready', blockers };
}

export async function planContentCutover(input: {
	projectRoot: string;
	manifest: SeedManifest;
	seed: string;
	project: string;
	branch: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	treeDxVerification?: UnitVerificationResult | null;
	treeDxObservedRef?: string | null;
}) {
	const project = input.manifest.resources.projects.find((entry) => entry.slug === input.project);
	if (!project) throw new Error(`Seed ${input.seed} does not declare project ${input.project}.`);
	const target = input.manifest.resources.hubRepositories.find((entry) => entry.project === project.key && entry.role === 'content');
	if (!target) throw new Error(`Project ${input.project} does not declare a content repository.`);
	const sourceRepository = `${project.repository.owner}/${project.repository.name}`;
	const targetRepository = `${target.owner}/${target.name}`;
	const credential = migrationCredential(input.projectRoot, targetRepository, input.env);
	if (!credential.token) throw new Error(`Central GitHub credential ${credential.envName} is required for ${targetRepository}.`);
	const environment = credentialEnvironment(credential.token);
	const sourceCommit = await remoteHead(input.projectRoot, sourceRepository, input.branch, environment);
	const targetCommit = await remoteHead(input.projectRoot, targetRepository, input.branch, environment);
	for (const [repository, commit] of [[sourceRepository, sourceCommit], [targetRepository, targetCommit]] as const) {
		if (commit && (await git(input.projectRoot, ['cat-file', '-e', `${commit}^{commit}`], { allowFailure: true })).code !== 0) {
			await git(input.projectRoot, ['fetch', '--quiet', '--no-tags', `https://github.com/${repository}.git`, commit], { env: environment });
		}
	}
	let contentPath: string | null = null;
	for (const candidate of ['docs/src/content', 'src/content']) {
		if (sourceCommit && (await git(input.projectRoot, ['cat-file', '-e', `${sourceCommit}:${candidate}`], { allowFailure: true })).code === 0) {
			contentPath = candidate;
			break;
		}
	}
	const tree = async (commit: string | null, path: string | null) => {
		if (!commit || !path) return null;
		const result = await git(input.projectRoot, ['rev-parse', `${commit}:${path}`], { allowFailure: true });
		return result.code === 0 ? result.stdout : null;
	};
	const sourceTree = await tree(sourceCommit, contentPath);
	const targetTree = await tree(targetCommit, 'src/content');
	const history = readJson<{ receipts?: HistoryReceipt[] }>(historyPath(input.projectRoot, targetRepository));
	const historyReceipt = history?.receipts?.find((entry) => entry.branch === input.branch);
	const publications = readJson<{ receipts?: PublicationReceipt[] }>(publicationPath(input.projectRoot, input.seed, input.branch));
	const publication = publications?.receipts?.find((entry) => entry.projectId === input.project && entry.repository === targetRepository);
	const liveRef = verificationCheck(input.treeDxVerification, `treedx-live-ref:${input.project}`);
	const content = verificationCheck(input.treeDxVerification, `treedx-content:${input.project}`);
	const treeDxResolvedRef = resolvedRef(content) ?? resolvedRef(liveRef) ?? input.treeDxObservedRef ?? null;
	const prior = readJson<{ verified?: boolean; evidence?: ContentCutoverEvidence }>(cutoverPath(input.projectRoot, targetRepository, input.branch));
	const priorTreeDxVerification = Boolean(
		prior?.verified
		&& prior.evidence?.treeDxVerified
		&& prior.evidence.targetCommit === targetCommit
		&& prior.evidence.sourceTree === sourceTree
		&& prior.evidence.targetTree === targetTree
		&& prior.evidence.publicationRevision === publication?.revision
		&& treeDxResolvedRef === targetCommit,
	);
	return classifyContentCutover({
		project: input.project,
		branch: input.branch,
		sourceRepository,
		targetRepository,
		contentPath,
		sourceCommit,
		targetCommit,
		sourceTree,
		targetTree,
		historyVerified: Boolean(historyReceipt?.verified && historyReceipt.targetCommit === targetCommit && historyReceipt.contentPath === contentPath),
		publicationContract: publication?.contract ?? null,
		publicationRevision: publication?.revision ?? null,
		publicationVerified: Boolean(publication?.verified && publication.sourceCommit === targetCommit),
		treeDxResolvedRef,
		treeDxVerified: priorTreeDxVerification || Boolean(input.treeDxVerification?.verified && liveRef?.verified && content?.verified && treeDxResolvedRef === targetCommit),
	});
}

export function recordContentCutover(projectRoot: string, plan: ContentCutoverPlan) {
	if (plan.status !== 'ready') throw new Error(plan.blockers.join(' '));
	const path = cutoverPath(projectRoot, plan.targetRepository, plan.branch);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ contract: 'treeseed.content-cutover/v1', verified: true, verifiedAt: new Date().toISOString(), evidence: plan }, null, 2)}\n`, 'utf8');
	return path;
}

export async function removeVerifiedSoftwareContent(input: {
	projectRoot: string;
	manifest: SeedManifest;
	plan: ContentCutoverPlan;
}) {
	if (input.plan.status !== 'ready' || !input.plan.contentPath || !input.plan.sourceTree) {
		throw new Error('Software content removal requires a ready cutover plan with an exact source tree.');
	}
	const project = input.manifest.resources.projects.find((entry) => entry.slug === input.plan.project);
	const checkoutPath = project?.repository.checkoutPath;
	if (!project || !checkoutPath) throw new Error(`Project ${input.plan.project} has no removable software checkout.`);
	const checkout = resolve(input.projectRoot, checkoutPath);
	const content = resolve(checkout, input.plan.contentPath);
	if (!content.startsWith(`${checkout}/`)) throw new Error('Software content path escapes the project checkout.');
	const dirty = await git(checkout, ['status', '--porcelain=v1', '--', input.plan.contentPath], { allowFailure: true });
	if (dirty.code !== 0 || dirty.stdout) throw new Error('The legacy software content path has uncommitted changes.');
	const localTree = await git(checkout, ['rev-parse', `HEAD:${input.plan.contentPath}`], { allowFailure: true });
	if (localTree.code !== 0 || localTree.stdout !== input.plan.sourceTree) {
		throw new Error('The local legacy content tree differs from the verified live source tree.');
	}
	rmSync(content, { recursive: true });
	const path = cutoverPath(input.projectRoot, input.plan.targetRepository, input.plan.branch);
	writeFileSync(path, `${JSON.stringify({ contract: 'treeseed.content-cutover/v1', verified: true, softwarePathRemoved: true, removedAt: new Date().toISOString(), evidence: input.plan }, null, 2)}\n`, 'utf8');
	return { path: input.plan.contentPath, journalPath: path };
}
