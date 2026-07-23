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
import { PlatformRepositoryDescriptor, PlatformRepositoryOperationInput, PlatformRepositoryOperationOptions, PlatformRepositoryVerificationResult, execFileAsync } from './exec-file-async.ts';
import { PlatformRepositoryVerificationError, optionalTrimmedString, runGit, safeContentPath, slugifyPlatformContent } from './platform-repository-verification-error.ts';
import { readContentRecord, writeContentRecord, writeParsedRecord } from './initialize-linked-repository.ts';

export async function createDecisionFromGovernanceProposal(repoPath: string, input: PlatformRepositoryOperationInput) {
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

export async function changedPaths(repoPath: string) {
	const output = await runGit(['status', '--porcelain', '--untracked-files=all'], repoPath).catch(() => '');
	return output
		.split('\n')
		.map((line) => line.slice(3).trim())
		.filter(Boolean);
}

export function changedPathsFromOutput(output: Record<string, unknown>) {
	const paths = [];
	if (typeof output.record === 'object' && output.record && !Array.isArray(output.record) && typeof (output.record as Record<string, unknown>).path === 'string') {
		paths.push(String((output.record as Record<string, unknown>).path));
	}
	if (Array.isArray(output.changedPaths)) {
		paths.push(...output.changedPaths.map((entry) => String(entry)));
	}
	return [...new Set(paths.filter(Boolean))];
}

export async function commitIfRequested(repoPath: string, repository: PlatformRepositoryDescriptor, input: PlatformRepositoryOperationInput, changed: string[]) {
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

export function commandOutput(value: unknown) {
	return String(value ?? '').slice(0, 12_000);
}

export async function runVerificationCommands(repoPath: string, repository: PlatformRepositoryDescriptor): Promise<PlatformRepositoryVerificationResult | null> {
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

export function assertRepositoryWriteMode(input: PlatformRepositoryOperationInput, options: PlatformRepositoryOperationOptions) {
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

export function outputHref(output: Record<string, unknown>) {
	if (typeof output.href === 'string' && output.href.trim()) return output.href.trim();
	for (const key of ['record', 'child', 'decision']) {
		const value = output[key];
		if (value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>).href === 'string') {
			return String((value as Record<string, unknown>).href).trim();
		}
	}
	return null;
}

export const HOST_BINDING_CONFIG_PATHS = new Set([
	'treeseed.site.yaml',
	'src/env.yaml',
	'src/manifest.yaml',
	'package.json',
]);

export function assertHostBindingChangedPaths(changed: string[]) {
	for (const changedPath of changed) {
		if (!HOST_BINDING_CONFIG_PATHS.has(changedPath)) {
			throw new Error(`Host binding repository operation attempted to change unsupported path "${changedPath}".`);
		}
	}
}
