export interface BuildWarningRule {
	label: string;
	pattern: RegExp;
}

export interface BuildWarningScanOptions {
	useDefaultPolicy?: boolean;
	allow?: Array<string | RegExp>;
}

export type BuildWarningClassification =
	| { kind: 'not-warning' }
	| { kind: 'allowed'; label: string }
	| { kind: 'unexpected'; line: string };

export interface BuildWarningSummary {
	allowedWarnings: Map<string, number>;
	unexpectedWarnings: string[];
	record(line: unknown, options?: BuildWarningScanOptions): BuildWarningClassification;
}

export const DEFAULT_BUILD_WARNING_RULES: BuildWarningRule[] = [
	{
		label: 'vite-browser-external-libsodium-url',
		pattern:
			/(?:Module "url" has been externalized for browser compatibility, imported by|Automatically externalized node built-in module "url" imported from) ".*libsodium-sumo.*"/u,
	},
];

const ANSI_CONTROL_SEQUENCE_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/gu;

export function normalizeBuildWarningLine(line: unknown) {
	return String(line ?? '').replace(ANSI_CONTROL_SEQUENCE_PATTERN, '');
}

export function createBuildWarningRules(options: BuildWarningScanOptions = {}) {
	const useDefaultPolicy = options.useDefaultPolicy !== false;
	const customAllow = Array.isArray(options.allow) ? options.allow : [];
	return [
		...(useDefaultPolicy ? DEFAULT_BUILD_WARNING_RULES : []),
		...customAllow.map((pattern) => ({
			label: `custom:${pattern}`,
			pattern: pattern instanceof RegExp ? pattern : new RegExp(String(pattern)),
		})),
	];
}

export function classifyBuildWarningLine(line: unknown, options: BuildWarningScanOptions = {}): BuildWarningClassification {
	const value = normalizeBuildWarningLine(line);
	if (!value.includes('[WARN]')) {
		return { kind: 'not-warning' };
	}
	const allowed = createBuildWarningRules(options).find((rule) => rule.pattern.test(value));
	if (allowed) {
		return { kind: 'allowed', label: allowed.label };
	}
	return { kind: 'unexpected', line: value };
}

export function createBuildWarningSummary(): BuildWarningSummary {
	const allowedWarnings = new Map<string, number>();
	const unexpectedWarnings: string[] = [];
	return {
		allowedWarnings,
		unexpectedWarnings,
		record(line: unknown, options: BuildWarningScanOptions = {}) {
			const classified = classifyBuildWarningLine(line, options);
			if (classified.kind === 'allowed') {
				allowedWarnings.set(classified.label, (allowedWarnings.get(classified.label) ?? 0) + 1);
				return classified;
			}
			if (classified.kind === 'unexpected') {
				unexpectedWarnings.push(classified.line);
			}
			return classified;
		},
	};
}

export function mergeAllowedBuildWarnings(target: Map<string, number>, source: Map<string, number>) {
	for (const [label, count] of source.entries()) {
		target.set(label, (target.get(label) ?? 0) + count);
	}
	return target;
}

export function countAllowedBuildWarnings(allowedWarnings: Map<string, number>) {
	return [...allowedWarnings.values()].reduce((sum, count) => sum + count, 0);
}

export function formatAllowedBuildWarnings(allowedWarnings: Map<string, number>) {
	const total = countAllowedBuildWarnings(allowedWarnings);
	if (total === 0) {
		return [];
	}
	return [
		`Allowed build warnings: ${total}`,
		...[...allowedWarnings.entries()]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([label, count]) => `- ${label}: ${count}`),
	];
}

export function scanBuildWarningText(text: unknown, options: BuildWarningScanOptions = {}) {
	const summary = createBuildWarningSummary();
	for (const line of String(text ?? '').split(/\r?\n/u)) {
		summary.record(line, options);
	}
	return {
		allowedWarnings: summary.allowedWarnings,
		unexpectedWarnings: summary.unexpectedWarnings,
	};
}
