import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sdkPackageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

type FixtureManifest = {
	id?: string;
	root?: string;
};

export type FixtureInjectionMode = 'workspace-link' | 'installed-link' | 'contracts-only';

export type FixtureSupportDeclaration = {
	packageName: string;
	modes: readonly FixtureInjectionMode[];
	workspaceDirName?: string;
	entrySpecifier?: string;
	contractsShim?: 'agent';
};

export type ResolveSharedFixtureOptions = {
	packageRoot?: string;
	requiredPaths?: string[];
};

export type PrepareFixturePackagesOptions = {
	fixtureRoot: string;
	packageRoot?: string;
	declarations: readonly FixtureSupportDeclaration[];
};

export const DEFAULT_FIXTURE_ID = 'treeseed-working-site';

function currentPackageRoot(packageRoot?: string) {
	return packageRoot ? resolve(packageRoot) : sdkPackageRoot;
}

function requiredFixturePaths(requiredPaths?: string[]) {
	return requiredPaths && requiredPaths.length > 0
		? requiredPaths
		: ['src/manifest.yaml', 'src/content'];
}

export function resolveRequestedFixtureId() {
	return process.env.TREESEED_FIXTURE_ID?.trim() || DEFAULT_FIXTURE_ID;
}

export function resolveFixturesRepoRoot(options: ResolveSharedFixtureOptions = {}) {
	if (process.env.TREESEED_FIXTURES_ROOT?.trim()) {
		return resolve(process.env.TREESEED_FIXTURES_ROOT);
	}

	return resolve(currentPackageRoot(options.packageRoot), '.fixtures', 'treeseed-fixtures');
}

function fixtureSatisfiesRequiredPaths(root: string, requiredPaths?: string[]) {
	return requiredFixturePaths(requiredPaths).every((relativePath) => existsSync(join(root, relativePath)));
}

export function resolveSharedFixtureRoot(options: ResolveSharedFixtureOptions = {}) {
	const fixturesRepoRoot = resolveFixturesRepoRoot(options);
	const sitesRoot = join(fixturesRepoRoot, 'sites');
	if (!existsSync(sitesRoot)) {
		return null;
	}

	const requestedFixtureId = resolveRequestedFixtureId();
	for (const entry of readdirSync(sitesRoot, { withFileTypes: true })) {
		if (!entry.isDirectory()) {
			continue;
		}

		const fixtureRoot = join(sitesRoot, entry.name);
		const manifestPath = join(fixtureRoot, 'fixture.manifest.json');
		if (!existsSync(manifestPath)) {
			continue;
		}

		try {
			const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as FixtureManifest;
			if (manifest.id !== requestedFixtureId) {
				continue;
			}

			const root = resolve(fixtureRoot, manifest.root ?? '.');
			if (fixtureSatisfiesRequiredPaths(root, options.requiredPaths)) {
				return root;
			}
		} catch {
			continue;
		}
	}

	return null;
}

export function requireSharedFixtureRoot(options: ResolveSharedFixtureOptions = {}) {
	const fixtureRoot = resolveSharedFixtureRoot(options);
	if (!fixtureRoot) {
		throw new Error(
			`Unable to resolve shared fixture "${resolveRequestedFixtureId()}". Initialize the submodule with "git submodule update --init --recursive".`,
		);
	}

	return fixtureRoot;
}

export function checkSharedFixture(options: ResolveSharedFixtureOptions = {}) {
	const fixtureRoot = requireSharedFixtureRoot(options);
	const missing = requiredFixturePaths(options.requiredPaths)
		.filter((relativePath) => !existsSync(join(fixtureRoot, relativePath)));
	if (missing.length > 0) {
		throw new Error(`Shared fixture is missing required paths at ${fixtureRoot}: ${missing.join(', ')}.`);
	}
	return fixtureRoot;
}

function resolveInstalledPackageRoot(packageName: string, entrySpecifier?: string) {
	const candidates = [
		`${packageName}/package.json`,
		entrySpecifier ?? packageName,
		packageName,
	];

	for (const candidate of candidates) {
		try {
			const resolvedEntry = require.resolve(candidate);
			let currentDir = dirname(resolvedEntry);
			while (currentDir !== dirname(currentDir)) {
				if (existsSync(resolve(currentDir, 'package.json'))) {
					return currentDir;
				}
				currentDir = dirname(currentDir);
			}
		} catch {
			continue;
		}
	}

	return null;
}

function resolveWorkspacePackageRoot(packageRoot: string, workspaceDirName?: string) {
	if (!workspaceDirName) {
		return null;
	}
	const candidate = resolve(packageRoot, '..', workspaceDirName);
	return existsSync(resolve(candidate, 'package.json')) ? candidate : null;
}

function ensureFixtureLinkedPackage(fixtureRoot: string, packageName: string, resolvedPackageRoot: string) {
	const packageDir = resolve(fixtureRoot, 'node_modules', ...packageName.split('/'));
	mkdirSync(dirname(packageDir), { recursive: true });
	rmSync(packageDir, { recursive: true, force: true });
	symlinkSync(resolvedPackageRoot, packageDir, 'dir');
}

function buildAgentContractsShimPackage(fixtureRoot: string) {
	const packageDir = resolve(fixtureRoot, 'node_modules', '@treeseed', 'agent');
	rmSync(packageDir, { recursive: true, force: true });
	mkdirSync(resolve(packageDir, 'contracts'), { recursive: true });

	writeFileSync(
		resolve(packageDir, 'package.json'),
		JSON.stringify(
			{
				name: '@treeseed/agent',
				type: 'module',
				exports: {
					'./runtime-types': {
						types: './runtime-types.d.ts',
						default: './runtime-types.js',
					},
					'./contracts/messages': {
						types: './contracts/messages.d.ts',
						default: './contracts/messages.js',
					},
					'./contracts/run': {
						types: './contracts/run.d.ts',
						default: './contracts/run.js',
					},
				},
			},
			null,
			2,
		),
		'utf8',
	);

	writeFileSync(resolve(packageDir, 'runtime-types.js'), 'export {};\n', 'utf8');
	writeFileSync(
		resolve(packageDir, 'runtime-types.d.ts'),
		[
			"import type { AgentHandlerKind, AgentRunStatus } from '@treeseed/sdk/types/agents';",
			'export interface AgentTriggerInvocation {',
			"\tkind: 'startup' | 'schedule' | 'message' | 'manual' | 'follow';",
			'\tsource: string;',
			'\tmessage?: { id?: string | number; type?: string; payloadJson?: string | null } | null;',
			'}',
			'export interface AgentExecutionResult {',
			'\tstatus: AgentRunStatus;',
			'\tsummary: string;',
			'\tstdout?: string;',
			'\tstderr?: string;',
			"\terrorCategory?: import('./contracts/run').AgentErrorCategory | null;",
			'\tmetadata?: Record<string, unknown>;',
			'}',
			'export interface AgentContext {',
			'\trunId: string;',
			'\trepoRoot: string;',
			'\tagent: any;',
			'\tsdk: any;',
			'\ttrigger: AgentTriggerInvocation;',
			'\texecution: any;',
			'\tmutations: any;',
			'\trepository: any;',
			'\tverification: any;',
			'\tnotifications: any;',
			'\tresearch: any;',
			'}',
			'export interface AgentHandler<TInputs = unknown, TResult = unknown> {',
			'\tkind: AgentHandlerKind;',
			'\tresolveInputs(context: AgentContext): Promise<TInputs>;',
			'\texecute(context: AgentContext, inputs: TInputs): Promise<TResult>;',
			'\temitOutputs(context: AgentContext, result: TResult): Promise<AgentExecutionResult>;',
			'}',
			'',
		].join('\n'),
		'utf8',
	);
	writeFileSync(
		resolve(packageDir, 'contracts', 'messages.js'),
		[
			'export const AGENT_MESSAGE_TYPES = [];',
			'export function parseAgentMessagePayload(_type, payloadJson) {',
			'\treturn JSON.parse(payloadJson);',
			'}',
			'',
		].join('\n'),
		'utf8',
	);
	writeFileSync(
		resolve(packageDir, 'contracts', 'messages.d.ts'),
		[
			'export interface QuestionPriorityUpdatedMessage {',
			'\tquestionId: string;',
			'\treason: string;',
			'\tplannerRunId: string;',
			'}',
			'export interface ObjectivePriorityUpdatedMessage {',
			'\tobjectiveId: string;',
			'\treason: string;',
			'\tplannerRunId: string;',
			'}',
			'export interface ArchitectureUpdatedMessage {',
			'\tobjectiveId: string;',
			'\tknowledgeId: string;',
			'\tarchitectRunId: string;',
			'}',
			'export interface SubscriberNotifiedMessage {',
			'\temail: string;',
			'\titemCount: number;',
			'\tnotifierRunId: string;',
			'}',
			'export interface ResearchStartedMessage {',
			'\tquestionId: string;',
			'\tresearcherRunId: string;',
			'}',
			'export interface ResearchCompletedMessage {',
			'\tquestionId: string;',
			'\tknowledgeId: string | null;',
			'\tresearcherRunId: string;',
			'}',
			'export interface TaskCompleteMessage {',
			'\tbranchName: string | null;',
			'\tchangedTargets: string[];',
			'\tengineerRunId: string;',
			'}',
			'export interface TaskWaitingMessage {',
			'\tblockingReason: string;',
			'\tengineerRunId: string;',
			'}',
			'export interface TaskFailedMessage {',
			'\tfailureSummary: string;',
			'\tengineerRunId: string;',
			'}',
			'export interface TaskVerifiedMessage {',
			'\tbranchName: string | null;',
			'\treviewerRunId: string;',
			'}',
			'export interface ReviewFailedMessage {',
			'\tfailureSummary: string;',
			'\treviewerRunId: string;',
			'}',
			'export interface ReviewWaitingMessage {',
			'\tblockingReason: string;',
			'\treviewerRunId: string;',
			'}',
			'export interface ReleaseStartedMessage {',
			'\ttaskRunId: string | null;',
			'\treleaserRunId: string;',
			'}',
			'export interface ReleaseCompletedMessage {',
			'\treleaseSummary: string;',
			'\treleaserRunId: string;',
			'}',
			'export interface ReleaseFailedMessage {',
			'\tfailureSummary: string;',
			'\treleaserRunId: string;',
			'}',
			'export interface AgentMessageContracts {',
			'\tquestion_priority_updated: QuestionPriorityUpdatedMessage;',
			'\tobjective_priority_updated: ObjectivePriorityUpdatedMessage;',
			'\tarchitecture_updated: ArchitectureUpdatedMessage;',
			'\tsubscriber_notified: SubscriberNotifiedMessage;',
			'\tresearch_started: ResearchStartedMessage;',
			'\tresearch_completed: ResearchCompletedMessage;',
			'\ttask_complete: TaskCompleteMessage;',
			'\ttask_waiting: TaskWaitingMessage;',
			'\ttask_failed: TaskFailedMessage;',
			'\ttask_verified: TaskVerifiedMessage;',
			'\treview_failed: ReviewFailedMessage;',
			'\treview_waiting: ReviewWaitingMessage;',
			'\trelease_started: ReleaseStartedMessage;',
			'\trelease_completed: ReleaseCompletedMessage;',
			'\trelease_failed: ReleaseFailedMessage;',
			'}',
			'export type AgentMessageType = keyof AgentMessageContracts;',
			'export type AgentMessagePayload<TType extends AgentMessageType> = AgentMessageContracts[TType];',
			'export declare const AGENT_MESSAGE_TYPES: readonly AgentMessageType[];',
			'export declare function parseAgentMessagePayload<TType extends AgentMessageType>(_type: TType, payloadJson: string): AgentMessagePayload<TType>;',
			'',
		].join('\n'),
		'utf8',
	);
	writeFileSync(resolve(packageDir, 'contracts', 'run.js'), 'export {};\n', 'utf8');
	writeFileSync(
		resolve(packageDir, 'contracts', 'run.d.ts'),
		[
			"export type AgentErrorCategory = 'execution_error' | 'mutation_error' | 'verification_error' | 'notification_error' | 'research_error' | 'sdk_error' | 'unknown';",
			'',
		].join('\n'),
		'utf8',
	);
}

export function prepareFixturePackages(options: PrepareFixturePackagesOptions) {
	const packageRoot = currentPackageRoot(options.packageRoot);
	for (const declaration of options.declarations) {
		let satisfied = false;

		for (const mode of declaration.modes) {
			if (mode === 'workspace-link') {
				const workspaceRoot = resolveWorkspacePackageRoot(packageRoot, declaration.workspaceDirName);
				if (!workspaceRoot) {
					continue;
				}
				ensureFixtureLinkedPackage(options.fixtureRoot, declaration.packageName, workspaceRoot);
				satisfied = true;
				break;
			}

			if (mode === 'installed-link') {
				const installedRoot = resolveInstalledPackageRoot(declaration.packageName, declaration.entrySpecifier);
				if (!installedRoot) {
					continue;
				}
				ensureFixtureLinkedPackage(options.fixtureRoot, declaration.packageName, installedRoot);
				satisfied = true;
				break;
			}

			if (mode === 'contracts-only' && declaration.contractsShim === 'agent') {
				buildAgentContractsShimPackage(options.fixtureRoot);
				satisfied = true;
				break;
			}
		}

		if (!satisfied) {
			throw new Error(`Unable to prepare fixture package "${declaration.packageName}" using modes ${declaration.modes.join(', ')}.`);
		}
	}
}
