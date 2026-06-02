export type TreeseedTimingEntry = {
	name: string;
	durationMs: number;
	status?: string;
	metadata?: Record<string, unknown>;
	children?: TreeseedTimingEntry[];
};

export function nowMs() {
	return performance.now();
}

export function elapsedMs(startMs: number) {
	return Math.max(0, performance.now() - startMs);
}

export function formatDurationMs(durationMs: number) {
	const value = Math.max(0, Number(durationMs) || 0);
	if (value < 1000) {
		return `${Math.round(value)}ms`;
	}
	if (value < 60_000) {
		return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}s`;
	}
	const minutes = Math.floor(value / 60_000);
	const seconds = Math.round((value % 60_000) / 1000);
	return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function summarizeSlowestTimings(entries: TreeseedTimingEntry[], limit = 8) {
	return flattenTimings(entries)
		.sort((left, right) => right.durationMs - left.durationMs)
		.slice(0, Math.max(0, limit));
}

export function flattenTimings(entries: TreeseedTimingEntry[]): TreeseedTimingEntry[] {
	const flattened: TreeseedTimingEntry[] = [];
	const visit = (entry: TreeseedTimingEntry) => {
		flattened.push(entry);
		for (const child of entry.children ?? []) {
			visit(child);
		}
	};
	for (const entry of entries) {
		visit(entry);
	}
	return flattened;
}

export function formatTimingSummary(entries: TreeseedTimingEntry[], { title = 'Provider deploy timing summary', limit = 12 } = {}) {
	const slowest = summarizeSlowestTimings(entries, limit);
	const lines = [`${title}:`];
	if (slowest.length === 0) {
		lines.push('- no timed steps recorded');
		return lines.join('\n');
	}
	for (const entry of slowest) {
		const status = entry.status ? ` [${entry.status}]` : '';
		lines.push(`- ${entry.name}: ${formatDurationMs(entry.durationMs)}${status}`);
	}
	return lines.join('\n');
}

export function formatTimingMarkdown(entries: TreeseedTimingEntry[], { title = 'Provider deploy timing summary', limit = 20 } = {}) {
	const slowest = summarizeSlowestTimings(entries, limit);
	const lines = [`### ${title}`, '', '| Step | Duration | Status |', '| --- | ---: | --- |'];
	if (slowest.length === 0) {
		lines.push('| No timed steps recorded | 0ms | skipped |');
		return `${lines.join('\n')}\n`;
	}
	for (const entry of slowest) {
		lines.push(`| ${escapeMarkdownCell(entry.name)} | ${formatDurationMs(entry.durationMs)} | ${escapeMarkdownCell(entry.status ?? '')} |`);
	}
	return `${lines.join('\n')}\n`;
}

function escapeMarkdownCell(value: string) {
	return value.replace(/\\/gu, '\\\\').replace(/\|/gu, '\\|').replace(/\n/gu, ' ');
}
