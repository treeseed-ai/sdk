import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { serializeFrontmatterDocument, parseFrontmatterDocument } from '../../frontmatter.ts';
import {
	applyProjectLaunchHostBindingConfig,
	auditProjectLaunchHostBindingConfig,
	type ApplyProjectLaunchHostBindingConfigOptions,
} from '../services/template-host-bindings.ts';
import { changedPaths } from './create-decision-from-governance-proposal.ts';

export const execFileAsync = promisify(execFile);

export const PLATFORM_CONTENT_COLLECTIONS = ['objectives', 'questions', 'notes', 'proposals', 'decisions', 'agents'] as const;

export const PLATFORM_WORK_CONTENT_COLLECTIONS = ['objectives', 'questions', 'notes', 'proposals', 'decisions'] as const;

export type PlatformContentCollection = (typeof PLATFORM_CONTENT_COLLECTIONS)[number];

export const CONTENT_COLLECTION_SET = new Set<string>(PLATFORM_CONTENT_COLLECTIONS);

export const WORK_CONTENT_COLLECTION_SET = new Set<string>(PLATFORM_WORK_CONTENT_COLLECTIONS);

export const DECISION_TYPE_VALUES = ['approved', 'rejected', 'deferred', 'request_changes', 'superseded'];

export const PROPOSAL_VERDICT_DECISION_TYPES = new Set(['approved', 'rejected', 'deferred', 'request_changes']);

export const CONTENT_DEFAULTS: Record<string, {
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

export const CONTENT_RELATION_POLICIES: Record<string, Record<string, {
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
