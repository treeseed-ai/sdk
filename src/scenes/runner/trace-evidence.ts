import { sceneRuntimeValue } from '../builtin-plugins/duration.ts';
import { fillTargetsSensitiveField,redactPlaywrightTraceArchive } from '../support/evidence/artifacts.ts';
import type { SceneBrowserSession,SceneDiagnostic,SceneRuntimePluginContext } from '../types.ts';
import { playwrightDiagnostic } from './now.ts';

export function createSceneTraceEvidence(tracePath: string | null) {
	const sensitiveValues = new Set<string>();
	let tracingStarted = false;
	let tracingStopped = false;

	return {
		started() {
			tracingStarted = true;
		},
		capture(action: unknown, context: SceneRuntimePluginContext) {
			if (!action || typeof action !== 'object' || !('fill' in action)) return;
			const fill = (action as { fill?: unknown }).fill;
			if (!fill || typeof fill !== 'object' || !fillTargetsSensitiveField(fill as Record<string, unknown>)) return;
			const value = (fill as { value?: unknown }).value;
			if (typeof value === 'string') sensitiveValues.add(sceneRuntimeValue(value, context));
		},
		async finish(session: SceneBrowserSession) {
			if (!tracePath || !tracingStarted || tracingStopped) return;
			await session.stopTracing?.(tracePath);
			tracingStopped = true;
			redactPlaywrightTraceArchive(tracePath, [...sensitiveValues]);
		},
		async finishSafely(session: SceneBrowserSession | null): Promise<SceneDiagnostic[]> {
			if (!session) return [];
			try {
				await this.finish(session);
				return [];
			} catch (error) {
				return [playwrightDiagnostic(error)];
			}
		},
	};
}
