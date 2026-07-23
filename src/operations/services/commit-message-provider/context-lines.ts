
import { CommitMessageContext, CommitMessageOptions, CommitMessageProviderMode, CommitMessageResult, DEFAULT_COMMIT_AI_MODEL, changedPaths, defaultMaxDiffChars, defaultTimeoutMs, envValue, formatGroups, parseNumber } from './default-commit-ai-model.ts';
import { assertCommitTemplate, cloudflareEndpoint, dependencyUpdateBullet, generateFallbackCommitMessage, packageChangeBullet, pointerUpdateBullet } from './fallback-summary.ts';

export function contextLines(context: CommitMessageContext) {
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

export function cloudflarePrompt(context: CommitMessageContext, maxDiffChars: number) {
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

export function extractCloudflareText(payload: unknown) {
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

export async function generateCloudflareCommitMessage(context: CommitMessageContext, env: NodeJS.ProcessEnv, fetchImpl: typeof fetch) {
	const token = envValue(env, 'TREESEED_CLOUDFLARE_API_TOKEN');
	const accountId = envValue(env, 'TREESEED_CLOUDFLARE_ACCOUNT_ID');
	const model = envValue(env, 'TREESEED_COMMIT_AI_MODEL') ?? DEFAULT_COMMIT_AI_MODEL;
	if (!token || !accountId) {
		throw new Error('Cloudflare commit AI requires TREESEED_CLOUDFLARE_API_TOKEN and TREESEED_CLOUDFLARE_ACCOUNT_ID.');
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
	const hasCloudflareConfig = Boolean(envValue(env, 'TREESEED_CLOUDFLARE_API_TOKEN') && envValue(env, 'TREESEED_CLOUDFLARE_ACCOUNT_ID'));
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
