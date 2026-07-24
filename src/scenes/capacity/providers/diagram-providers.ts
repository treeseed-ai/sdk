import { sceneErrorDiagnostic, sceneWarningDiagnostic } from '../../support/reporting/diagnostics.ts';
import type {
	SceneDiagram,
	SceneDiagramDefinition,
	SceneDiagramProvider,
	SceneRunReport,
} from '../../types.ts';

const SAFE_ID = /^[a-z0-9][a-z0-9._-]*$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown) {
	return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.trim().length > 0)
		? value.map((entry) => entry.trim())
		: null;
}

function warnUnknownProps(props: Record<string, unknown>, allowed: string[], path: string) {
	const allowedSet = new Set(allowed);
	return Object.keys(props)
		.filter((key) => !allowedSet.has(key))
		.map((key) => sceneWarningDiagnostic('scene.diagram_unknown_prop', `Unknown diagram prop: ${key}.`, `${path}.props.${key}`));
}

function propsFor(diagram: SceneDiagram) {
	return isRecord(diagram.props) ? diagram.props : {};
}

function titleProp(props: Record<string, unknown>, fallback: string) {
	return typeof props.title === 'string' && props.title.trim() ? props.title.trim() : fallback;
}

function operationLifecycle(): SceneDiagramDefinition {
	return {
		id: 'OperationLifecycleDiagram',
		phase: 7,
		status: 'available',
		summary: 'Animate Treeseed platform operation status progression.',
		component: 'OperationLifecycleDiagram',
		kind: 'operation-lifecycle',
		defaultDurationSeconds: 12,
		validateProps({ diagram, path }) {
			const props = propsFor(diagram);
			const diagnostics = warnUnknownProps(props, ['states', 'activeState', 'title'], path);
			const states = stringArray(props.states);
			if (!states || states.length === 0) diagnostics.push(sceneErrorDiagnostic('scene.diagram_invalid_props', 'OperationLifecycleDiagram requires a non-empty string array prop: states.', `${path}.props.states`));
			if (props.activeState !== undefined && typeof props.activeState !== 'string') diagnostics.push(sceneErrorDiagnostic('scene.diagram_invalid_props', 'OperationLifecycleDiagram activeState must be a string.', `${path}.props.activeState`));
			if (props.title !== undefined && typeof props.title !== 'string') diagnostics.push(sceneErrorDiagnostic('scene.diagram_invalid_props', 'OperationLifecycleDiagram title must be a string.', `${path}.props.title`));
			if (states && typeof props.activeState === 'string' && !states.includes(props.activeState)) diagnostics.push(sceneErrorDiagnostic('scene.diagram_invalid_props', `OperationLifecycleDiagram activeState must be one of: ${states.join(', ')}.`, `${path}.props.activeState`));
			return diagnostics;
		},
		normalizeProps({ diagram }) {
			const props = propsFor(diagram);
			return {
				title: titleProp(props, 'Operation lifecycle'),
				states: stringArray(props.states) ?? ['queued', 'claimed', 'running', 'verified', 'completed'],
				...(typeof props.activeState === 'string' ? { activeState: props.activeState } : {}),
			};
		},
	};
}

function reconciliationLifecycle(): SceneDiagramDefinition {
	return {
		id: 'ReconciliationLifecycleDiagram',
		phase: 7,
		status: 'available',
		summary: 'Animate exact-state reconciliation from refresh through persist.',
		component: 'ReconciliationLifecycleDiagram',
		kind: 'reconciliation-lifecycle',
		defaultDurationSeconds: 14,
		validateProps({ diagram, path }) {
			const props = propsFor(diagram);
			const diagnostics = warnUnknownProps(props, ['stages', 'title'], path);
			if (props.stages !== undefined && !stringArray(props.stages)) diagnostics.push(sceneErrorDiagnostic('scene.diagram_invalid_props', 'ReconciliationLifecycleDiagram stages must be a non-empty string array.', `${path}.props.stages`));
			if (props.title !== undefined && typeof props.title !== 'string') diagnostics.push(sceneErrorDiagnostic('scene.diagram_invalid_props', 'ReconciliationLifecycleDiagram title must be a string.', `${path}.props.title`));
			return diagnostics;
		},
		normalizeProps({ diagram }) {
			const props = propsFor(diagram);
			return {
				title: titleProp(props, 'Reconciliation lifecycle'),
				stages: stringArray(props.stages) ?? ['refresh', 'diff', 'plan', 'validate', 'apply', 'refresh', 'verify', 'persist'],
			};
		},
	};
}

function devRuntimeTopology(): SceneDiagramDefinition {
	return {
		id: 'DevRuntimeTopologyDiagram',
		phase: 7,
		status: 'available',
		summary: 'Animate managed local dev web, API, and operations-runner topology.',
		component: 'DevRuntimeTopologyDiagram',
		kind: 'dev-runtime-topology',
		defaultDurationSeconds: 12,
		validateProps({ diagram, path }) {
			const props = propsFor(diagram);
			const diagnostics = warnUnknownProps(props, ['surfaces', 'links', 'title'], path);
			const surfaceIds = new Set(['web', 'api', 'operations-runner']);
			if (props.surfaces !== undefined) {
				if (!Array.isArray(props.surfaces)) {
					diagnostics.push(sceneErrorDiagnostic('scene.diagram_invalid_props', 'DevRuntimeTopologyDiagram surfaces must be an array.', `${path}.props.surfaces`));
				} else {
					surfaceIds.clear();
					props.surfaces.forEach((surface, index) => {
						if (!isRecord(surface) || typeof surface.id !== 'string' || !SAFE_ID.test(surface.id)) {
							diagnostics.push(sceneErrorDiagnostic('scene.diagram_invalid_props', 'DevRuntimeTopologyDiagram surface ids must be filesystem-safe strings.', `${path}.props.surfaces[${index}].id`));
							return;
						}
						surfaceIds.add(surface.id);
					});
				}
			}
			if (props.links !== undefined) {
				if (!Array.isArray(props.links)) {
					diagnostics.push(sceneErrorDiagnostic('scene.diagram_invalid_props', 'DevRuntimeTopologyDiagram links must be an array.', `${path}.props.links`));
				} else {
					props.links.forEach((link, index) => {
						if (!isRecord(link) || typeof link.from !== 'string' || typeof link.to !== 'string' || !surfaceIds.has(link.from) || !surfaceIds.has(link.to)) {
							diagnostics.push(sceneErrorDiagnostic('scene.diagram_invalid_props', 'DevRuntimeTopologyDiagram links must reference known surface ids.', `${path}.props.links[${index}]`));
						}
					});
				}
			}
			if (props.title !== undefined && typeof props.title !== 'string') diagnostics.push(sceneErrorDiagnostic('scene.diagram_invalid_props', 'DevRuntimeTopologyDiagram title must be a string.', `${path}.props.title`));
			return diagnostics;
		},
		normalizeProps({ diagram }) {
			const props = propsFor(diagram);
			return {
				title: titleProp(props, 'Managed dev topology'),
				surfaces: Array.isArray(props.surfaces) ? props.surfaces : [
					{ id: 'web', label: 'Web', kind: 'Astro' },
					{ id: 'api', label: 'API', kind: 'Node' },
					{ id: 'operations-runner', label: 'Operations Runner', kind: 'worker' },
				],
				links: Array.isArray(props.links) ? props.links : [
					{ from: 'web', to: 'api', label: 'HTTP' },
					{ from: 'api', to: 'operations-runner', label: 'operations' },
				],
			};
		},
	};
}

function sceneExecutionTimeline(): SceneDiagramDefinition {
	return {
		id: 'SceneExecutionTimelineDiagram',
		phase: 7,
		status: 'available',
		summary: 'Animate scene chapters, segments, steps, and checkpoints.',
		component: 'SceneExecutionTimelineDiagram',
		kind: 'scene-execution-timeline',
		defaultDurationSeconds: 10,
		validateProps({ diagram, path }) {
			const props = propsFor(diagram);
			const diagnostics = warnUnknownProps(props, ['title', 'showCheckpoints', 'showSegments'], path);
			if (props.title !== undefined && typeof props.title !== 'string') diagnostics.push(sceneErrorDiagnostic('scene.diagram_invalid_props', 'SceneExecutionTimelineDiagram title must be a string.', `${path}.props.title`));
			if (props.showCheckpoints !== undefined && typeof props.showCheckpoints !== 'boolean') diagnostics.push(sceneErrorDiagnostic('scene.diagram_invalid_props', 'SceneExecutionTimelineDiagram showCheckpoints must be a boolean.', `${path}.props.showCheckpoints`));
			if (props.showSegments !== undefined && typeof props.showSegments !== 'boolean') diagnostics.push(sceneErrorDiagnostic('scene.diagram_invalid_props', 'SceneExecutionTimelineDiagram showSegments must be a boolean.', `${path}.props.showSegments`));
			return diagnostics;
		},
		normalizeProps({ diagram, run }) {
			const props = propsFor(diagram);
			const report = run as SceneRunReport | null | undefined;
			return {
				title: titleProp(props, 'Scene execution timeline'),
				showCheckpoints: typeof props.showCheckpoints === 'boolean' ? props.showCheckpoints : true,
				showSegments: typeof props.showSegments === 'boolean' ? props.showSegments : true,
				chapters: report?.chapters ?? [],
				segments: report?.segments ?? [],
				steps: report?.steps ?? [],
				checkpoints: report?.checkpoints ?? [],
				failedStep: report?.failedStep ?? null,
			};
		},
	};
}

export function createBuiltInSceneDiagramProvider(): SceneDiagramProvider {
	const diagrams = [
		operationLifecycle(),
		reconciliationLifecycle(),
		devRuntimeTopology(),
		sceneExecutionTimeline(),
	];
	return {
		id: 'treeseed-remotion-diagrams',
		phase: 7,
		status: 'available',
		summary: 'Operation, reconciliation, dev topology, and scene execution timeline diagrams.',
		diagrams: Object.fromEntries(diagrams.map((definition) => [definition.component, definition])),
	};
}
