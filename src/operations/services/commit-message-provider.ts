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

type CommitMessageOptions = {
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

const allowedTypes = new Set(['feat', 'fix', 'refactor', 'test', 'docs', 'build', 'ci', 'chore']);
const allowedSectionHeadings = new Set(['Intent', 'Changes', 'Integrated package changes', 'Dependency and pointer updates']);
const forbiddenSectionHeadings = new Set(['Why', 'Validation']);
const danglingSubjectEndings = new Set([
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
const defaultTimeoutMs = 30_000;
const defaultMaxDiffChars = 12_000;
const subjectMaxLength = 72;

function envValue(env: NodeJS.ProcessEnv, key: string) {
	const value = env[key];
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function parseNumber(value: string | null, fallback: number) {
	if (!value) return fallback;
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function stripControlCharacters(value: string) {
	return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '');
}

function normalizeWhitespace(value: string) {
	return stripControlCharacters(value).replace(/\s+/gu, ' ').trim();
}

function compactValue(value: string | null | undefined, maxLength = 120) {
	const normalized = normalizeWhitespace(String(value ?? ''));
	if (normalized.length <= maxLength) return normalized;
	return `${normalized.slice(0, maxLength - 1).trim()}...`;
}

function shortSha(value: string | null | undefined) {
	const normalized = String(value ?? '').trim();
	return normalized ? normalized.slice(0, 12) : 'unknown';
}

function changedPaths(changedFiles: string) {
	return changedFiles
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => line.replace(/^([MADRCU?!]{1,2})\s+/u, '').trim())
		.filter(Boolean);
}

function changedFileGroups(paths: string[]) {
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
									: path.startsWith('migrations/') || path.includes('/db/')
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

function formatGroups(paths: string[]) {
	const groups = changedFileGroups(paths);
	if (groups.length === 0) return 'none';
	return groups.map(([group, count]) => `${group}: ${count}`).join(', ');
}

function conventionalParts(message: string | undefined) {
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

function inferType(context: CommitMessageContext) {
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

function inferScope(context: CommitMessageContext) {
	const conventional = conventionalParts(context.userMessage);
	if (conventional?.scope) return conventional.scope;
	if ((context.packageChanges?.length ?? 0) > 0 || (context.submodulePointers?.length ?? 0) > 0) return 'deps';
	const groups = changedFileGroups(changedPaths(context.changedFiles));
	return groups[0]?.[0] ?? (context.branchMode === 'package-release-main' ? 'release' : 'save');
}

function summaryFromHint(message: string | undefined) {
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

function lastSummaryWord(summary: string) {
	return normalizeWhitespace(summary)
		.split(/\s+/u)
		.at(-1)
		?.toLowerCase()
		.replace(/[^a-z0-9-]/gu, '') ?? '';
}

function repairSummaryEnding(summary: string, fallback = 'record changes') {
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

function fallbackSummary(context: CommitMessageContext, type: string, scope: string) {
	const hint = summaryFromHint(context.userMessage);
	if (hint) return repairSummaryEnding(hint);
	if ((context.packageChanges?.length ?? 0) > 0 || (context.submodulePointers?.length ?? 0) > 0) return 'sync integrated package updates';
	if ((context.dependencyUpdates?.length ?? 0) > 0) return 'sync package dependency references';
	if (context.branchMode === 'package-release-main') return 'prepare stable release';
	if (scope === 'workflow' || scope === 'save') return 'update save workflow behavior';
	if (type === 'test') return 'cover workflow behavior';
	if (type === 'docs') return 'update workflow documentation';
	if (type === 'build') return 'update package metadata';
	return 'record repository changes';
}

function truncateSubject(type: string, scope: string, summary: string) {
	const prefix = `${type}(${scope}): `;
	const cleanSummary = repairSummaryEnding(summary);
	const maxSummaryLength = Math.max(10, subjectMaxLength - prefix.length);
	if (cleanSummary.length <= maxSummaryLength) return `${prefix}${cleanSummary}`;
	const sliced = cleanSummary.slice(0, maxSummaryLength).replace(/\s+\S*$/u, '').trim();
	const repaired = repairSummaryEnding(sliced || cleanSummary.slice(0, maxSummaryLength).trim());
	return `${prefix}${repaired}`;
}

function wrapText(value: string, width = 72) {
	const words = normalizeWhitespace(value).split(/\s+/u).filter(Boolean);
	const lines: string[] = [];
	let line = '';
	for (const word of words) {
		if (!line) {
			line = word;
		} else if (`${line} ${word}`.length <= width) {
			line = `${line} ${word}`;
		} else {
			lines.push(line);
			line = word;
		}
	}
	if (line) lines.push(line);
	return lines;
}

function formatBullet(text: string) {
	const lines = wrapText(text, 70);
	return lines.map((line, index) => `${index === 0 ? '-' : ' '} ${line}`).join('\n');
}

function normalizeSectionBullets(values: string[] | undefined) {
	return (values ?? []).map((value) => normalizeWhitespace(value)).filter(Boolean);
}

function normalizeSections(sections: CommitMessageSections | string[]) {
	if (Array.isArray(sections)) {
		return { changes: normalizeSectionBullets(sections) } satisfies CommitMessageSections;
	}
	return {
		intent: normalizeSectionBullets(sections.intent),
		changes: normalizeSectionBullets(sections.changes),
		packageChanges: normalizeSectionBullets(sections.packageChanges),
		dependencyUpdates: normalizeSectionBullets(sections.dependencyUpdates),
	} satisfies CommitMessageSections;
}

function formatSection(heading: string, bullets: string[]) {
	if (bullets.length === 0) return null;
	return [heading, ...bullets.map(formatBullet)].join('\n');
}

export function formatCommitMessage(type: string, scope: string, summary: string, sections: CommitMessageSections | string[]) {
	const normalizedType = allowedTypes.has(type) ? type : 'chore';
	const normalizedScope = scope.toLowerCase().replace(/[^a-z0-9-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'workflow';
	const subject = truncateSubject(normalizedType, normalizedScope, summary);
	const normalizedSections = normalizeSections(sections);
	const changes = normalizedSections.changes.length > 0
		? normalizedSections.changes
		: ['Records the staged repository changes supplied to the save workflow.'];
	const body = [
		formatSection('Intent:', normalizedSections.intent ?? []),
		formatSection('Changes:', changes),
		formatSection('Integrated package changes:', normalizedSections.packageChanges ?? []),
		formatSection('Dependency and pointer updates:', normalizedSections.dependencyUpdates ?? []),
	].filter((section): section is string => Boolean(section)).join('\n\n');
	return `${subject}\n\n${body}`;
}

function packageChangeBullet(change: CommitMessagePackageChange) {
	const details = [
		`${change.name} ${change.path}: ${shortSha(change.oldSha)} -> ${shortSha(change.newSha)}`,
		change.tagName || change.version ? `tag ${change.tagName ?? change.version}` : null,
		change.dependencySpec ? `dependency ${compactValue(change.dependencySpec, 96)}` : null,
		change.commitSubject ? `child: ${compactValue(change.commitSubject, 96)}` : null,
	].filter(Boolean);
	return details.join(', ');
}

function dependencyUpdateBullet(update: CommitMessageDependencyUpdate) {
	const field = update.field ? `${update.field}.` : '';
	const tag = update.tagName ? `, previous tag ${update.tagName}` : '';
	return `${field}${update.packageName}: ${compactValue(update.from, 90)} -> ${compactValue(update.to, 90)}${tag}`;
}

function pointerUpdateBullet(pointer: CommitMessageSubmodulePointer) {
	const label = pointer.packageName ? `${pointer.packageName} ${pointer.path}` : pointer.path;
	return `${label}: ${shortSha(pointer.oldSha)} -> ${shortSha(pointer.newSha)}`;
}

function fallbackChanges(context: CommitMessageContext) {
	const paths = changedPaths(context.changedFiles);
	const bullets: string[] = [];
	if (paths.length > 0) {
		bullets.push(`Updates ${paths.length} file${paths.length === 1 ? '' : 's'} across ${formatGroups(paths)}.`);
		bullets.push(`Touches ${paths.slice(0, 6).join(', ')}${paths.length > 6 ? ', ...' : ''}.`);
	} else {
		bullets.push('Records the staged repository changes supplied to the save workflow.');
	}
	if (context.plannedTag || context.plannedVersion) {
		bullets.push(`Plans package version/tag ${context.plannedTag ?? context.plannedVersion} for ${context.repoName}.`);
	}
	return bullets;
}

export function generateFallbackCommitMessage(context: CommitMessageContext) {
	const type = inferType(context);
	const scope = inferScope(context);
	const summary = fallbackSummary(context, type, scope);
	const intent = context.userMessage?.trim()
		? [`Save hint: ${summaryFromHint(context.userMessage) ?? normalizeWhitespace(context.userMessage)}`]
		: [];
	const dependencyUpdates = [
		...(context.dependencyUpdates ?? []).map(dependencyUpdateBullet),
		...(context.submodulePointers ?? []).map(pointerUpdateBullet),
	];
	return formatCommitMessage(type, scope, summary, {
		intent,
		changes: fallbackChanges(context),
		packageChanges: (context.packageChanges ?? []).map(packageChangeBullet),
		dependencyUpdates,
	});
}

type ParsedSections = {
	intent: string[];
	changes: string[];
	packageChanges: string[];
	dependencyUpdates: string[];
};

function sectionKey(heading: string) {
	if (heading === 'Intent') return 'intent';
	if (heading === 'Changes') return 'changes';
	if (heading === 'Integrated package changes') return 'packageChanges';
	if (heading === 'Dependency and pointer updates') return 'dependencyUpdates';
	return null;
}

function parseCommitSections(lines: string[]) {
	const sections: ParsedSections = {
		intent: [],
		changes: [],
		packageChanges: [],
		dependencyUpdates: [],
	};
	let current: keyof ParsedSections | null = null;
	let lastBullet: string | null = null;
	for (const rawLine of lines) {
		const line = rawLine.trimEnd();
		if (!line.trim()) continue;
		const headingMatch = line.trim().match(/^([^:]+):$/u);
		if (headingMatch) {
			const heading = headingMatch[1].trim();
			if (forbiddenSectionHeadings.has(heading)) {
				throw new Error(`AI commit message included forbidden ${heading} section.`);
			}
			if (!allowedSectionHeadings.has(heading)) {
				throw new Error(`AI commit message included unsupported ${heading} section.`);
			}
			current = sectionKey(heading);
			lastBullet = null;
			continue;
		}
		if (!current) {
			throw new Error('AI commit message included body text before a supported section.');
		}
		if (line.trim().startsWith('- ')) {
			lastBullet = line.trim().replace(/^-\s*/u, '');
			sections[current].push(lastBullet);
			continue;
		}
		if (/^\s+/u.test(line) && lastBullet != null) {
			sections[current][sections[current].length - 1] = `${sections[current][sections[current].length - 1]} ${line.trim()}`;
			continue;
		}
		throw new Error('AI commit message section content must use bullets.');
	}
	return sections;
}

function assertCommitTemplate(message: string, context: CommitMessageContext) {
	const normalized = stripControlCharacters(message)
		.replace(/^```(?:text)?\s*/iu, '')
		.replace(/```\s*$/u, '')
		.trim();
	const [subject = '', ...rest] = normalized.split(/\r?\n/u);
	const subjectMatch = subject.trim().match(/^(feat|fix|refactor|test|docs|build|ci|chore)\(([a-z0-9-]+)\):\s*(.+)$/u);
	if (!subjectMatch) {
		throw new Error('AI commit message did not use the required subject template.');
	}
	const [, type, scope, summary] = subjectMatch;
	if (danglingSubjectEndings.has(lastSummaryWord(summary))) {
		throw new Error('AI commit message subject appears truncated.');
	}
	const sections = parseCommitSections(rest);
	if (sections.changes.length === 0) {
		throw new Error('AI commit message did not include a Changes section.');
	}
	if (sections.intent.length > 0 && !context.userMessage?.trim()) {
		throw new Error('AI commit message included Intent without a save hint.');
	}
	if (context.userMessage?.trim() && sections.intent.length === 0) {
		throw new Error('AI commit message omitted Intent for the provided save hint.');
	}
	return formatCommitMessage(type, scope, summary, {
		intent: sections.intent,
		changes: sections.changes,
		packageChanges: sections.packageChanges,
		dependencyUpdates: sections.dependencyUpdates,
	});
}

function cloudflareEndpoint(accountId: string, model: string, gatewayId: string | null) {
	const normalizedModel = model.replace(/^\/+/u, '');
	if (gatewayId) {
		return `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(accountId)}/${encodeURIComponent(gatewayId)}/workers-ai/${normalizedModel}`;
	}
	return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${normalizedModel}`;
}

function contextLines(context: CommitMessageContext) {
	const paths = changedPaths(context.changedFiles);
	const dependencyUpdates = [
		...(context.dependencyUpdates ?? []).map(dependencyUpdateBullet),
		...(context.submodulePointers ?? []).map(pointerUpdateBullet),
	];
	return [
		'Repository context:',
		`Repo: ${context.repoName}`,
		`Path: ${context.repoPath}`,
		`Branch: ${context.branch}`,
		`Mode: ${context.branchMode}`,
		`Kind: ${context.kind}`,
		context.userMessage ? `User hint: ${context.userMessage}` : 'User hint: none',
		context.plannedVersion ? `Planned version: ${context.plannedVersion}` : null,
		context.plannedTag ? `Planned tag: ${context.plannedTag}` : null,
		'',
		'Changed file groups:',
		formatGroups(paths),
		'',
		'Changed files:',
		paths.length > 0 ? paths.join('\n') : '(none)',
		'',
		'Integrated package changes:',
		(context.packageChanges ?? []).length > 0 ? (context.packageChanges ?? []).map(packageChangeBullet).join('\n') : '(none)',
		'',
		'Dependency and pointer updates:',
		dependencyUpdates.length > 0 ? dependencyUpdates.join('\n') : '(none)',
	].filter((line): line is string => line !== null);
}

function cloudflarePrompt(context: CommitMessageContext, maxDiffChars: number) {
	return {
		system: [
			'You are an accurate repository historian generating one Git commit message.',
			'You have no tool access. You cannot inspect files, history, tests, or prompts.',
			'Use only the repository facts supplied in the user message.',
			'Do not infer motivation, goals, test results, or validation results.',
			'Do not include a Why section or a Validation section.',
			'',
			'Required output shape:',
			'type(scope): imperative summary',
			'',
			'Intent:',
			'- Include this section only when User hint is not "none". Summarize the hint without inventing motivation.',
			'',
			'Changes:',
			'- Describe concrete code, schema, config, docs, and test changes from the supplied facts.',
			'',
			'Integrated package changes:',
			'- Include this section only when package changes are supplied.',
			'',
			'Dependency and pointer updates:',
			'- Include this section only when dependency or submodule pointer updates are supplied.',
			'',
			'Use only these types: feat, fix, refactor, test, docs, build, ci, chore.',
			'Infer scope from the changed area, not from the repository name.',
			'Keep the subject concise; body lines should wrap at 72 characters.',
			'Return only the commit message.',
		].join('\n'),
		user: [
			...contextLines(context),
			'',
			'Diff (truncated; structured context above is complete):',
			context.diff.slice(0, maxDiffChars) || '(none)',
		].join('\n'),
	};
}

function extractCloudflareText(payload: unknown) {
	const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
	const result = record.result && typeof record.result === 'object' ? record.result as Record<string, unknown> : record;
	for (const key of ['response', 'text', 'output']) {
		if (typeof result[key] === 'string') return result[key] as string;
	}
	const choices = result.choices;
	if (Array.isArray(choices)) {
		const first = choices[0] as Record<string, unknown> | undefined;
		const message = first?.message as Record<string, unknown> | undefined;
		if (typeof message?.content === 'string') return message.content;
		if (typeof first?.text === 'string') return first.text;
	}
	return null;
}

async function generateCloudflareCommitMessage(context: CommitMessageContext, env: NodeJS.ProcessEnv, fetchImpl: typeof fetch) {
	const token = envValue(env, 'CLOUDFLARE_API_TOKEN');
	const accountId = envValue(env, 'CLOUDFLARE_ACCOUNT_ID');
	const model = envValue(env, 'TREESEED_COMMIT_AI_MODEL') ?? DEFAULT_COMMIT_AI_MODEL;
	if (!token || !accountId) {
		throw new Error('Cloudflare commit AI requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.');
	}
	const timeoutMs = parseNumber(envValue(env, 'TREESEED_COMMIT_AI_TIMEOUT_MS'), defaultTimeoutMs);
	const maxDiffChars = parseNumber(envValue(env, 'TREESEED_COMMIT_AI_MAX_DIFF_CHARS'), defaultMaxDiffChars);
	const prompt = cloudflarePrompt(context, maxDiffChars);
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetchImpl(cloudflareEndpoint(accountId, model, envValue(env, 'TREESEED_COMMIT_AI_GATEWAY_ID')), {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				messages: [
					{ role: 'system', content: prompt.system },
					{ role: 'user', content: prompt.user },
				],
			}),
			signal: controller.signal,
		});
		if (!response.ok) {
			throw new Error(`Cloudflare commit AI failed with HTTP ${response.status}.`);
		}
		const text = extractCloudflareText(await response.json());
		if (!text) {
			throw new Error('Cloudflare commit AI returned an empty response.');
		}
		return assertCommitTemplate(text, context);
	} finally {
		clearTimeout(timeout);
	}
}

export async function generateRepositoryCommitMessage(
	context: CommitMessageContext,
	options: CommitMessageOptions = {},
): Promise<CommitMessageResult> {
	const env = options.env ?? process.env;
	const mode = (options.mode ?? envValue(env, 'TREESEED_COMMIT_MESSAGE_PROVIDER') ?? 'auto') as CommitMessageProviderMode;
	const fallback = () => generateFallbackCommitMessage(context);
	if (mode === 'fallback') {
		return { message: fallback(), provider: 'fallback', fallbackUsed: false, error: null };
	}
	if (mode === 'generated' && options.provider) {
		try {
			return {
				message: assertCommitTemplate(await Promise.resolve(options.provider.generate(context)), context),
				provider: 'cloudflare-workers-ai',
				fallbackUsed: false,
				error: null,
			};
		} catch (error) {
			return { message: fallback(), provider: 'fallback', fallbackUsed: true, error: error instanceof Error ? error.message : String(error) };
		}
	}
	const hasCloudflareConfig = Boolean(envValue(env, 'CLOUDFLARE_API_TOKEN') && envValue(env, 'CLOUDFLARE_ACCOUNT_ID'));
	if ((mode === 'auto' || mode === 'generated') && !hasCloudflareConfig) {
		return { message: fallback(), provider: 'fallback', fallbackUsed: false, error: null };
	}
	try {
		const fetchImpl = options.fetchImpl ?? globalThis.fetch;
		if (typeof fetchImpl !== 'function') {
			throw new Error('Global fetch is unavailable for Cloudflare commit AI.');
		}
		return {
			message: await generateCloudflareCommitMessage(context, env, fetchImpl),
			provider: 'cloudflare-workers-ai',
			fallbackUsed: false,
			error: null,
		};
	} catch (error) {
		return { message: fallback(), provider: 'fallback', fallbackUsed: true, error: error instanceof Error ? error.message : String(error) };
	}
}
