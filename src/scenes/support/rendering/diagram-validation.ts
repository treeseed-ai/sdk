import { sceneErrorDiagnostic } from '../reporting/diagnostics.ts';
import { createBuiltInScenePluginRegistry } from '../plugins/registry.ts';
import type {
	SceneDiagnostic,
	SceneDiagramDefinition,
	SceneManifest,
	ScenePluginRegistry,
	SceneRenderDiagram,
	SceneRunReport,
	SceneTimelineEvent,
} from '../../types.ts';

const PLACEMENTS = new Set(['overlay', 'interstitial', 'standalone']);

export function resolveSceneDiagramDefinition(input: {
	component: string;
	registry: ScenePluginRegistry;
}): SceneDiagramDefinition | null {
	for (const provider of input.registry.diagrams.values()) {
		const definition = provider.diagrams[input.component];
		if (definition) return definition;
	}
	return null;
}

export function SceneDiagramPluginId(input: {
	component: string;
	registry: ScenePluginRegistry;
}): string | null {
	for (const [providerId, provider] of input.registry.diagrams.entries()) {
		if (provider.diagrams[input.component]) return input.registry.diagramPlugins.get(providerId) ?? null;
	}
	return null;
}

export function validateSceneDiagrams(input: {
	scene: SceneManifest;
	registry?: ScenePluginRegistry;
}): SceneDiagnostic[] {
	const registry = input.registry ?? createBuiltInScenePluginRegistry();
	const diagnostics: SceneDiagnostic[] = [];
	input.scene.diagrams.forEach((diagram, index) => {
		const path = `diagrams[${index}]`;
		const definition = resolveSceneDiagramDefinition({ component: diagram.component, registry });
		if (!definition) {
			diagnostics.push(sceneErrorDiagnostic('scene.diagram_unknown_component', `Unknown scene diagram component: ${diagram.component}.`, `${path}.component`));
			return;
		}
		if (diagram.renderer !== 'remotion') {
			diagnostics.push(sceneErrorDiagnostic('scene.diagram_renderer_mismatch', `Diagram component ${diagram.component} requires renderer "remotion".`, `${path}.renderer`));
		}
		if (!PLACEMENTS.has(diagram.placement)) {
			diagnostics.push(sceneErrorDiagnostic('scene.diagram_invalid_placement', `Unknown diagram placement: ${diagram.placement}.`, `${path}.placement`));
		}
		if (diagram.durationSeconds !== undefined && (!Number.isFinite(diagram.durationSeconds) || diagram.durationSeconds <= 0)) {
			diagnostics.push(sceneErrorDiagnostic('scene.diagram_invalid_props', 'Diagram durationSeconds must be a positive finite number.', `${path}.durationSeconds`));
		}
		diagnostics.push(...definition.validateProps({ diagram, path }));
	});
	return diagnostics;
}

function stepOffset(stepId: string, timeline: SceneTimelineEvent[]) {
	const exact = timeline.find((event) => event.stepId === stepId && (event.type === 'step.start' || event.type === 'step.started'));
	if (exact) return exact.offsetMs;
	return timeline.find((event) => event.stepId === stepId)?.offsetMs ?? null;
}

export function buildSceneRenderDiagrams(input: {
	scene: SceneManifest;
	run: SceneRunReport;
	timeline: SceneTimelineEvent[];
	registry: ScenePluginRegistry;
}): {
	diagrams: SceneRenderDiagram[];
	diagnostics: SceneDiagnostic[];
} {
	const diagnostics = validateSceneDiagrams({ scene: input.scene, registry: input.registry });
	const renderDiagrams: SceneRenderDiagram[] = [];
	if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) return { diagrams: renderDiagrams, diagnostics };
	input.scene.diagrams.forEach((diagram) => {
		const definition = resolveSceneDiagramDefinition({ component: diagram.component, registry: input.registry });
		if (!definition) return;
		renderDiagrams.push({
			id: diagram.id,
			renderer: diagram.renderer,
			component: diagram.component,
			kind: definition.kind,
			placement: diagram.placement,
			at: diagram.at,
			startOffsetMs: stepOffset(diagram.at, input.timeline),
			durationSeconds: diagram.durationSeconds ?? definition.defaultDurationSeconds,
			props: definition.normalizeProps({ diagram, scene: input.scene, run: input.run }),
			objects: diagram.objects ?? [],
			...(diagram.motion ? { motion: diagram.motion } : {}),
			...(diagram.style ? { style: diagram.style } : {}),
		});
	});
	return { diagrams: renderDiagrams, diagnostics };
}
