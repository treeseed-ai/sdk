import { hasSceneErrors, sceneErrorDiagnostic } from '../reporting/diagnostics.ts';
import { loadSceneDocument } from './loader.ts';
import { planSceneArtifactPaths } from './phase0.ts';
import { SceneDiagramPluginId, validateSceneDiagrams } from '../rendering/diagram-validation.ts';
import {
	listBuiltInSceneActions,
	listBuiltInSceneAssertions,
	listBuiltInSceneRenderers,
	resolveScenePlugins,
} from '../plugins/registry.ts';
import { parseSceneManifest, sceneActionKind, sceneExpectationKinds } from '../validation/schema.ts';
import {
	SCENE_ENVIRONMENTS,
	type SceneEnvironment,
	type ScenePlanReport,
	type SceneValidationReport,
} from '../../types.ts';

function splitDiagnostics<T extends { severity: string }>(diagnostics: T[], severity: string) {
	return diagnostics.filter((diagnostic) => diagnostic.severity === severity);
}

function resolveEnvironment(value: SceneEnvironment | undefined, fallback: SceneEnvironment) {
	return value ?? fallback;
}

function chapterForStep(stepId: string, chapters: { id: string; startsAt: string }[]) {
	let current: string | null = null;
	for (const chapter of chapters) {
		if (chapter.startsAt === stepId) current = chapter.id;
	}
	return current;
}

function rendererIds(scene: NonNullable<SceneValidationReport['scene']>) {
	return [
		...(scene.render.remotion ? ['remotion'] : []),
		...scene.overlays.map((overlay) => overlay.renderer),
		...scene.diagrams.map((diagram) => diagram.renderer),
	].filter(Boolean);
}

function trainingOutputIds(scene: NonNullable<SceneValidationReport['scene']>) {
	if (!scene.training.enabled) return [];
	return [
		...(scene.training.captions.enabled ? ['captions'] : []),
		...(scene.training.transcript.enabled ? ['transcript'] : []),
		...(scene.training.narration.enabled ? ['narration'] : []),
		...(scene.training.glossary.enabled ? ['glossary'] : []),
		...(scene.training.chapterClips.enabled ? ['chapter-clips'] : []),
	];
}

function enabledPluginIds(input: {
	actionIds: string[];
	assertionIds: string[];
	rendererIds: string[];
	diagramIds?: string[];
	trainingOutputIds?: string[];
	registry: ReturnType<typeof resolveScenePlugins>['registry'];
}) {
	return [...new Set([
		...input.actionIds.map((id) => input.registry.actionPlugins.get(id)).filter((id): id is string => Boolean(id)),
		...input.assertionIds.map((id) => input.registry.assertionPlugins.get(id)).filter((id): id is string => Boolean(id)),
		...input.rendererIds.map((id) => input.registry.rendererPlugins.get(id)).filter((id): id is string => Boolean(id)),
		...(input.diagramIds ?? []).map((id) => SceneDiagramPluginId({ component: id, registry: input.registry })).filter((id): id is string => Boolean(id)),
		...((input.trainingOutputIds ?? []).length > 0 ? ['treeseed.scene.training.deterministic'] : []),
	])].sort();
}

export function validateScene(input: {
	projectRoot: string;
	scene: string;
}): SceneValidationReport {
	const loaded = loadSceneDocument(input.projectRoot, input.scene);
	const diagnostics = [...loaded.diagnostics];
	const scene = diagnostics.length > 0 ? null : parseSceneManifest(loaded.value, diagnostics);
	return {
		ok: scene !== null && !hasSceneErrors(diagnostics),
		scenePath: loaded.path,
		scene: scene && !hasSceneErrors(diagnostics) ? scene : null,
		diagnostics,
	};
}

export function planScene(input: {
	projectRoot: string;
	scene: string;
	environment?: SceneEnvironment;
	runId?: string;
	timestamp?: string;
}): ScenePlanReport {
	const validation = validateScene(input);
	const pluginResolution = resolveScenePlugins();
	const diagnostics = [...validation.diagnostics];
	const scene = validation.scene;
	const diagramDiagnostics = scene ? validateSceneDiagrams({ scene, registry: pluginResolution.registry }) : [];
	if (input.environment && !(SCENE_ENVIRONMENTS as readonly string[]).includes(input.environment)) {
		diagnostics.push(sceneErrorDiagnostic('scene.invalid_environment', `Unknown environment: ${input.environment}.`, 'environment'));
	}
	const environment = resolveEnvironment(input.environment, scene?.target.environment ?? 'local');
	const combinedDiagnostics = [...diagnostics, ...diagramDiagnostics, ...pluginResolution.diagnostics];
	const blockers = splitDiagnostics(combinedDiagnostics, 'error');
	const warnings = splitDiagnostics(combinedDiagnostics, 'warning');
	if (!scene || blockers.length > 0) {
		const allActionIds = listBuiltInSceneActions().map((action) => action.id);
		const allAssertionIds = listBuiltInSceneAssertions().map((assertion) => assertion.id);
		const allRendererIds = listBuiltInSceneRenderers().map((renderer) => renderer.id);
		return {
			ok: false,
			phase: 1,
			scenePath: validation.scenePath,
			sceneId: scene?.id ?? null,
			title: scene?.title ?? null,
			environment,
			baseUrl: scene?.target.baseUrl ?? 'auto',
			browser: scene?.target.browser ?? null,
			viewport: scene?.target.viewport ?? null,
			workflowSteps: [],
			enabledActions: allActionIds,
			enabledAssertions: allAssertionIds,
			enabledRenderers: allRendererIds,
			enabledDiagrams: scene?.diagrams.map((diagram) => diagram.component).sort() ?? [],
			enabledDiagramPlugins: scene ? [...new Set(scene.diagrams.map((diagram) => SceneDiagramPluginId({ component: diagram.component, registry: pluginResolution.registry })).filter((id): id is string => Boolean(id)))].sort() : [],
			enabledTrainingOutputs: scene ? trainingOutputIds(scene) : [],
			enabledNarrationPlugins: scene?.training.enabled && scene.training.narration.enabled ? ['treeseed.scene.training.deterministic'] : [],
			enabledDeviceProfiles: scene?.devices.profiles.map((profile) => profile.id).sort() ?? [],
			enabledPlugins: enabledPluginIds({ actionIds: allActionIds, assertionIds: allAssertionIds, rendererIds: allRendererIds, diagramIds: scene?.diagrams.map((diagram) => diagram.component) ?? [], trainingOutputIds: scene ? trainingOutputIds(scene) : [], registry: pluginResolution.registry }),
			plugins: pluginResolution.summaries,
			pluginDiagnostics: pluginResolution.diagnostics,
			artifactPaths: null,
			diagnostics: combinedDiagnostics,
			warnings,
			blockers,
			estimatedDurationSeconds: null,
		};
	}
	let currentChapter: string | null = null;
	const workflowSteps = scene.workflow.map((step) => {
		currentChapter = chapterForStep(step.id, scene.chapters) ?? currentChapter;
		return {
			id: step.id,
			title: step.title,
			actionKind: sceneActionKind(step.action),
			assertionKinds: sceneExpectationKinds(step.expect),
			chapterId: currentChapter,
			demoOnly: step.demoOnly === true,
		};
	});
	const actionIds = [...new Set(workflowSteps.map((step) => step.actionKind))];
	const assertionIds = [...new Set(workflowSteps.flatMap((step) => step.assertionKinds))];
	const activeRendererIds = [...new Set(rendererIds(scene))];
	const diagramIds = [...new Set(scene.diagrams.map((diagram) => diagram.component))].sort();
	const diagramPluginIds = [...new Set(diagramIds.map((id) => SceneDiagramPluginId({ component: id, registry: pluginResolution.registry })).filter((id): id is string => Boolean(id)))].sort();
	const trainingOutputs = trainingOutputIds(scene);
	return {
		ok: true,
		phase: 1,
		scenePath: validation.scenePath,
		sceneId: scene.id,
		title: scene.title,
		environment,
		baseUrl: scene.target.baseUrl,
		browser: scene.target.browser,
		viewport: scene.target.viewport,
		workflowSteps,
		enabledActions: actionIds,
		enabledAssertions: assertionIds,
		enabledRenderers: activeRendererIds,
		enabledDiagrams: diagramIds,
		enabledDiagramPlugins: diagramPluginIds,
		enabledTrainingOutputs: trainingOutputs,
		enabledNarrationPlugins: scene.training.enabled && scene.training.narration.enabled ? ['treeseed.scene.training.deterministic'] : [],
		enabledDeviceProfiles: scene.devices.profiles.map((profile) => profile.id).sort(),
		enabledPlugins: enabledPluginIds({ actionIds, assertionIds, rendererIds: activeRendererIds, diagramIds, trainingOutputIds: trainingOutputs, registry: pluginResolution.registry }),
		plugins: pluginResolution.summaries,
		pluginDiagnostics: pluginResolution.diagnostics,
		artifactPaths: planSceneArtifactPaths({
			workspaceRoot: input.projectRoot,
			sceneId: scene.id,
			runId: input.runId,
			timestamp: input.timestamp,
		}),
		diagnostics: combinedDiagnostics,
		warnings,
		blockers,
		estimatedDurationSeconds: null,
	};
}
