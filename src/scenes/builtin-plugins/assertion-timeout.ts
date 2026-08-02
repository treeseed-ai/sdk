import type { SceneRuntimePluginContext } from '../types.ts';

export function browserAssertionTimeoutMs(context: Pick<SceneRuntimePluginContext, 'scene'>) {
	return Math.max(10_000, Math.min(30_000, (context.scene.runtime?.timeouts.stepSeconds ?? 60) * 500));
}
