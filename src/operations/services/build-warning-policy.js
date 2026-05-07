export const DEFAULT_BUILD_WARNING_RULES = [
	{
		label: 'vite-browser-external-libsodium-url',
		pattern: /Module "url" has been externalized for browser compatibility, imported by ".*libsodium-sumo.*"/u,
	},
];

export function createBuildWarningRules(options = {}) {
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

export function classifyBuildWarningLine(line, options = {}) {
	const value = String(line ?? '');
	if (!value.includes('[WARN]')) {
		return { kind: 'not-warning' };
	}
	const allowed = createBuildWarningRules(options).find((rule) => rule.pattern.test(value));
	if (allowed) {
		return { kind: 'allowed', label: allowed.label };
	}
	return { kind: 'unexpected', line: value };
}

export function createBuildWarningSummary() {
	const allowedWarnings = new Map();
	const unexpectedWarnings = [];
	return {
		allowedWarnings,
		unexpectedWarnings,
		record(line, options = {}) {
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

export function mergeAllowedBuildWarnings(target, source) {
	for (const [label, count] of source.entries()) {
		target.set(label, (target.get(label) ?? 0) + count);
	}
	return target;
}

export function countAllowedBuildWarnings(allowedWarnings) {
	return [...allowedWarnings.values()].reduce((sum, count) => sum + count, 0);
}

export function formatAllowedBuildWarnings(allowedWarnings) {
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

export function scanBuildWarningText(text, options = {}) {
	const summary = createBuildWarningSummary();
	for (const line of String(text ?? '').split(/\r?\n/u)) {
		summary.record(line, options);
	}
	return {
		allowedWarnings: summary.allowedWarnings,
		unexpectedWarnings: summary.unexpectedWarnings,
	};
}
