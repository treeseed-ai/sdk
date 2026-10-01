export function assertPackageExportTargets(exports: unknown, exists: (target: string) => boolean): string[] {
	function collect(value: unknown): string[] {
		if (typeof value === 'string') return [value];
		if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
		return Object.values(value).flatMap(collect);
	}
	const targets = [...new Set(collect(exports))];
	if (!targets.length) throw new Error('Package exports must declare build outputs.');
	for (const target of targets) {
		if (!target.startsWith('./') || target.split('/').some(part => part === '..') || target.includes('\\'))
			throw new Error(`Package export targets must be package-relative: ${target}.`);
		if (!exists(target)) throw new Error(`Package exports reference missing build outputs: ${target}.`);
	}
	return targets;
}
