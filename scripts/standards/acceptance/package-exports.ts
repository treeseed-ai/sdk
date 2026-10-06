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

/** Archive acceptance is custody of this candidate, not presence of arbitrary build files. */
export function assertPackageCandidateOutputs(exports: unknown, candidateExports: unknown,
	readArchive: (target: string) => Uint8Array, readCandidate: (target: string) => Uint8Array): void {
	if (!isDeepStrictEqual(exports, candidateExports)) throw new Error('Packed export map differs from this candidate.');
	for (const target of assertPackageExportTargets(exports, () => true)) {
		if (!Buffer.from(readArchive(target)).equals(Buffer.from(readCandidate(target))))
			throw new Error(`Packed export or declaration bytes differ from this candidate: ${target}.`);
	}
}
import { isDeepStrictEqual } from 'node:util';
