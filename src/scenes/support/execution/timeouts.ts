import type { SceneDiagnostic } from '../../types.ts';

export async function withSceneTimeout<T>(input: {
	promise: Promise<T>;
	timeoutMs: number | null;
	diagnostic: SceneDiagnostic;
}): Promise<T> {
	if (!input.timeoutMs || input.timeoutMs <= 0) return input.promise;
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			input.promise,
			new Promise<T>((_, reject) => {
				timeout = setTimeout(() => reject(input.diagnostic), input.timeoutMs);
			}),
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}
