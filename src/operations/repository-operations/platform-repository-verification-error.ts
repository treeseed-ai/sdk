import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { serializeFrontmatterDocument, parseFrontmatterDocument } from '../../content/frontmatter.ts';
import {
	applyProjectLaunchHostBindingConfig,
	auditProjectLaunchHostBindingConfig,
	type ApplyProjectLaunchHostBindingConfigOptions,
} from '../services/hosting/deployment/template-host-bindings.ts';
import { CONTENT_COLLECTION_SET, CONTENT_DEFAULTS, CONTENT_RELATION_POLICIES, DECISION_TYPE_VALUES, NormalizedPlatformContentInput, PlatformRepositoryClaim, PlatformRepositoryClaimInput, PlatformRepositoryDescriptor, PlatformRepositoryVerificationResult, execFileAsync } from './exec-file-async.ts';

export class PlatformRepositoryVerificationError extends Error {
	readonly verification: PlatformRepositoryVerificationResult;

	constructor(message: string, verification: PlatformRepositoryVerificationResult) {
		super(message);
		this.name = 'PlatformRepositoryVerificationError';
		this.verification = verification;
	}
}

export function optionalTrimmedString(value: unknown) {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function slugifyPlatformContent(value: unknown) {
	return String(value ?? '')
		.toLowerCase()
		.trim()
		.replace(/['"]/gu, '')
		.replace(/[^a-z0-9]+/gu, '-')
		.replace(/^-+|-+$/gu, '')
		.slice(0, 96);
}

export function enumValue(value: unknown, allowed: string[], fallback: string | null = null) {
	const candidate = typeof value === 'string' ? value.trim() : '';
	return allowed.includes(candidate) ? candidate : fallback;
}

export function normalizePlatformRelationArray(value: unknown): string[] {
	if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean);
	if (typeof value === 'string') return value.split(/[\n,]/u).map((entry) => entry.trim()).filter(Boolean);
	return [];
}

export function uniqueRelationArray(value: unknown) {
	return [...new Set(normalizePlatformRelationArray(value))];
}

export function addRelationValue(frontmatter: Record<string, unknown>, field: string | undefined, value: unknown, single = false) {
	const ref = String(value ?? '').trim();
	if (!field || !ref) return;
	if (single) {
		frontmatter[field] = ref;
		return;
	}
	frontmatter[field] = uniqueRelationArray([...(normalizePlatformRelationArray(frontmatter[field])), ref]);
}

export function platformContentRelationPolicy(parentCollection: string, targetCollection: string) {
	return CONTENT_RELATION_POLICIES[parentCollection]?.[targetCollection] ?? null;
}

export function normalizePlatformContentInput(collection: string, body: Record<string, unknown>): NormalizedPlatformContentInput | { error: string } {
	const defaults = CONTENT_DEFAULTS[collection];
	if (!defaults) return { error: 'Unsupported content collection.' };
	const title = optionalTrimmedString(body.title);
	if (!title) return { error: 'title is required.' };
	const slug = slugifyPlatformContent(body.slug || title);
	if (!slug) return { error: 'A safe slug is required.' };
	const today = new Date().toISOString().slice(0, 10);
	const summary = optionalTrimmedString(body.summary) ?? optionalTrimmedString(body.description) ?? title;
	const description = optionalTrimmedString(body.description) ?? summary;
	const frontmatter: Record<string, unknown> = {
		id: optionalTrimmedString(body.id) ?? `${defaults.idPrefix}:${slug}`,
		title,
		description,
		date: optionalTrimmedString(body.date) ?? today,
		summary,
		status: enumValue(body.status, ['recorded', 'live', 'in progress', 'exploratory', 'planned', 'speculative'], 'planned'),
		...defaults.fields,
	};
	if (collection === 'agents') {
		frontmatter.name = optionalTrimmedString(body.name) ?? title;
		frontmatter.slug = slug;
		frontmatter.description = description;
		frontmatter.summary = summary;
		frontmatter.handler = optionalTrimmedString(body.handler) ?? frontmatter.handler;
		frontmatter.systemPrompt = optionalTrimmedString(body.systemPrompt) ?? frontmatter.systemPrompt;
		frontmatter.runtimeStatus = enumValue(body.runtimeStatus, ['active', 'experimental', 'dormant'], String(frontmatter.runtimeStatus));
		delete frontmatter.date;
		delete frontmatter.status;
	} else if (collection === 'notes') {
		frontmatter.author = optionalTrimmedString(body.author) ?? frontmatter.author;
		frontmatter.relatedObjectives = normalizePlatformRelationArray(body.relatedObjectives);
		frontmatter.relatedQuestions = normalizePlatformRelationArray(body.relatedQuestions);
		frontmatter.relatedProposals = normalizePlatformRelationArray(body.relatedProposals);
	} else if (collection === 'objectives') {
		frontmatter.primaryContributor = optionalTrimmedString(body.primaryContributor) ?? frontmatter.primaryContributor;
		frontmatter.timeHorizon = enumValue(body.timeHorizon, ['near-term', 'mid-term', 'long-term'], String(frontmatter.timeHorizon));
		frontmatter.motivation = optionalTrimmedString(body.motivation) ?? description;
		frontmatter.relatedQuestions = normalizePlatformRelationArray(body.relatedQuestions);
	} else if (collection === 'questions') {
		frontmatter.primaryContributor = optionalTrimmedString(body.primaryContributor) ?? frontmatter.primaryContributor;
		frontmatter.questionType = enumValue(body.questionType, ['research', 'implementation', 'strategy', 'evaluation'], String(frontmatter.questionType));
		frontmatter.motivation = optionalTrimmedString(body.motivation) ?? description;
		frontmatter.relatedObjectives = normalizePlatformRelationArray(body.relatedObjectives);
	} else if (collection === 'proposals') {
		frontmatter.primaryContributor = optionalTrimmedString(body.primaryContributor) ?? frontmatter.primaryContributor;
		frontmatter.proposalType = enumValue(body.proposalType, ['strategy', 'policy', 'implementation', 'research'], String(frontmatter.proposalType));
		frontmatter.motivation = optionalTrimmedString(body.motivation) ?? description;
		frontmatter.relatedObjectives = normalizePlatformRelationArray(body.relatedObjectives);
		frontmatter.relatedQuestions = normalizePlatformRelationArray(body.relatedQuestions);
		frontmatter.relatedNotes = normalizePlatformRelationArray(body.relatedNotes);
		frontmatter.decision = optionalTrimmedString(body.decision) ?? undefined;
		frontmatter.governanceId = optionalTrimmedString(body.governanceId) ?? undefined;
		frontmatter.governanceProviderId = optionalTrimmedString(body.governanceProviderId) ?? undefined;
		frontmatter.governancePolicyId = optionalTrimmedString(body.governancePolicyId) ?? undefined;
		frontmatter.governanceStatus = optionalTrimmedString(body.governanceStatus) ?? undefined;
		frontmatter.proposalVersion = Number.isInteger(Number(body.proposalVersion)) ? Number(body.proposalVersion) : undefined;
		frontmatter.proposalContentHash = optionalTrimmedString(body.proposalContentHash) ?? undefined;
		frontmatter.votingStartsAt = optionalTrimmedString(body.votingStartsAt) ?? undefined;
		frontmatter.votingEndsAt = optionalTrimmedString(body.votingEndsAt) ?? undefined;
	} else if (collection === 'decisions') {
		frontmatter.primaryContributor = optionalTrimmedString(body.primaryContributor) ?? frontmatter.primaryContributor;
		frontmatter.decisionType = enumValue(body.decisionType, DECISION_TYPE_VALUES, String(frontmatter.decisionType));
		frontmatter.rationale = optionalTrimmedString(body.rationale) ?? description;
		frontmatter.authority = optionalTrimmedString(body.authority) ?? frontmatter.authority;
		frontmatter.relatedObjectives = normalizePlatformRelationArray(body.relatedObjectives);
		frontmatter.relatedQuestions = normalizePlatformRelationArray(body.relatedQuestions);
		frontmatter.relatedNotes = normalizePlatformRelationArray(body.relatedNotes);
		frontmatter.relatedProposals = normalizePlatformRelationArray(body.relatedProposals);
		frontmatter.immutable = body.immutable === true ? true : undefined;
		frontmatter.governanceDecisionId = optionalTrimmedString(body.governanceDecisionId) ?? undefined;
		frontmatter.governanceProviderId = optionalTrimmedString(body.governanceProviderId) ?? undefined;
		frontmatter.sourceProposalGovernanceId = optionalTrimmedString(body.sourceProposalGovernanceId) ?? undefined;
		frontmatter.sourceProposalVersion = Number.isInteger(Number(body.sourceProposalVersion)) ? Number(body.sourceProposalVersion) : undefined;
		frontmatter.sourceProposalHash = optionalTrimmedString(body.sourceProposalHash) ?? undefined;
		frontmatter.governanceRule = body.governanceRule && typeof body.governanceRule === 'object' && !Array.isArray(body.governanceRule) ? body.governanceRule : undefined;
		frontmatter.electorateSnapshot = body.electorateSnapshot && typeof body.electorateSnapshot === 'object' && !Array.isArray(body.electorateSnapshot) ? body.electorateSnapshot : undefined;
		frontmatter.voteResult = body.voteResult && typeof body.voteResult === 'object' && !Array.isArray(body.voteResult) ? body.voteResult : undefined;
		frontmatter.voterReasons = Array.isArray(body.voterReasons) ? body.voterReasons : undefined;
		frontmatter.decidedAt = optionalTrimmedString(body.decidedAt) ?? undefined;
		frontmatter.decisionSnapshotHash = optionalTrimmedString(body.decisionSnapshotHash) ?? undefined;
	}
	return {
		slug,
		extension: defaults.extension,
		frontmatter: Object.fromEntries(Object.entries(frontmatter).filter(([, value]) => value !== undefined)),
		body: optionalTrimmedString(body.body) ?? defaults.body,
	};
}

export function derivePlatformRepositoryKey(repository: PlatformRepositoryDescriptor) {
	return [repository.provider ?? 'git', repository.owner ?? 'local', repository.name]
		.join('-')
		.toLowerCase()
		.replace(/[^a-z0-9.-]+/gu, '-')
		.replace(/^-+|-+$/gu, '') || 'repository';
}

export function resolvePlatformRepositoryWorkspacePath(workspaceRoot: string, repository: PlatformRepositoryDescriptor) {
	return resolve(workspaceRoot, 'repositories', derivePlatformRepositoryKey(repository), 'repo');
}

export function createPlatformRepositoryClaim(input: PlatformRepositoryClaimInput): PlatformRepositoryClaim {
	const now = new Date().toISOString();
	const leaseSeconds = Math.max(30, Math.min(Number(input.leaseSeconds ?? 300), 3600));
	const repositoryKey = derivePlatformRepositoryKey(input.repository);
	return {
		id: `${repositoryKey}:${input.runnerId}`,
		repositoryKey,
		runnerId: input.runnerId,
		workspacePath: resolvePlatformRepositoryWorkspacePath(input.workspaceRoot, input.repository),
		branch: input.branch ?? input.repository.defaultBranch ?? null,
		commitSha: input.commitSha ?? null,
		claimState: 'active',
		leaseExpiresAt: new Date(Date.now() + leaseSeconds * 1000).toISOString(),
		metadata: input.metadata ?? {},
		createdAt: now,
		updatedAt: now,
	};
}

export async function runGit(args: string[], cwd: string) {
	const result = await execFileAsync('git', args, {
		cwd,
		env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
		maxBuffer: 1024 * 1024 * 8,
	});
	return `${result.stdout}${result.stderr}`.trim();
}

export async function syncRepository(repository: PlatformRepositoryDescriptor, workspaceRoot: string) {
	const repoPath = resolvePlatformRepositoryWorkspacePath(workspaceRoot, repository);
	const branch = repository.defaultBranch || 'staging';
	await mkdir(dirname(repoPath), { recursive: true });
	if (!existsSync(resolve(repoPath, '.git'))) {
		try {
			await runGit(['clone', '--branch', branch, '--single-branch', repository.cloneUrl, repoPath], workspaceRoot);
		} catch {
			try {
				await runGit(['clone', repository.cloneUrl, repoPath], workspaceRoot);
				await runGit(['checkout', branch], repoPath).catch(() => '');
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (repository.writeMode === 'workspace' && message.includes('ENOENT')) {
					await mkdir(repoPath, { recursive: true });
				} else {
					throw error;
				}
			}
		}
	} else {
		await runGit(['fetch', 'origin', branch, '--prune'], repoPath).catch(() => '');
		await runGit(['checkout', branch], repoPath).catch(() => '');
	}
	return { repoPath, branch };
}

export function contentRoot(repoPath: string, collection: string) {
	if (!CONTENT_COLLECTION_SET.has(collection)) throw new Error('Unsupported content collection.');
	return resolve(repoPath, 'src', 'content', collection);
}

export function safeContentPath(repoPath: string, collection: string, slug: string, extension: 'md' | 'mdx' | null = null) {
	const safeSlug = slugifyPlatformContent(slug);
	if (!safeSlug || safeSlug !== String(slug ?? '').trim()) throw new Error('Unsafe content slug.');
	const root = contentRoot(repoPath, collection);
	const candidates = extension
		? [resolve(root, `${safeSlug}.${extension}`)]
		: ['mdx', 'md'].map((ext) => resolve(root, `${safeSlug}.${ext}`));
	const target = candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
	const relativeTarget = relative(root, target);
	if (relativeTarget === '..' || relativeTarget.startsWith(`..${sep}`) || isAbsolute(relativeTarget)) {
		throw new Error('Unsafe content path.');
	}
	return target;
}

export function assertAllowedPath(repoPath: string, targetPath: string) {
	const relativePath = relative(repoPath, targetPath);
	if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
		throw new Error('Repository operation attempted to write outside the repository workspace.');
	}
	if (!relativePath.startsWith('src/content/')) {
		throw new Error(`Repository operation path is outside src/content: ${relativePath}`);
	}
	return relativePath;
}

export function safeRepositoryRelativePath(repoPath: string, rawPath: unknown) {
	const value = typeof rawPath === 'string' ? rawPath.trim() : '';
	if (!value || value.startsWith('/') || value.includes('\0')) {
		throw new Error('Repository initialization scaffold path must be repository-relative.');
	}
	const target = resolve(repoPath, value);
	const relativePath = relative(repoPath, target);
	if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
		throw new Error(`Repository initialization scaffold path is outside the repository: ${value}`);
	}
	return { target, relativePath };
}

export function secretLookingText(value: string) {
	return /(?:ghp_|github_pat_|sk-[A-Za-z0-9]|xox[baprs]-|BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY|TREESEED_GITHUB_TOKEN\s*=|password\s*=|passphrase\s*=|secretValue|rawSecret|unencrypted)/iu.test(value);
}
