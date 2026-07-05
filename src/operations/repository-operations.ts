import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { serializeFrontmatterDocument, parseFrontmatterDocument } from '../frontmatter.ts';
import {
	applyProjectLaunchHostBindingConfig,
	auditProjectLaunchHostBindingConfig,
	type ApplyProjectLaunchHostBindingConfigOptions,
} from './services/template-host-bindings.ts';

const execFileAsync = promisify(execFile);

export const PLATFORM_CONTENT_COLLECTIONS = ['objectives', 'questions', 'notes', 'proposals', 'decisions', 'agents'] as const;
export const PLATFORM_WORK_CONTENT_COLLECTIONS = ['objectives', 'questions', 'notes', 'proposals', 'decisions'] as const;
export type PlatformContentCollection = (typeof PLATFORM_CONTENT_COLLECTIONS)[number];

const CONTENT_COLLECTION_SET = new Set<string>(PLATFORM_CONTENT_COLLECTIONS);
const WORK_CONTENT_COLLECTION_SET = new Set<string>(PLATFORM_WORK_CONTENT_COLLECTIONS);
const DECISION_TYPE_VALUES = ['approved', 'rejected', 'deferred', 'request_changes', 'superseded'];
const PROPOSAL_VERDICT_DECISION_TYPES = new Set(['approved', 'rejected', 'deferred', 'request_changes']);

const CONTENT_DEFAULTS: Record<string, {
	idPrefix: string;
	extension: 'md' | 'mdx';
	fields: Record<string, unknown>;
	body: string;
}> = {
	objectives: {
		idPrefix: 'objective',
		extension: 'mdx',
		fields: { timeHorizon: 'near-term', motivation: '', primaryContributor: 'market-steward', relatedQuestions: [], relatedBooks: [] },
		body: 'Describe the objective, expected outcome, and the evidence that should update it over time.',
	},
	questions: {
		idPrefix: 'question',
		extension: 'mdx',
		fields: { questionType: 'strategy', motivation: '', primaryContributor: 'market-steward', relatedObjectives: [], relatedBooks: [] },
		body: 'Describe what needs to be learned and what evidence would make the answer useful.',
	},
	notes: {
		idPrefix: 'note',
		extension: 'mdx',
		fields: { author: 'market-steward', relatedObjectives: [], relatedQuestions: [], relatedProposals: [], relatedBooks: [] },
		body: 'Capture the useful context, evidence, and follow-up links for this note.',
	},
	proposals: {
		idPrefix: 'proposal',
		extension: 'mdx',
		fields: { proposalType: 'implementation', motivation: '', primaryContributor: 'market-steward', relatedObjectives: [], relatedQuestions: [], relatedNotes: [], relatedBooks: [], decision: '', supersedes: [] },
		body: 'Describe the proposed change, why it matters, what it affects, and how a reviewer should evaluate it.',
	},
	decisions: {
		idPrefix: 'decision',
		extension: 'mdx',
		fields: { decisionType: 'approved', rationale: '', authority: 'TreeSeed Market Team', primaryContributor: 'market-steward', relatedObjectives: [], relatedQuestions: [], relatedNotes: [], relatedProposals: [], relatedBooks: [], supersedes: [], implements: [] },
		body: 'Record what was decided, why it was decided, and which proposals or evidence it closes.',
	},
	agents: {
		idPrefix: 'agent',
		extension: 'mdx',
		fields: {
			slug: '',
			title: '',
			name: '',
			agentClass: 'general',
			enabled: true,
			operator: 'TreeSeed platform',
			runtimeStatus: 'active',
			capabilities: [],
			tags: ['agent'],
			identity: {
				purpose: '',
				responsibilities: [],
				durableInstructions: 'Keep work observable, governed, and grounded in project content.',
			},
			activityProfiles: {
				planning: {
					enabled: true,
					handler: 'writer',
					prompt: { system: 'Use TreeDX-backed content tools and stay scoped to this project.' },
					branchPolicy: { kind: 'read-only', base: 'main' },
					tools: { allowed: ['treeseed.content.query', 'treeseed.content.read'] },
					outputs: { messageTypes: [], modelMutations: [] },
				},
			},
		},
		body: 'Describe this agent role, operating boundaries, and expected outputs.',
	},
};

const CONTENT_RELATION_POLICIES: Record<string, Record<string, {
	sourceField?: string;
	targetField?: string;
	sourceSingle?: boolean;
	targetSingle?: boolean;
}>> = {
	objectives: {
		questions: { sourceField: 'relatedQuestions', targetField: 'relatedObjectives' },
	},
	questions: {
		objectives: { sourceField: 'relatedObjectives', targetField: 'relatedQuestions' },
	},
	notes: {
		objectives: { sourceField: 'relatedObjectives' },
		questions: { sourceField: 'relatedQuestions' },
		proposals: { sourceField: 'relatedProposals', targetField: 'relatedNotes' },
	},
	proposals: {
		objectives: { sourceField: 'relatedObjectives' },
		questions: { sourceField: 'relatedQuestions' },
		notes: { sourceField: 'relatedNotes', targetField: 'relatedProposals' },
		decisions: { sourceField: 'decision', targetField: 'relatedProposals', sourceSingle: true },
	},
	decisions: {
		objectives: { sourceField: 'relatedObjectives' },
		questions: { sourceField: 'relatedQuestions' },
		notes: { sourceField: 'relatedNotes' },
		proposals: { sourceField: 'relatedProposals', targetField: 'decision', targetSingle: true },
	},
};

export interface PlatformRepositoryDescriptor {
	provider?: 'github' | 'local' | string;
	owner?: string;
	name: string;
	defaultBranch?: string;
	cloneUrl: string;
	writeMode?: 'workspace' | 'branch' | 'direct' | 'pull_request';
	branchName?: string;
	push?: boolean;
	pathPolicies?: PlatformRepositoryPathPolicy[];
	verificationCommands?: PlatformRepositoryVerificationCommand[];
}

export interface PlatformRepositoryPathPolicy {
	allow: string;
}

export interface PlatformRepositoryVerificationCommand {
	command: string;
	args?: string[];
	workingDirectory?: string;
	timeoutMs?: number;
}

export interface PlatformRepositoryClaimInput {
	repository: PlatformRepositoryDescriptor;
	runnerId: string;
	workspaceRoot: string;
	branch?: string | null;
	commitSha?: string | null;
	leaseSeconds?: number;
	metadata?: Record<string, unknown>;
}

export interface PlatformRepositoryClaim {
	id: string;
	repositoryKey: string;
	runnerId: string;
	workspacePath: string;
	branch: string | null;
	commitSha: string | null;
	claimState: 'active' | 'released' | 'expired' | string;
	leaseExpiresAt: string | null;
	metadata: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface PlatformRepositoryOperationInput {
	projectId?: string;
	teamId?: string;
	createdBy?: string;
	repository: PlatformRepositoryDescriptor;
	architecture?: Record<string, unknown>;
	scaffoldFiles?: PlatformRepositoryScaffoldFile[];
	collection?: string;
	parentCollection?: string;
	parentSlug?: string;
	targetCollection?: string;
	proposalSlugs?: string[];
	proposalSlug?: string;
	proposalId?: string;
	proposalVersion?: number;
	proposalContentHash?: string;
	proposalSnapshot?: Record<string, unknown>;
	contentProposalSlug?: string;
	contentDecisionSlug?: string;
	governanceDecision?: Record<string, unknown>;
	governanceDecisionId?: string;
	governanceProviderId?: string;
	governanceRule?: Record<string, unknown>;
	electorateSnapshot?: Record<string, unknown>;
	voteResult?: Record<string, unknown>;
	voterReasons?: Record<string, unknown>[];
	decidedAt?: string;
	decisionSnapshotHash?: string;
	authority?: string;
	decisionType?: string;
	reason?: string;
	title?: string;
	slug?: string;
	normalized?: NormalizedPlatformContentInput;
	payload?: Record<string, unknown>;
	commitMessage?: string;
	approvalRequired?: boolean;
	approvalId?: string;
	hostBindings?: ApplyProjectLaunchHostBindingConfigOptions['hostBindings'];
	hostBindingPlans?: ApplyProjectLaunchHostBindingConfigOptions['hostBindingPlans'];
	launchInput?: ApplyProjectLaunchHostBindingConfigOptions['launchInput'];
	derived?: ApplyProjectLaunchHostBindingConfigOptions['derived'];
}

export interface PlatformRepositoryScaffoldFile {
	path: string;
	content: string;
	overwrite?: boolean;
}

export interface PlatformRepositoryOperationOptions {
	workspaceRoot: string;
	environment?: string;
}

export interface NormalizedPlatformContentInput {
	slug: string;
	extension: 'md' | 'mdx';
	frontmatter: Record<string, unknown>;
	body: string;
}

export interface PlatformRepositoryOperationResult {
	ok: true;
	operation: string;
	repository: {
		key: string;
		provider: string;
		owner: string | null;
		name: string;
		cloneUrl: string;
	};
	baseBranch: string;
	repositoryPath: string;
	workspacePath: string;
	href: string | null;
	branch: string | null;
	operationBranch: string | null;
	commitSha: string | null;
	changedPaths: string[];
	verification: PlatformRepositoryVerificationResult | null;
	pullRequest: null;
	workflowRun: null;
	output: Record<string, unknown>;
}

export interface PlatformRepositoryVerificationResult {
	status: 'passed' | 'failed' | 'skipped';
	commands: Array<{
		command: string;
		args: string[];
		cwd: string;
		exitCode: number;
		stdout: string;
		stderr: string;
	}>;
}

export class PlatformRepositoryVerificationError extends Error {
	readonly verification: PlatformRepositoryVerificationResult;

	constructor(message: string, verification: PlatformRepositoryVerificationResult) {
		super(message);
		this.name = 'PlatformRepositoryVerificationError';
		this.verification = verification;
	}
}

function optionalTrimmedString(value: unknown) {
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

function enumValue(value: unknown, allowed: string[], fallback: string | null = null) {
	const candidate = typeof value === 'string' ? value.trim() : '';
	return allowed.includes(candidate) ? candidate : fallback;
}

export function normalizePlatformRelationArray(value: unknown): string[] {
	if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean);
	if (typeof value === 'string') return value.split(/[\n,]/u).map((entry) => entry.trim()).filter(Boolean);
	return [];
}

function uniqueRelationArray(value: unknown) {
	return [...new Set(normalizePlatformRelationArray(value))];
}

function addRelationValue(frontmatter: Record<string, unknown>, field: string | undefined, value: unknown, single = false) {
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

async function runGit(args: string[], cwd: string) {
	const result = await execFileAsync('git', args, {
		cwd,
		env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
		maxBuffer: 1024 * 1024 * 8,
	});
	return `${result.stdout}${result.stderr}`.trim();
}

async function syncRepository(repository: PlatformRepositoryDescriptor, workspaceRoot: string) {
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

function contentRoot(repoPath: string, collection: string) {
	if (!CONTENT_COLLECTION_SET.has(collection)) throw new Error('Unsupported content collection.');
	return resolve(repoPath, 'src', 'content', collection);
}

function safeContentPath(repoPath: string, collection: string, slug: string, extension: 'md' | 'mdx' | null = null) {
	const safeSlug = slugifyPlatformContent(slug);
	if (!safeSlug || safeSlug !== String(slug ?? '').trim()) throw new Error('Unsafe content slug.');
	const root = contentRoot(repoPath, collection);
	const candidates = extension
		? [resolve(root, `${safeSlug}.${extension}`)]
		: ['mdx', 'md'].map((ext) => resolve(root, `${safeSlug}.${ext}`));
	const target = candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
	const relativeTarget = relative(root, target);
	if (relativeTarget.startsWith('..') || relativeTarget.includes('..') || relativeTarget.startsWith('/')) {
		throw new Error('Unsafe content path.');
	}
	return target;
}

function assertAllowedPath(repoPath: string, targetPath: string) {
	const relativePath = relative(repoPath, targetPath);
	if (relativePath.startsWith('..') || relativePath.includes('..') || relativePath.startsWith('/')) {
		throw new Error('Repository operation attempted to write outside the repository workspace.');
	}
	if (!relativePath.startsWith('src/content/')) {
		throw new Error(`Repository operation path is outside src/content: ${relativePath}`);
	}
	return relativePath;
}

function safeRepositoryRelativePath(repoPath: string, rawPath: unknown) {
	const value = typeof rawPath === 'string' ? rawPath.trim() : '';
	if (!value || value.startsWith('/') || value.includes('\0')) {
		throw new Error('Repository initialization scaffold path must be repository-relative.');
	}
	const target = resolve(repoPath, value);
	const relativePath = relative(repoPath, target);
	if (relativePath.startsWith('..') || relativePath.includes('..') || relativePath.startsWith('/')) {
		throw new Error(`Repository initialization scaffold path is outside the repository: ${value}`);
	}
	return { target, relativePath };
}

function secretLookingText(value: string) {
	return /(?:ghp_|github_pat_|sk-[A-Za-z0-9]|xox[baprs]-|BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY|TREESEED_GITHUB_TOKEN\s*=|password\s*=|passphrase\s*=|secretValue|rawSecret|unencrypted)/iu.test(value);
}

async function initializeLinkedRepository(repoPath: string, input: PlatformRepositoryOperationInput) {
	const architecture = input.architecture && typeof input.architecture === 'object' && !Array.isArray(input.architecture)
		? {
			topology: input.architecture.topology ?? null,
			rootPath: input.architecture.rootPath ?? '.',
			sitePath: input.architecture.sitePath ?? null,
			contentPath: input.architecture.contentPath ?? null,
			contentRuntimeSource: input.architecture.contentRuntimeSource ?? null,
			localContentMaterialization: input.architecture.localContentMaterialization ?? null,
		}
		: null;
	const scaffoldFiles = Array.isArray(input.scaffoldFiles) ? input.scaffoldFiles : [];
	const scaffoldedPaths: string[] = [];
	for (const file of scaffoldFiles) {
		if (!file || typeof file !== 'object') throw new Error('Repository initialization scaffold files must be objects.');
		const content = typeof file.content === 'string' ? file.content : null;
		if (content == null) throw new Error('Repository initialization scaffold file content must be a string.');
		if (secretLookingText(content) || secretLookingText(file.path)) {
			throw new Error('Repository initialization scaffold files must not contain token-like or plaintext secret material.');
		}
		const { target, relativePath } = safeRepositoryRelativePath(repoPath, file.path);
		if (existsSync(target) && file.overwrite !== true) continue;
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, content, 'utf8');
		scaffoldedPaths.push(relativePath);
	}
	return {
		kind: 'linked_repository_initialization',
		projectId: input.projectId ?? null,
		teamId: input.teamId ?? null,
		mode: scaffoldedPaths.length > 0 ? 'template_scaffold' : 'adopt_existing',
		architecture,
		scaffoldedPaths,
	};
}

async function readContentRecord(repoPath: string, collection: string, slug: string) {
	if (!WORK_CONTENT_COLLECTION_SET.has(collection)) throw new Error('Unsupported content collection.');
	const target = safeContentPath(repoPath, collection, slug);
	if (!existsSync(target)) throw new Error('Parent content record was not found.');
	const parsed = parseFrontmatterDocument(await readFile(target, 'utf8'));
	if (!parsed.frontmatter || typeof parsed.frontmatter !== 'object' || Array.isArray(parsed.frontmatter)) {
		throw new Error('Content frontmatter could not be parsed.');
	}
	return {
		path: target,
		slug,
		extension: target.endsWith('.md') ? 'md' : 'mdx',
		frontmatter: parsed.frontmatter,
		body: parsed.body,
	};
}

async function writeParsedRecord(repoPath: string, record: { path: string; frontmatter: Record<string, unknown>; body: string }) {
	const relativePath = assertAllowedPath(repoPath, record.path);
	await mkdir(dirname(record.path), { recursive: true });
	await writeFile(record.path, serializeFrontmatterDocument(record.frontmatter, `\n${String(record.body ?? '').trim()}\n`), 'utf8');
	return relativePath;
}

async function writeContentRecord(repoPath: string, collection: string, input: Record<string, unknown>, normalizedInput?: NormalizedPlatformContentInput) {
	const normalized = normalizedInput ?? normalizePlatformContentInput(collection, input);
	if ('error' in normalized) throw new Error(normalized.error);
	const root = contentRoot(repoPath, collection);
	const existingTarget = input.overwrite === true
		? [`${normalized.slug}.mdx`, `${normalized.slug}.md`]
			.map((file) => resolve(root, file))
			.find((candidate) => existsSync(candidate))
		: null;
	const target = existingTarget ?? safeContentPath(repoPath, collection, normalized.slug, normalized.extension);
	if (existsSync(target) && input.overwrite !== true) throw new Error('A content record with that slug already exists.');
	const frontmatter = existingTarget && input.preserveFrontmatter === true
		? {
			...normalized.frontmatter,
			...(await readContentRecord(repoPath, collection, normalized.slug)).frontmatter,
		}
		: normalized.frontmatter;
	const relativePath = await writeParsedRecord(repoPath, {
		path: target,
		frontmatter,
		body: normalized.body,
	});
	return {
		collection,
		slug: normalized.slug,
		id: frontmatter.id,
		path: relativePath,
		href: collection === 'agents'
			? `/app/projects/${encodeURIComponent(String(input.projectId ?? ''))}/agents/${encodeURIComponent(normalized.slug)}`
			: `/app/work/${collection}/${encodeURIComponent(normalized.slug)}`,
	};
}

async function createRelatedContent(repoPath: string, input: PlatformRepositoryOperationInput) {
	const parentCollection = String(input.parentCollection ?? '');
	const targetCollection = String(input.targetCollection ?? input.collection ?? '');
	if (!WORK_CONTENT_COLLECTION_SET.has(parentCollection) || !WORK_CONTENT_COLLECTION_SET.has(targetCollection)) {
		throw new Error('Unsupported content relation collection.');
	}
	const policy = platformContentRelationPolicy(parentCollection, targetCollection);
	if (!policy) throw new Error(`Cannot create related ${targetCollection} from ${parentCollection}.`);
	const parentSlug = optionalTrimmedString(input.parentSlug);
	if (!parentSlug) throw new Error('parentSlug is required.');
	const parent = await readContentRecord(repoPath, parentCollection, parentSlug);
	const normalized = input.normalized ?? normalizePlatformContentInput(targetCollection, input.payload ?? {});
	if ('error' in normalized) throw new Error(normalized.error);
	const childTarget = safeContentPath(repoPath, targetCollection, normalized.slug, normalized.extension);
	if (existsSync(childTarget)) throw new Error('A content record with that slug already exists.');
	addRelationValue(parent.frontmatter, policy.sourceField, normalized.slug, policy.sourceSingle);
	addRelationValue(normalized.frontmatter, policy.targetField, parent.slug, policy.targetSingle);
	await mkdir(contentRoot(repoPath, targetCollection), { recursive: true });
	const child = {
		path: childTarget,
		frontmatter: normalized.frontmatter,
		body: normalized.body,
	};
	const originalParent = { ...parent, frontmatter: { ...parent.frontmatter }, body: parent.body };
	const changedPaths = [];
	try {
		changedPaths.push(await writeParsedRecord(repoPath, child));
		changedPaths.push(await writeParsedRecord(repoPath, parent));
	} catch (error) {
		await rm(childTarget, { force: true }).catch(() => {});
		await writeParsedRecord(repoPath, originalParent).catch(() => {});
		throw error;
	}
	return {
		parent: {
			collection: parentCollection,
			slug: parent.slug,
			path: relative(repoPath, parent.path),
			href: `/app/work/${parentCollection}/${encodeURIComponent(parent.slug)}`,
		},
		child: {
			collection: targetCollection,
			slug: normalized.slug,
			id: normalized.frontmatter.id,
			path: relative(repoPath, childTarget),
			href: `/app/work/${targetCollection}/${encodeURIComponent(normalized.slug)}`,
		},
		relation: {
			parentField: policy.sourceField,
			childField: policy.targetField,
		},
		changedPaths,
	};
}

async function createDecisionFromProposals(repoPath: string, input: PlatformRepositoryOperationInput) {
	const proposalSlugs = [...new Set(normalizePlatformRelationArray(input.proposalSlugs ?? input.payload?.proposalSlugs))];
	if (proposalSlugs.length === 0) throw new Error('Select at least one proposal.');
	for (const slug of proposalSlugs) {
		if (!slug || slugifyPlatformContent(slug) !== slug) throw new Error('Unsafe proposal slug.');
	}
	const decisionType = enumValue(input.decisionType ?? input.payload?.decisionType, [...PROPOSAL_VERDICT_DECISION_TYPES], null);
	if (!decisionType) throw new Error('Unsupported proposal verdict.');
	const reason = optionalTrimmedString(input.reason) ?? optionalTrimmedString(input.payload?.reason) ?? optionalTrimmedString(input.payload?.rationale);
	if (!reason) throw new Error('A decision reason is required.');
	const title = optionalTrimmedString(input.title) ?? optionalTrimmedString(input.payload?.title) ?? `Decision for ${proposalSlugs.length === 1 ? proposalSlugs[0] : `${proposalSlugs.length} proposals`}`;
	const decisionSlug = slugifyPlatformContent(input.slug || input.payload?.slug || title);
	if (!decisionSlug) throw new Error('A safe decision slug is required.');
	const decisionTarget = safeContentPath(repoPath, 'decisions', decisionSlug, 'mdx');
	if (existsSync(decisionTarget)) throw new Error('A decision with that slug already exists.');
	const proposals = [];
	for (const slug of proposalSlugs) {
		try {
			proposals.push(await readContentRecord(repoPath, 'proposals', slug));
		} catch {
			throw new Error(`Proposal ${slug} was not found.`);
		}
	}
	const proposalTitles = proposals.map((proposal) => proposal.frontmatter.title ?? proposal.slug);
	const body = optionalTrimmedString(input.payload?.body)
		?? [
			'## Verdict',
			decisionType.replace(/_/gu, ' '),
			'',
			'## Reason',
			reason,
			'',
			'## Proposals',
			...proposalTitles.map((proposalTitle, index) => `- ${proposalTitle} (${proposalSlugs[index]})`),
		].join('\n');
	const decision = await writeContentRecord(repoPath, 'decisions', {
		...(input.payload ?? {}),
		projectId: input.projectId,
		slug: decisionSlug,
		title,
		status: 'live',
		decisionType,
		description: optionalTrimmedString(input.payload?.description) ?? reason,
		summary: optionalTrimmedString(input.payload?.summary) ?? reason,
		rationale: reason,
		relatedProposals: proposalSlugs,
		body,
	});
	const writtenProposals = [];
	const originalProposals = proposals.map((proposal) => ({
		...proposal,
		frontmatter: { ...proposal.frontmatter },
		body: proposal.body,
	}));
	const changedPaths = [decision.path];
	try {
		for (const proposal of proposals) {
			proposal.frontmatter.decision = decisionSlug;
			changedPaths.push(await writeParsedRecord(repoPath, proposal));
			writtenProposals.push(proposal);
		}
	} catch (error) {
		await rm(decisionTarget, { force: true }).catch(() => {});
		for (const original of originalProposals.slice(0, writtenProposals.length)) {
			await writeParsedRecord(repoPath, original).catch(() => {});
		}
		throw error;
	}
	return {
		decision,
		proposals: proposalSlugs.map((slug) => ({ collection: 'proposals', slug, href: `/app/work/proposals/${encodeURIComponent(slug)}` })),
		href: decision.href,
		changedPaths,
	};
}

async function createDecisionFromGovernanceProposal(repoPath: string, input: PlatformRepositoryOperationInput) {
	const proposalSnapshot = input.proposalSnapshot && typeof input.proposalSnapshot === 'object' ? input.proposalSnapshot as Record<string, unknown> : {};
	const governanceDecision = input.governanceDecision && typeof input.governanceDecision === 'object' ? input.governanceDecision as Record<string, unknown> : {};
	const proposalSlug = slugifyPlatformContent(
		input.contentProposalSlug
		?? input.proposalSlug
		?? proposalSnapshot.slug
		?? proposalSnapshot.contentProposalSlug
		?? governanceDecision.contentProposalSlug
		?? '',
	);
	if (!proposalSlug) throw new Error('A safe source proposal slug is required.');
	const sourceHash = optionalTrimmedString(input.proposalContentHash)
		?? optionalTrimmedString(proposalSnapshot.contentHash)
		?? optionalTrimmedString(proposalSnapshot.proposalContentHash);
	if (!sourceHash) throw new Error('Accepted proposal content hash is required.');
	const proposalVersion = Number(input.proposalVersion ?? proposalSnapshot.version ?? proposalSnapshot.proposalVersion ?? 1);
	if (!Number.isInteger(proposalVersion) || proposalVersion < 1) throw new Error('Accepted proposal version is invalid.');
	const title = optionalTrimmedString(input.title)
		?? optionalTrimmedString(governanceDecision.title)
		?? optionalTrimmedString(proposalSnapshot.title)
		?? `Decision for ${proposalSlug}`;
	const summary = optionalTrimmedString(input.summary)
		?? optionalTrimmedString(governanceDecision.summary)
		?? optionalTrimmedString(proposalSnapshot.summary)
		?? 'Accepted governance decision.';
	const decisionSlug = slugifyPlatformContent(input.slug || input.contentDecisionSlug || governanceDecision.contentDecisionSlug || title);
	if (!decisionSlug) throw new Error('A safe decision slug is required.');
	const decisionTarget = safeContentPath(repoPath, 'decisions', decisionSlug, 'mdx');
	if (existsSync(decisionTarget)) throw new Error('A decision with that slug already exists.');
	let proposal = null;
	try {
		proposal = await readContentRecord(repoPath, 'proposals', proposalSlug);
	} catch {
		throw new Error(`Proposal ${proposalSlug} was not found.`);
	}
	const voteResult = input.voteResult && typeof input.voteResult === 'object' ? input.voteResult : governanceDecision.voteResult ?? {};
	const voterReasons = Array.isArray(input.voterReasons) ? input.voterReasons : Array.isArray(governanceDecision.voterReasons) ? governanceDecision.voterReasons : [];
	const decidedAt = optionalTrimmedString(input.decidedAt) ?? new Date().toISOString();
	const body = optionalTrimmedString(input.payload?.body)
		?? [
			'## Accepted Proposal Snapshot',
			optionalTrimmedString(proposalSnapshot.body) ?? proposal.body.trim(),
			'',
			'## Governance Result',
			JSON.stringify(voteResult, null, 2),
		].join('\n');
	const decision = await writeContentRecord(repoPath, 'decisions', {
		...(input.payload ?? {}),
		projectId: input.projectId,
		teamId: input.teamId,
		slug: decisionSlug,
		title,
		status: 'live',
		decisionType: 'approved',
		description: optionalTrimmedString(input.payload?.description) ?? summary,
		summary,
		rationale: optionalTrimmedString(input.reason) ?? 'Accepted by governance.',
		authority: optionalTrimmedString(input.authority) ?? 'governance',
		relatedProposals: [proposalSlug],
		immutable: true,
		governanceDecisionId: optionalTrimmedString(input.governanceDecisionId) ?? optionalTrimmedString(governanceDecision.id),
		governanceProviderId: optionalTrimmedString(input.governanceProviderId) ?? optionalTrimmedString(governanceDecision.governanceProviderId),
		sourceProposalGovernanceId: optionalTrimmedString(input.proposalId) ?? optionalTrimmedString(governanceDecision.proposalId),
		sourceProposalVersion: proposalVersion,
		sourceProposalHash: sourceHash,
		governanceRule: input.governanceRule ?? governanceDecision.governanceRule ?? {},
		electorateSnapshot: input.electorateSnapshot ?? governanceDecision.electorateSnapshot ?? {},
		voteResult,
		voterReasons,
		decidedAt,
		decisionSnapshotHash: optionalTrimmedString(input.decisionSnapshotHash),
		body,
	});
	const originalProposal = {
		...proposal,
		frontmatter: { ...proposal.frontmatter },
		body: proposal.body,
	};
	const changedPaths = [decision.path];
	try {
		proposal.frontmatter.decision = decisionSlug;
		proposal.frontmatter.governanceStatus = 'accepted';
		proposal.frontmatter.proposalVersion = proposalVersion;
		proposal.frontmatter.proposalContentHash = sourceHash;
		changedPaths.push(await writeParsedRecord(repoPath, proposal));
	} catch (error) {
		await rm(decisionTarget, { force: true }).catch(() => {});
		await writeParsedRecord(repoPath, originalProposal).catch(() => {});
		throw error;
	}
	return {
		decision,
		proposal: { collection: 'proposals', slug: proposalSlug, href: `/app/work/proposals/${encodeURIComponent(proposalSlug)}` },
		href: decision.href,
		changedPaths,
	};
}

async function changedPaths(repoPath: string) {
	const output = await runGit(['status', '--porcelain', '--untracked-files=all'], repoPath).catch(() => '');
	return output
		.split('\n')
		.map((line) => line.slice(3).trim())
		.filter(Boolean);
}

function changedPathsFromOutput(output: Record<string, unknown>) {
	const paths = [];
	if (typeof output.record === 'object' && output.record && !Array.isArray(output.record) && typeof (output.record as Record<string, unknown>).path === 'string') {
		paths.push(String((output.record as Record<string, unknown>).path));
	}
	if (Array.isArray(output.changedPaths)) {
		paths.push(...output.changedPaths.map((entry) => String(entry)));
	}
	return [...new Set(paths.filter(Boolean))];
}

async function commitIfRequested(repoPath: string, repository: PlatformRepositoryDescriptor, input: PlatformRepositoryOperationInput, changed: string[]) {
	if (repository.writeMode !== 'branch') return { branch: null, commitSha: null };
	const branchName = repository.branchName || `treeseed/platform-${Date.now()}`;
	if (!/^[-/._a-zA-Z0-9]{1,120}$/u.test(branchName) || branchName.includes('..') || branchName.startsWith('/') || branchName.endsWith('/')) {
		throw new Error('Repository branch name is outside the allowed platform operation policy.');
	}
	await runGit(['checkout', '-B', branchName], repoPath);
	if (changed.length === 0) return { branch: branchName, commitSha: null };
	await runGit(['add', '--', ...changed], repoPath);
	await runGit([
		'-c',
		'user.name=TreeSeed Platform Runner',
		'-c',
		'user.email=platform-runner@treeseed.local',
		'commit',
		'-m',
		input.commitMessage || `TreeSeed platform operation: ${input.projectId ?? 'repository'}`,
	], repoPath).catch((error) => {
		const message = error instanceof Error ? error.message : String(error);
		if (!message.includes('nothing to commit')) throw error;
	});
	const commitSha = (await runGit(['rev-parse', 'HEAD'], repoPath)).trim();
	if (repository.push === true) {
		await runGit(['push', 'origin', branchName], repoPath);
	}
	return { branch: branchName, commitSha };
}

function commandOutput(value: unknown) {
	return String(value ?? '').slice(0, 12_000);
}

async function runVerificationCommands(repoPath: string, repository: PlatformRepositoryDescriptor): Promise<PlatformRepositoryVerificationResult | null> {
	const commands = Array.isArray(repository.verificationCommands)
		? repository.verificationCommands.filter((command) => command && typeof command.command === 'string' && command.command.trim())
		: [];
	if (commands.length === 0) return null;
	const results: PlatformRepositoryVerificationResult['commands'] = [];
	for (const command of commands) {
		const args = Array.isArray(command.args) ? command.args.map(String) : [];
		const cwd = resolve(repoPath, command.workingDirectory ?? '.');
		const relativeCwd = relative(repoPath, cwd);
		if (relativeCwd.startsWith('..') || relativeCwd.includes('..') || relativeCwd.startsWith('/')) {
			throw new Error('Repository verification command attempted to run outside the repository workspace.');
		}
		try {
			const result = await execFileAsync(command.command, args, {
				cwd,
				env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
				timeout: Math.max(1000, Math.min(Number(command.timeoutMs ?? 120_000), 600_000)),
				maxBuffer: 1024 * 1024 * 8,
			});
			results.push({
				command: command.command,
				args,
				cwd: relative(repoPath, cwd) || '.',
				exitCode: 0,
				stdout: commandOutput(result.stdout),
				stderr: commandOutput(result.stderr),
			});
		} catch (error) {
			const failure = error as Error & { code?: string | number; stdout?: unknown; stderr?: unknown };
			results.push({
				command: command.command,
				args,
				cwd: relative(repoPath, cwd) || '.',
				exitCode: Number(failure.code ?? 1) || 1,
				stdout: commandOutput(failure.stdout),
				stderr: commandOutput(failure.stderr ?? failure.message),
			});
			const verification: PlatformRepositoryVerificationResult = { status: 'failed', commands: results };
			throw new PlatformRepositoryVerificationError(`Repository verification failed for "${command.command}".`, verification);
		}
	}
	return { status: 'passed', commands: results };
}

function assertRepositoryWriteMode(input: PlatformRepositoryOperationInput, options: PlatformRepositoryOperationOptions) {
	const mode = input.repository.writeMode ?? 'workspace';
	if (mode === 'direct' || mode === 'pull_request') {
		throw new Error(`Repository write mode "${mode}" is not enabled for platform runner operations.`);
	}
	if (!['workspace', 'branch'].includes(mode)) {
		throw new Error(`Unsupported repository write mode "${mode}".`);
	}
	const environment = String(options.environment ?? '').toLowerCase();
	const approvalGated = input.approvalRequired === true && Boolean(input.approvalId || input.payload?.approvalId);
	if (input.repository.push === true && !approvalGated) {
		throw new Error('Repository push requires an approval-gated platform operation.');
	}
	if ((environment === 'prod' || environment === 'production') && input.repository.push === true) {
		throw new Error('Production repository push is disabled for this platform runner slice.');
	}
}

function outputHref(output: Record<string, unknown>) {
	if (typeof output.href === 'string' && output.href.trim()) return output.href.trim();
	for (const key of ['record', 'child', 'decision']) {
		const value = output[key];
		if (value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>).href === 'string') {
			return String((value as Record<string, unknown>).href).trim();
		}
	}
	return null;
}

const HOST_BINDING_CONFIG_PATHS = new Set([
	'treeseed.site.yaml',
	'src/env.yaml',
	'src/manifest.yaml',
	'package.json',
]);

function assertHostBindingChangedPaths(changed: string[]) {
	for (const changedPath of changed) {
		if (!HOST_BINDING_CONFIG_PATHS.has(changedPath)) {
			throw new Error(`Host binding repository operation attempted to change unsupported path "${changedPath}".`);
		}
	}
}

export async function executePlatformRepositoryOperation(
	operation: 'write_content_record' | 'create_related_content' | 'create_decision_from_proposals' | 'create_decision_from_governance_proposal' | 'apply_host_binding_config' | 'audit_host_binding_config' | string,
	input: PlatformRepositoryOperationInput,
	options: PlatformRepositoryOperationOptions,
): Promise<PlatformRepositoryOperationResult> {
	if (!input.repository?.cloneUrl || !input.repository.name) {
		throw new Error('Repository operation requires a repository descriptor with name and cloneUrl.');
	}
	assertRepositoryWriteMode(input, options);
	const { repoPath, branch: baseBranch } = await syncRepository(input.repository, options.workspaceRoot);
	let output: Record<string, unknown>;
	if (operation === 'write_content_record') {
		const collection = String(input.collection ?? '');
		const record = await writeContentRecord(repoPath, collection, {
			...(input.payload ?? {}),
			projectId: input.projectId,
			teamId: input.teamId,
			createdBy: input.createdBy,
		}, input.normalized);
		output = { record };
	} else if (operation === 'create_related_content') {
		output = await createRelatedContent(repoPath, input);
	} else if (operation === 'create_decision_from_proposals') {
		output = await createDecisionFromProposals(repoPath, input);
	} else if (operation === 'create_decision_from_governance_proposal') {
		output = await createDecisionFromGovernanceProposal(repoPath, input);
	} else if (operation === 'apply_host_binding_config') {
		const hostBindingConfig = applyProjectLaunchHostBindingConfig({
			projectRoot: repoPath,
			hostBindings: input.hostBindings,
			hostBindingPlans: input.hostBindingPlans,
			launchInput: input.launchInput,
			derived: input.derived,
		});
		output = {
			hostBindingConfig,
			changedPaths: hostBindingConfig.targets,
		};
	} else if (operation === 'audit_host_binding_config') {
		const hostBindingAudit = auditProjectLaunchHostBindingConfig({
			projectRoot: repoPath,
			hostBindings: input.hostBindings,
			hostBindingPlans: input.hostBindingPlans,
			launchInput: input.launchInput,
			derived: input.derived,
		});
		output = {
			hostBindingAudit,
			changedPaths: [],
		};
	} else if (operation === 'initialize_linked_repository') {
		output = await initializeLinkedRepository(repoPath, input);
	} else {
		throw new Error(`Unsupported repository operation "${operation}".`);
	}
	const gitChanged = await changedPaths(repoPath);
	const changed = gitChanged.length > 0 ? gitChanged : changedPathsFromOutput(output);
	if (operation === 'apply_host_binding_config' || operation === 'audit_host_binding_config') {
		assertHostBindingChangedPaths(changed);
	}
	const verification = await runVerificationCommands(repoPath, input.repository);
	const commit = await commitIfRequested(repoPath, input.repository, input, changed);
	return {
		ok: true,
		operation,
		repository: {
			key: derivePlatformRepositoryKey(input.repository),
			provider: input.repository.provider ?? 'git',
			owner: input.repository.owner ?? null,
			name: input.repository.name,
			cloneUrl: input.repository.cloneUrl,
		},
		baseBranch,
		repositoryPath: repoPath,
		workspacePath: options.workspaceRoot,
		href: outputHref(output),
		branch: commit.branch ?? baseBranch,
		operationBranch: commit.branch,
		commitSha: commit.commitSha,
		changedPaths: changed,
		verification,
		pullRequest: null,
		workflowRun: null,
		output,
	};
}
