export const DEFAULT_COMMIT_AI_MODEL = '@cf/google/gemma-4-26b-a4b-it';

export type CommitMessageProviderMode = 'auto' | 'cloudflare' | 'fallback' | 'generated';

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

const allowedTypes = new Set(['feat', 'fix', 'refactor', 'test', 'docs', 'build', 'ci', 'chore']);
const defaultTimeoutMs = 30_000;
const defaultMaxDiffChars = 12_000;

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

function changedPaths(changedFiles: string) {
	return changedFiles
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => line.replace(/^([MADRCU?!]{1,2})\s+/u, '').trim())
		.filter(Boolean);
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
	const counts = new Map<string, number>();
	for (const path of changedPaths(context.changedFiles)) {
		const scope = path.startsWith('.github/')
			? 'ci'
			: path.includes('workflow') || path.includes('repository-save-orchestrator')
				? 'workflow'
				: path.includes('package-reference') || path.includes('publish') || path.includes('release')
					? 'release'
					: path.includes('save')
						? 'save'
						: path.includes('cli/') || path.startsWith('src/cli') || path.includes('operations-registry')
							? 'cli'
							: path.includes('config') || path.endsWith('.yaml') || path.endsWith('.yml')
								? 'config'
								: path.includes('test') || path.includes('__tests__')
									? 'tests'
									: path.endsWith('.md') || path.endsWith('.mdx')
										? 'docs'
										: path.includes('package.json') || path.includes('package-lock.json') || path.includes('build')
											? 'build'
											: context.branchMode === 'package-dev-save'
												? 'save'
												: 'workflow';
		counts.set(scope, (counts.get(scope) ?? 0) + 1);
	}
	return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0]
		?? (context.branchMode === 'package-release-main' ? 'release' : 'save');
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

function fallbackSummary(context: CommitMessageContext, type: string, scope: string) {
	const hint = summaryFromHint(context.userMessage);
	if (hint) return hint;
	if (context.branchMode === 'package-release-main') return 'prepare stable release';
	if (scope === 'cli') return 'allow save without message';
	if (scope === 'release' || scope === 'ci') return 'guard dev tags from publish';
	if (scope === 'workflow' || scope === 'save') return 'generate save commit messages';
	if (type === 'test') return 'cover save workflow behavior';
	if (type === 'docs') return 'update workflow guidance';
	if (type === 'build') return 'update package build metadata';
	return 'record workflow changes';
}

function truncateSubject(type: string, scope: string, summary: string) {
	const prefix = `${type}(${scope}): `;
	const cleanSummary = normalizeWhitespace(summary).replace(/[.。]+$/u, '');
	const maxSummaryLength = Math.max(10, 50 - prefix.length);
	if (cleanSummary.length <= maxSummaryLength) return `${prefix}${cleanSummary}`;
	const sliced = cleanSummary.slice(0, maxSummaryLength).replace(/\s+\S*$/u, '').trim();
	return `${prefix}${sliced || cleanSummary.slice(0, maxSummaryLength).trim()}`;
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

export function formatCommitMessage(type: string, scope: string, summary: string, bullets: string[]) {
	const normalizedType = allowedTypes.has(type) ? type : 'chore';
	const normalizedScope = scope.toLowerCase().replace(/[^a-z0-9-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'workflow';
	const subject = truncateSubject(normalizedType, normalizedScope, summary);
	const body = bullets
		.map((bullet) => normalizeWhitespace(bullet))
		.filter(Boolean)
		.slice(0, 3)
		.map(formatBullet)
		.join('\n');
	return `${subject}\n\n${body}`;
}

export function generateFallbackCommitMessage(context: CommitMessageContext) {
	const type = inferType(context);
	const scope = inferScope(context);
	const summary = fallbackSummary(context, type, scope);
	const bullets = [
		context.userMessage?.trim()
			? `Uses the provided save hint to describe why the ${scope} checkpoint is necessary.`
			: `Records the current ${scope} changes in the standard save workflow.`,
		context.branchMode === 'package-dev-save'
			? 'Keeps development package state on Git tags without publishing stable NPM releases.'
			: context.branchMode === 'package-release-main'
				? 'Prepares stable package metadata for the main branch release path.'
				: 'Preserves the project branch state for the parent workflow.',
		'Keeps the message deterministic when AI generation is unavailable.',
	];
	return formatCommitMessage(type, scope, summary, bullets);
}

function assertCommitTemplate(message: string) {
	const normalized = stripControlCharacters(message)
		.replace(/^```(?:text)?\s*/iu, '')
		.replace(/```\s*$/u, '')
		.trim();
	const [subject = '', ...rest] = normalized.split(/\r?\n/u);
	if (!/^(feat|fix|refactor|test|docs|build|ci|chore)\([a-z0-9-]+\): .+/u.test(subject.trim())) {
		throw new Error('AI commit message did not use the required subject template.');
	}
	const bullets = rest.map((line) => line.trim()).filter((line) => line.startsWith('- '));
	if (bullets.length === 0) {
		throw new Error('AI commit message did not include body bullets.');
	}
	return formatCommitMessage(
		subject.split('(')[0],
		subject.match(/\(([^)]+)\)/u)?.[1] ?? 'workflow',
		subject.replace(/^[a-z]+\([^)]+\):\s*/u, ''),
		bullets.map((line) => line.replace(/^-\s*/u, '')),
	);
}

function cloudflareEndpoint(accountId: string, model: string, gatewayId: string | null) {
	const normalizedModel = model.replace(/^\/+/u, '');
	if (gatewayId) {
		return `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(accountId)}/${encodeURIComponent(gatewayId)}/workers-ai/${normalizedModel}`;
	}
	return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${normalizedModel}`;
}

function cloudflarePrompt(context: CommitMessageContext, maxDiffChars: number) {
	return {
		system: [
			'Generate exactly one Git commit message.',
			'Use this template:',
			'type(scope): short imperative summary',
			'',
			'- Explain why this change is necessary.',
			'- Mention any side effects or constraints.',
			'- Use 72 character wrap.',
			'',
			'Use only these types: feat, fix, refactor, test, docs, build, ci, chore.',
			'Infer scope from the changed area, not from the repository name.',
			'Do not include repository name or package version in save messages.',
			'Return only the commit message.',
		].join('\n'),
		user: [
			`Branch: ${context.branch}`,
			`Mode: ${context.branchMode}`,
			`Kind: ${context.kind}`,
			context.userMessage ? `User hint: ${context.userMessage}` : 'User hint: none',
			context.plannedTag ? `Planned tag: ${context.plannedTag}` : null,
			'Changed files:',
			context.changedFiles || '(none)',
			'Diff:',
			context.diff.slice(0, maxDiffChars) || '(none)',
		].filter((line): line is string => line !== null).join('\n'),
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
		return assertCommitTemplate(text);
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
				message: assertCommitTemplate(await Promise.resolve(options.provider.generate(context))),
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
