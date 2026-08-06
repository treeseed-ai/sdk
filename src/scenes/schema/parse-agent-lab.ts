import type { AgentLabSceneConfig,AgentLabWorkdayConfig,SceneDiagnostic } from '../types.ts';
import { AGENT_LAB_PRESENTATIONS } from '../types/scene-agent-lab.ts';
import { sceneErrorDiagnostic } from '../support/reporting/diagnostics.ts';
import { FILESYSTEM_SAFE_SCENE_ID,asString,booleanField,isRecord,objectField,positiveNumberField,stringArrayField } from './filesystem-safe-scene-id.ts';

function validTimeZone(value: string) {
	try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(); return true; } catch { return false; }
}

function parseWorkday(value: unknown, index: number, diagnostics: SceneDiagnostic[]): AgentLabWorkdayConfig | null {
	const path = `agentLab.workdays[${index}]`;
	if (!isRecord(value)) {
		diagnostics.push(sceneErrorDiagnostic('scene.agent_lab_workday_invalid', 'Agent Lab workdays must be objects.', path));
		return null;
	}
	const id = asString(value.id);
	if (!id || !FILESYSTEM_SAFE_SCENE_ID.test(id)) diagnostics.push(sceneErrorDiagnostic('scene.agent_lab_workday_id_invalid', 'Agent Lab workday id must be file-safe.', `${path}.id`));
	const agentTests = stringArrayField(value, 'agentTests', path, diagnostics);
	if (!agentTests.length) diagnostics.push(sceneErrorDiagnostic('scene.agent_lab_tests_required', 'Agent Lab workdays require at least one agent test.', `${path}.agentTests`));
	if (value.availableCredits !== undefined) diagnostics.push(sceneErrorDiagnostic('scene.agent_lab_legacy_credits_rejected', 'availableCredits is a legacy accounting field. Configure timePolicy and planningSession instead.', `${path}.availableCredits`));
	const timePolicy = objectField(value, 'timePolicy', path, diagnostics) ?? {};
	const planningSession = objectField(value, 'planningSession', path, diagnostics) ?? {};
	const cooperativePlanningPercent = positiveNumberField(timePolicy, 'cooperativePlanningPercent', 90, `${path}.timePolicy`, diagnostics) ?? 90;
	const governedExecutionPercent = typeof timePolicy.governedExecutionPercent === 'number' ? timePolicy.governedExecutionPercent : 0;
	const reservePercent = positiveNumberField(timePolicy, 'reservePercent', 10, `${path}.timePolicy`, diagnostics) ?? 10;
	if ([cooperativePlanningPercent, governedExecutionPercent, reservePercent].some((entry) => !Number.isFinite(entry) || entry < 0) || Math.abs(cooperativePlanningPercent + governedExecutionPercent + reservePercent - 100) > 0.000001) diagnostics.push(sceneErrorDiagnostic('scene.agent_lab_time_policy_invalid', 'Workday Plan, Execute, and Reserve percentages must be nonnegative and total exactly 100.', `${path}.timePolicy`));
	return {
		id,
		...(asString(value.title) ? { title: asString(value.title) } : {}),
		agentTests,
		objectiveRefs: stringArrayField(value, 'objectiveRefs', path, diagnostics),
		durationSeconds: positiveNumberField(value, 'durationSeconds', 1800, path, diagnostics) ?? 1800,
		maxActiveAssignments: positiveNumberField(value, 'maxActiveAssignments', 4, path, diagnostics) ?? 4,
		planningOnly: booleanField(value, 'planningOnly', true, path, diagnostics),
		timePolicy: { cooperativePlanningPercent, governedExecutionPercent, reservePercent },
		planningSession: {
			rounds: positiveNumberField(planningSession, 'rounds', 3, `${path}.planningSession`, diagnostics) ?? 3,
			assignmentTimeboxSeconds: positiveNumberField(planningSession, 'assignmentTimeboxSeconds', 900, `${path}.planningSession`, diagnostics) ?? 900,
			...(typeof planningSession.tokenWarning === 'number' ? { tokenWarning: planningSession.tokenWarning } : {}),
			...(typeof planningSession.tokenHardLimit === 'number' ? { tokenHardLimit: planningSession.tokenHardLimit } : {}),
		},
		profileInputs: objectField(value, 'profileInputs', path, diagnostics) ?? {},
	};
}

export function parseAgentLab(value: unknown, diagnostics: SceneDiagnostic[]): AgentLabSceneConfig | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) {
		diagnostics.push(sceneErrorDiagnostic('scene.agent_lab_invalid', 'agentLab must be an object.', 'agentLab'));
		return undefined;
	}
	const scopeValue = objectField(value, 'scope', 'agentLab', diagnostics) ?? { kind: 'ephemeral' };
	const scopeKind = asString(scopeValue.kind) || 'ephemeral';
	if (!['team', 'ephemeral'].includes(scopeKind)) diagnostics.push(sceneErrorDiagnostic('scene.agent_lab_scope_invalid', 'Agent Lab scope kind must be team or ephemeral.', 'agentLab.scope.kind'));
	const scope = scopeKind === 'team'
		? { kind: 'team' as const, team: asString(scopeValue.team), capacityProvider: asString(scopeValue.capacityProvider) }
		: { kind: 'ephemeral' as const };
	if (scope.kind === 'team' && (!scope.team || !scope.capacityProvider)) diagnostics.push(sceneErrorDiagnostic('scene.agent_lab_scope_reference_required', 'Team scope requires team and capacityProvider seed resource keys.', 'agentLab.scope'));
	const provider = asString(value.provider) || 'local';
	if (provider !== 'local') diagnostics.push(sceneErrorDiagnostic('scene.agent_lab_provider_invalid', 'Agent Lab currently requires the local capacity provider.', 'agentLab.provider'));
	const executionProvider = asString(value.executionProvider) || 'codex';
	if (executionProvider !== 'codex') diagnostics.push(sceneErrorDiagnostic('scene.agent_lab_execution_provider_invalid', 'Agent Lab currently requires the real Codex execution provider.', 'agentLab.executionProvider'));
	const presentation = asString(value.presentation) || 'race-control';
	if (!(AGENT_LAB_PRESENTATIONS as readonly string[]).includes(presentation)) diagnostics.push(sceneErrorDiagnostic('scene.agent_lab_presentation_invalid', `Unknown Agent Lab presentation: ${presentation}.`, 'agentLab.presentation'));
	const timeZone = asString(value.timeZone) || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
	if (!validTimeZone(timeZone)) diagnostics.push(sceneErrorDiagnostic('scene.agent_lab_timezone_invalid', `Invalid IANA time zone: ${timeZone}.`, 'agentLab.timeZone'));
	const repositories = stringArrayField(value, 'repositories', 'agentLab', diagnostics);
	if (!repositories.length) diagnostics.push(sceneErrorDiagnostic('scene.agent_lab_repositories_required', 'Agent Lab requires at least one repository.', 'agentLab.repositories'));
	const workdayValues = Array.isArray(value.workdays) ? value.workdays : [];
	if (!workdayValues.length) diagnostics.push(sceneErrorDiagnostic('scene.agent_lab_workdays_required', 'Agent Lab requires at least one workday.', 'agentLab.workdays'));
	const workdays = workdayValues.map((entry, index) => parseWorkday(entry, index, diagnostics)).filter((entry): entry is AgentLabWorkdayConfig => Boolean(entry));
	if (new Set(workdays.map((entry) => entry.id)).size !== workdays.length) diagnostics.push(sceneErrorDiagnostic('scene.agent_lab_workday_duplicate', 'Agent Lab workday ids must be unique.', 'agentLab.workdays'));
	return {
		scope: scope.kind === 'team' ? { kind: 'team', team: scope.team ?? '', capacityProvider: scope.capacityProvider ?? '' } : scope,
		provider: 'local', executionProvider: 'codex',
		presentation: (AGENT_LAB_PRESENTATIONS as readonly string[]).includes(presentation) ? presentation as AgentLabSceneConfig['presentation'] : 'race-control',
		timeZone, repositories,
		agents: stringArrayField(value, 'agents', 'agentLab', diagnostics),
		agentClasses: stringArrayField(value, 'agentClasses', 'agentLab', diagnostics),
		workdays,
	};
}
