import { hasTreeseedSceneErrors, sceneErrorDiagnostic } from './diagnostics.ts';
import { loadTreeseedSceneDocument } from './loader.ts';
import { planTreeseedSceneArtifactPaths } from './phase0.ts';
import { treeseedSceneDiagramPluginId, validateTreeseedSceneDiagrams } from './diagram-validation.ts';
import {
	listBuiltInTreeseedSceneActions,
	listBuiltInTreeseedSceneAssertions,
	listBuiltInTreeseedSceneRenderers,
	resolveTreeseedScenePlugins,
} from './registry.ts';
import { parseTreeseedSceneManifest, sceneActionKind, sceneExpectationKinds } from './schema.ts';
import {
	TREESEED_SCENE_ENVIRONMENTS,
	type TreeseedSceneEnvironment,
	type TreeseedScenePlanReport,
	type TreeseedSceneValidationReport,
} from './types.ts';

function splitDiagnostics<T extends { severity: string }>(diagnostics: T[], severity: string) {
	return diagnostics.filter((diagnostic) => diagnostic.severity === severity);
}

function resolveEnvironment(value: TreeseedSceneEnvironment | undefined, fallback: TreeseedSceneEnvironment) {
	return value ?? fallback;
}

function chapterForStep(stepId: string, chapters: { id: string; startsAt: string }[]) {
	let current: string | null = null;
	for (const chapter of chapters) {
		if (chapter.startsAt === stepId) current = chapter.id;
	}
	return current;
}

function rendererIds(scene: NonNullable<TreeseedSceneValidationReport['scene']>) {
	return [
		...(scene.render.remotion ? ['remotion'] : []),
		...scene.overlays.map((overlay) => overlay.renderer),
		...scene.diagrams.map((diagram) => diagram.renderer),
	].filter(Boolean);
}

function trainingOutputIds(scene: NonNullable<TreeseedSceneValidationReport['scene']>) {
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
	registry: ReturnType<typeof resolveTreeseedScenePlugins>['registry'];
}) {
	return [...new Set([
		...input.actionIds.map((id) => input.registry.actionPlugins.get(id)).filter((id): id is string => Boolean(id)),
		...input.assertionIds.map((id) => input.registry.assertionPlugins.get(id)).filter((id): id is string => Boolean(id)),
		...input.rendererIds.map((id) => input.registry.rendererPlugins.get(id)).filter((id): id is string => Boolean(id)),
		...(input.diagramIds ?? []).map((id) => treeseedSceneDiagramPluginId({ component: id, registry: input.registry })).filter((id): id is string => Boolean(id)),
		...((input.trainingOutputIds ?? []).length > 0 ? ['treeseed.scene.training.deterministic'] : []),
	])].sort();
}

export function validateTreeseedScene(input: {
	projectRoot: string;
	scene: string;
}): TreeseedSceneValidationReport {
	const loaded = loadTreeseedSceneDocument(input.projectRoot, input.scene);
	const diagnostics = [...loaded.diagnostics];
	const scene = diagnostics.length > 0 ? null : parseTreeseedSceneManifest(loaded.value, diagnostics);
	return {
		ok: scene !== null && !hasTreeseedSceneErrors(diagnostics),
		scenePath: loaded.path,
		scene: scene && !hasTreeseedSceneErrors(diagnostics) ? scene : null,
		diagnostics,
	};
}

export function planTreeseedScene(input: {
	projectRoot: string;
	scene: string;
	environment?: TreeseedSceneEnvironment;
	runId?: string;
	timestamp?: string;
}): TreeseedScenePlanReport {
	const validation = validateTreeseedScene(input);
	const pluginResolution = resolveTreeseedScenePlugins();
	const diagnostics = [...validation.diagnostics];
	const scene = validation.scene;
	const diagramDiagnostics = scene ? validateTreeseedSceneDiagrams({ scene, registry: pluginResolution.registry }) : [];
	if (input.environment && !(TREESEED_SCENE_ENVIRONMENTS as readonly string[]).includes(input.environment)) {
		diagnostics.push(sceneErrorDiagnostic('scene.invalid_environment', `Unknown environment: ${input.environment}.`, 'environment'));
	}
	const environment = resolveEnvironment(input.environment, scene?.target.environment ?? 'local');
	const combinedDiagnostics = [...diagnostics, ...diagramDiagnostics, ...pluginResolution.diagnostics];
	const blockers = splitDiagnostics(combinedDiagnostics, 'error');
	const warnings = splitDiagnostics(combinedDiagnostics, 'warning');
	if (!scene || blockers.length > 0) {
		const allActionIds = listBuiltInTreeseedSceneActions().map((action) => action.id);
		const allAssertionIds = listBuiltInTreeseedSceneAssertions().map((assertion) => assertion.id);
		const allRendererIds = listBuiltInTreeseedSceneRenderers().map((renderer) => renderer.id);
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
			enabledDiagramPlugins: scene ? [...new Set(scene.diagrams.map((diagram) => treeseedSceneDiagramPluginId({ component: diagram.component, registry: pluginResolution.registry })).filter((id): id is string => Boolean(id)))].sort() : [],
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
	const diagramPluginIds = [...new Set(diagramIds.map((id) => treeseedSceneDiagramPluginId({ component: id, registry: pluginResolution.registry })).filter((id): id is string => Boolean(id)))].sort();
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
		artifactPaths: planTreeseedSceneArtifactPaths({
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
