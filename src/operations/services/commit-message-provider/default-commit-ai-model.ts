


export const DEFAULT_COMMIT_AI_MODEL = '@cf/google/gemma-4-26b-a4b-it';

export type CommitMessageProviderMode = 'auto' | 'cloudflare' | 'fallback' | 'generated';

export type CommitMessageDependencyUpdate = {
	packageName: string;
	field?: string | null;
	from: string;
	to: string;
	tagName?: string | null;
};

export type CommitMessageSubmodulePointer = {
	path: string;
	oldSha: string | null;
	newSha: string | null;
	packageName?: string | null;
};

export type CommitMessagePackageChange = {
	name: string;
	path: string;
	oldSha?: string | null;
	newSha?: string | null;
	tagName?: string | null;
	version?: string | null;
	dependencySpec?: string | null;
	commitSubject?: string | null;
};

export type CommitMessageContext = {
	repoName: string;
	repoPath: string;
	branch: string;
	kind: 'package' | 'project';
	branchMode: 'package-release-main' | 'package-dev-save' | 'project-save';
	changedFiles: string;
	diff: string;
	plannedVersion: string | null;
	plannedTag: string | null;
	dependencyUpdates?: CommitMessageDependencyUpdate[];
	submodulePointers?: CommitMessageSubmodulePointer[];
	packageChanges?: CommitMessagePackageChange[];
	userMessage?: string;
};

export type CommitMessageResult = {
	message: string;
	provider: 'cloudflare-workers-ai' | 'fallback';
	fallbackUsed: boolean;
	error: string | null;
};

export type CommitMessageProvider = {
	generate(context: CommitMessageContext): Promise<string> | string;
};

export type CommitMessageOptions = {
	mode?: CommitMessageProviderMode;
	provider?: CommitMessageProvider;
	env?: NodeJS.ProcessEnv;
	fetchImpl?: typeof fetch;
};

export type CommitMessageSections = {
	intent?: string[];
	changes: string[];
	packageChanges?: string[];
	dependencyUpdates?: string[];
};

export const allowedTypes = new Set(['feat', 'fix', 'refactor', 'test', 'docs', 'build', 'ci', 'chore']);

export const allowedSectionHeadings = new Set(['Intent', 'Changes', 'Integrated package changes', 'Dependency and pointer updates']);

export const forbiddenSectionHeadings = new Set(['Why', 'Validation']);

export const danglingSubjectEndings = new Set([
	'a',
	'an',
	'add',
	'and',
	'as',
	'at',
	'allow',
	'by',
	'bump',
	'change',
	'for',
	'from',
	'implement',
	'in',
	'into',
	'of',
	'on',
	'or',
	'remove',
	'set',
	'support',
	'sync',
	'to',
	'update',
	'with',
]);

export const defaultTimeoutMs = 60_000;

export const defaultMaxDiffChars = 12_000;

export const subjectMaxLength = 72;

export function envValue(env: NodeJS.ProcessEnv, key: string) {
	const value = env[key];
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function parseNumber(value: string | null, fallback: number) {
	if (!value) return fallback;
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function stripControlCharacters(value: string) {
	return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '');
}

export function normalizeWhitespace(value: string) {
	return stripControlCharacters(value).replace(/\s+/gu, ' ').trim();
}

export function compactValue(value: string | null | undefined, maxLength = 120) {
	const normalized = normalizeWhitespace(String(value ?? ''));
	if (normalized.length <= maxLength) return normalized;
	return `${normalized.slice(0, maxLength - 1).trim()}...`;
}

export function shortSha(value: string | null | undefined) {
	const normalized = String(value ?? '').trim();
	return normalized ? normalized.slice(0, 12) : 'unknown';
}

export function changedPaths(changedFiles: string) {
	return changedFiles
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => line.replace(/^([MADRCU?!]{1,2})\s+/u, '').trim())
		.filter(Boolean);
}

export function changedFileGroups(paths: string[]) {
	const counts = new Map<string, number>();
	for (const path of paths) {
		const group = path.startsWith('.github/') || path.includes('/workflows/')
			? 'ci'
			: /(^|\/)(test|tests|__tests__)\/|\.test\.|\.spec\./u.test(path)
				? 'tests'
				: path.startsWith('docs/') || /\.(md|mdx|txt)$/u.test(path)
					? 'docs'
					: path.includes('workflow') || path.includes('repository-save-orchestrator')
						? 'workflow'
						: path.includes('package-reference') || path.includes('release') || path.includes('publish')
							? 'release'
							: /(^|\/)(package|package-lock)\.json$/u.test(path) || path.includes('build') || path.includes('scripts/')
								? 'build'
								: path.includes('config') || path.endsWith('.yaml') || path.endsWith('.yml')
									? 'config'
									: path.startsWith('packages/sdk/drizzle/') || path.includes('/db/')
										? 'database'
										: path.startsWith('src/pages/') || path.startsWith('src/layouts/') || path.includes('/ui/')
											? 'ui'
											: path.startsWith('src/api/') || path.includes('/api/')
												? 'api'
												: 'source';
		counts.set(group, (counts.get(group) ?? 0) + 1);
	}
	return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

export function formatGroups(paths: string[]) {
	const groups = changedFileGroups(paths);
	if (groups.length === 0) return 'none';
	return groups.map(([group, count]) => `${group}: ${count}`).join(', ');
}

export function conventionalParts(message: string | undefined) {
	const value = String(message ?? '').trim();
	const match = value.match(/^([a-z]+)(?:\(([a-z0-9-]+)\))?:\s*(.+)$/iu);
	if (!match) return null;
	const type = match[1].toLowerCase();
	return {
		type: allowedTypes.has(type) ? type : 'chore',
		scope: match[2]?.toLowerCase() ?? null,
		summary: normalizeWhitespace(match[3]),
	};
}

export function inferType(context: CommitMessageContext) {
	const conventional = conventionalParts(context.userMessage);
	if (conventional) return conventional.type;
	const paths = changedPaths(context.changedFiles);
	if (paths.length > 0 && paths.every((path) => /(^|\/)(test|tests|__tests__)\/|\.test\.|\.spec\./u.test(path))) return 'test';
	if (paths.some((path) => path.startsWith('.github/') || path.includes('/workflows/'))) return 'ci';
	if (paths.some((path) => /(^|\/)(package|package-lock)\.json$/u.test(path) || path.includes('build') || path.includes('scripts/'))) return 'build';
	if (paths.some((path) => /\.(md|mdx|txt)$/u.test(path) || path.startsWith('docs/'))) return 'docs';
	if (context.diff.includes('fix') || context.diff.includes('bug') || context.diff.includes('fail')) return 'fix';
	if (context.diff.includes('refactor') || context.diff.includes('rename')) return 'refactor';
	return context.kind === 'package' && context.branchMode === 'package-release-main' ? 'chore' : 'feat';
}

export function inferScope(context: CommitMessageContext) {
	const conventional = conventionalParts(context.userMessage);
	if (conventional?.scope) return conventional.scope;
	if ((context.packageChanges?.length ?? 0) > 0 || (context.submodulePointers?.length ?? 0) > 0) return 'deps';
	const groups = changedFileGroups(changedPaths(context.changedFiles));
	return groups[0]?.[0] ?? (context.branchMode === 'package-release-main' ? 'release' : 'save');
}

export function summaryFromHint(message: string | undefined) {
	const conventional = conventionalParts(message);
	const hint = conventional?.summary ?? normalizeWhitespace(String(message ?? ''));
	if (!hint) return null;
	return hint
		.replace(/^(added|adds)\b/iu, 'add')
		.replace(/^(updated|updates)\b/iu, 'update')
		.replace(/^(fixed|fixes)\b/iu, 'fix')
		.replace(/^(prevented|prevents)\b/iu, 'prevent')
		.replace(/^(allowed|allows)\b/iu, 'allow')
		.replace(/^(implemented|implements)\b/iu, 'implement');
}

export function lastSummaryWord(summary: string) {
	return normalizeWhitespace(summary)
		.split(/\s+/u)
		.at(-1)
		?.toLowerCase()
		.replace(/[^a-z0-9-]/gu, '') ?? '';
}

export function repairSummaryEnding(summary: string, fallback = 'record changes') {
	const words = normalizeWhitespace(summary).replace(/[.。]+$/u, '').split(/\s+/u).filter(Boolean);
	while (words.length > 2 && danglingSubjectEndings.has(lastSummaryWord(words.join(' ')))) {
		words.pop();
	}
	const repaired = words.join(' ').trim();
	if (!repaired || danglingSubjectEndings.has(lastSummaryWord(repaired))) {
		return fallback;
	}
	return repaired;
}
