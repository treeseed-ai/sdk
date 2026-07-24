import { resolveSceneBaseUrl } from '../support/execution/base-url.ts';
import { prepareSceneEnvironment } from '../configuration/environment.ts';
import { resolveSceneAuth } from '../accounts/auth.ts';
import { planOrApplySceneSeed } from '../seeds/seed.ts';
import { sceneErrorDiagnostic } from '../support/reporting/diagnostics.ts';
import { createBuiltInSceneDiagramProvider } from '../capacity/providers/diagram-providers.ts';
import { buildSceneNarrationEntries } from '../support/training/training-transcript.ts';
import type {
	SceneAssertionRunReport,
	SceneDiagnostic,
	ScenePlugin,
	SceneRuntimePluginContext,
	SceneSelector,
} from '../types.ts';


export function duration(start: Date, end: Date) {
	return Math.max(0, end.getTime() - start.getTime());
}

export function mailpitApiUrl(mailpitUrl: string, pathname: string) {
	const url = new URL(pathname, mailpitUrl.endsWith('/') ? mailpitUrl : `${mailpitUrl}/`);
	return url.toString();
}

export function stringValue(value: unknown) {
	return typeof value === 'string' ? value : '';
}

export function shortRuntimeHash(value: string) {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(36).padStart(7, '0').slice(0, 10);
}

export function sceneRuntimeValue(value: string, context: SceneRuntimePluginContext) {
	const runSlug = context.runId.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 48);
	const runShort = shortRuntimeHash(context.runId);
	return value
		.replace(/\{\{\s*runId\s*\}\}/gu, context.runId)
		.replace(/\{\{\s*runSlug\s*\}\}/gu, runSlug)
		.replace(/\{\{\s*runShort\s*\}\}/gu, runShort);
}

export function mailpitMessageId(value: unknown) {
	if (!value || typeof value !== 'object') return '';
	const record = value as Record<string, unknown>;
	return stringValue(record.ID) || stringValue(record.Id) || stringValue(record.id);
}

export function mailpitMessageSubject(value: unknown) {
	if (!value || typeof value !== 'object') return '';
	const record = value as Record<string, unknown>;
	return stringValue(record.Subject) || stringValue(record.subject);
}

export function mailpitMessageRecipients(value: unknown) {
	if (!value || typeof value !== 'object') return [];
	const record = value as Record<string, unknown>;
	const recipients = record.To ?? record.to ?? record.Recipients ?? record.recipients;
	if (!Array.isArray(recipients)) return [];
	return recipients.map((recipient) => {
		if (typeof recipient === 'string') return recipient;
		if (!recipient || typeof recipient !== 'object') return '';
		const entry = recipient as Record<string, unknown>;
		return stringValue(entry.Address) || stringValue(entry.address) || stringValue(entry.Email) || stringValue(entry.email);
	}).filter(Boolean);
}

export function mailpitMessages(value: unknown) {
	if (!value || typeof value !== 'object') return [];
	const record = value as Record<string, unknown>;
	const messages = record.messages ?? record.Messages;
	return Array.isArray(messages) ? messages : [];
}

export function mailpitMessageBody(value: unknown) {
	if (!value || typeof value !== 'object') return '';
	const record = value as Record<string, unknown>;
	const html = stringValue(record.HTML) || stringValue(record.Html) || stringValue(record.html);
	const text = stringValue(record.Text) || stringValue(record.text);
	return `${html}\n${text}`.replace(/&amp;/gu, '&');
}

export function extractConfirmationUrl(body: string) {
	const absolute = body.match(/https?:\/\/[^"' <>\n]+(?:\/auth\/confirm-email\?[^"' <>\n]+|\/team-invites\/[^"' <>\n]+\/accept)/u)?.[0];
	if (absolute) return absolute;
	const relative = body.match(/(?:\/auth\/confirm-email\?[^"' <>\n]+|\/team-invites\/[^"' <>\n]+\/accept)/u)?.[0];
	return relative ?? null;
}

export function resolveMailpitConfirmationUrl(confirmationUrl: string, context: SceneRuntimePluginContext) {
	try {
		const parsed = new URL(confirmationUrl);
		if (parsed.pathname === '/auth/confirm-email' || /^\/team-invites\/[^/]+\/accept$/u.test(parsed.pathname)) {
			return context.resolveUrl(`${parsed.pathname}${parsed.search}${parsed.hash}`);
		}
	} catch {
		// Relative confirmation URLs are resolved below.
	}
	return confirmationUrl.startsWith('/') ? context.resolveUrl(confirmationUrl) : confirmationUrl;
}

export async function sleep(ms: number) {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetryableNavigationError(error: unknown) {
	const message = error instanceof Error ? error.message : String(error ?? '');
	return /Timeout|ERR_CONNECTION|ECONNRESET|ECONNREFUSED|ETIMEDOUT|503|502|504/iu.test(message);
}

export async function navigateScenePage(page: { goto(url: string, options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'; timeout?: number }): Promise<{ status(): number; url(): string } | null | undefined> }, url: string) {
	let lastError: unknown = null;
	for (let attempt = 1; attempt <= 3; attempt += 1) {
		try {
			const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
			const status = response?.status();
			if (typeof status === 'number' && status >= 400) {
				throw sceneErrorDiagnostic('scene.navigation_http_error', `Navigation to ${response?.url() ?? url} returned HTTP ${status}.`, 'workflow.action.goto');
			}
			return;
		} catch (error) {
			lastError = error;
			if (!isRetryableNavigationError(error) || attempt >= 3) break;
			await sleep(500 * attempt);
		}
	}
	throw lastError && typeof lastError === 'object' && 'code' in lastError
		? lastError
		: lastError instanceof Error ? lastError : new Error(String(lastError ?? `Navigation failed for ${url}`));
}

export async function assertionReport(kind: string, action: () => Promise<void>, selector?: SceneSelector): Promise<SceneAssertionRunReport> {
	const startedAt = new Date();
	try {
		await action();
		const finishedAt = new Date();
		return { kind, status: 'passed', startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), durationMs: duration(startedAt, finishedAt), ...(selector ? { selector } : {}) };
	} catch (error) {
		const finishedAt = new Date();
		const diagnostic = error && typeof error === 'object' && 'code' in error
			? error as SceneDiagnostic
			: sceneErrorDiagnostic('scene.assertion_failed', error instanceof Error ? error.message : String(error ?? 'Assertion failed.'));
		return { kind, status: 'failed', startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), durationMs: duration(startedAt, finishedAt), message: diagnostic.message, error: diagnostic, ...(selector ? { selector } : {}) };
	}
}
