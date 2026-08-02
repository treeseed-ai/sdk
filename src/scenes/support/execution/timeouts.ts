import type { SceneAction,SceneDiagnostic,SceneWorkflowStep } from '../../types.ts';

function actionTimeoutFloorSeconds(action: SceneAction) {
	if (!('waitForOperation' in action) || !action.waitForOperation.timeoutSeconds) return 0;
	const pollingGrace = Math.max(1, action.waitForOperation.pollIntervalSeconds ?? 2);
	return action.waitForOperation.timeoutSeconds + pollingGrace;
}

export function resolveSceneStepTimeoutSeconds(step: SceneWorkflowStep, defaultSeconds: number) {
	return Math.max(step.timeoutSeconds ?? defaultSeconds, actionTimeoutFloorSeconds(step.action));
}

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
