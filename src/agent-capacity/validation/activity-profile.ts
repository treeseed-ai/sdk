import { AGENT_ACTIVITY_TYPES, AGENT_HANDLER_KINDS, type AgentActivityProfile, type AgentActivityType } from '../../types/agents.ts';

export interface AgentActivityProfileDiagnostic { code: string; path: string; message: string }
export interface AgentActivityProfileValidation { ok: boolean; diagnostics: AgentActivityProfileDiagnostic[] }

const PROFILE_KEYS = new Set(['activityType', 'enabled', 'handler', 'prompt', 'branchPolicy', 'contentAccess', 'tools', 'outputs', 'planningIntent', 'questionPolicy', 'execution']);
const PROMPT_KEYS = new Set(['system', 'task', 'templates']);
const TOOL_KEYS = new Set(['allowed', 'denied']);
const OUTPUT_KEYS = new Set(['messageTypes', 'modelMutations']);
const EXECUTION_KEYS = new Set(['providerPreference', 'maxRuntimeSeconds', 'maxRetries', 'verificationRequired', 'allowedPaths', 'forbiddenPaths']);
const CONTENT_ACCESS_KEYS = new Set(['read', 'write', 'commit']);
const CONTENT_SCOPE_KEYS = new Set(['models', 'actions', 'books', 'paths', 'relations']);
const QUESTION_KEYS = new Set(['defaultAnswerPolicy', 'blockExecutionWhenCreated']);
const PLANNING_INTENT_KEYS = new Set(['objective', 'artifactKind', 'subjectModel', 'subjectId', 'includeWorkdayArtifacts']);
const QUESTION_POLICY_KEYS = new Set(['kind', 'teamId', 'requiredRoles', 'allowedRoles', 'allowedAgentClasses', 'teamMemberId', 'projectId', 'agentSlug']);
const BRANCH_KEYS: Record<string, Set<string>> = {
	'read-only': new Set(['kind', 'base']),
	'main-planning-content': new Set(['kind', 'base']),
	'staging-content': new Set(['kind', 'base']),
	'assignment-feature': new Set(['kind', 'base', 'target', 'prefix', 'branchNameTemplate', 'worktree', 'updateBaseBeforeRun', 'mergeTargetBeforeSave']),
	'staging-release': new Set(['kind', 'base', 'target']),
};

function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.trim().length > 0) && new Set(value).size === value.length; }
function unknownKeys(value: Record<string, unknown>, allowed: Set<string>, path: string, add: Add) {
	for (const key of Object.keys(value)) if (!allowed.has(key)) add('agent_activity_unknown_field', `${path}.${key}`, `Unknown activity-profile field ${path}.${key}.`);
}
type Add = (code: string, path: string, message: string) => void;

export function validateAgentActivityProfilesConfiguration(value: unknown): AgentActivityProfileValidation {
	const diagnostics: AgentActivityProfileDiagnostic[] = [];
	const add: Add = (code, path, message) => diagnostics.push({ code, path, message });
	if (!record(value)) return { ok: false, diagnostics: [{ code: 'agent_activity_profiles_invalid', path: 'activityProfiles', message: 'activityProfiles must be an object.' }] };
	let enabled = 0;
	for (const [activity, raw] of Object.entries(value)) {
		const path = `activityProfiles.${activity}`;
		if (!AGENT_ACTIVITY_TYPES.includes(activity as AgentActivityType)) { add('agent_activity_type_invalid', path, `Unsupported activity type ${activity}.`); continue; }
		if (!record(raw)) { add('agent_activity_profile_invalid', path, `${path} must be an object.`); continue; }
		unknownKeys(raw, PROFILE_KEYS, path, add);
		if (raw.activityType !== undefined && raw.activityType !== activity) add('agent_activity_type_mismatch', `${path}.activityType`, 'activityType must match its activityProfiles key.');
		if (typeof raw.enabled !== 'boolean') add('agent_activity_enabled_invalid', `${path}.enabled`, 'enabled must be boolean.');
		else if (raw.enabled) enabled += 1;
		if (typeof raw.handler !== 'string' || !AGENT_HANDLER_KINDS.includes(raw.handler as never)) add('agent_activity_handler_invalid', `${path}.handler`, 'handler must name a supported built-in handler.');
		if (!record(raw.prompt)) add('agent_activity_prompt_invalid', `${path}.prompt`, 'prompt must be an object.');
		else {
			unknownKeys(raw.prompt, PROMPT_KEYS, `${path}.prompt`, add);
			if (typeof raw.prompt.system !== 'string' || !raw.prompt.system.trim()) add('agent_activity_system_prompt_required', `${path}.prompt.system`, 'prompt.system is required.');
			if (raw.prompt.task !== undefined && typeof raw.prompt.task !== 'string') add('agent_activity_task_prompt_invalid', `${path}.prompt.task`, 'prompt.task must be a string.');
			if (raw.prompt.templates !== undefined && (!record(raw.prompt.templates) || Object.values(raw.prompt.templates).some((entry) => typeof entry !== 'string'))) add('agent_activity_templates_invalid', `${path}.prompt.templates`, 'prompt.templates must map names to strings.');
		}
		validateBranch(raw.branchPolicy, `${path}.branchPolicy`, add);
		validateStringLists(raw.tools, TOOL_KEYS, ['allowed'], `${path}.tools`, add);
		validateStringLists(raw.outputs, OUTPUT_KEYS, ['messageTypes', 'modelMutations'], `${path}.outputs`, add);
		validatePlanningIntent(raw.planningIntent, `${path}.planningIntent`, add);
		validateContentAccess(raw.contentAccess, `${path}.contentAccess`, add);
		validateQuestionPolicy(raw.questionPolicy, `${path}.questionPolicy`, add);
		validateExecution(raw.execution, `${path}.execution`, add);
	}
	if (enabled === 0) add('agent_activity_profile_enabled_required', 'activityProfiles', 'At least one activity profile must be enabled.');
	return { ok: diagnostics.length === 0, diagnostics };
}

function validatePlanningIntent(value: unknown, path: string, add: Add) {
	if (value === undefined) return;
	if (!record(value)) { add('agent_activity_planning_intent_invalid', path, 'planningIntent must be an object.'); return; }
	unknownKeys(value, PLANNING_INTENT_KEYS, path, add);
	for (const key of ['objective', 'artifactKind', 'subjectModel']) {
		if (value[key] !== undefined && (typeof value[key] !== 'string' || !value[key].trim())) add('agent_activity_planning_intent_text_invalid', `${path}.${key}`, `${path}.${key} must be a non-empty string.`);
	}
	if (value.subjectId !== undefined && value.subjectId !== null && (typeof value.subjectId !== 'string' || !value.subjectId.trim())) add('agent_activity_planning_intent_text_invalid', `${path}.subjectId`, `${path}.subjectId must be a non-empty string or null.`);
	if (value.includeWorkdayArtifacts !== undefined && typeof value.includeWorkdayArtifacts !== 'boolean') add('agent_activity_planning_intent_boolean_invalid', `${path}.includeWorkdayArtifacts`, `${path}.includeWorkdayArtifacts must be boolean.`);
}

function validateStringLists(value: unknown, keys: Set<string>, required: string[], path: string, add: Add) {
	if (!record(value)) { add('agent_activity_policy_invalid', path, `${path} must be an object.`); return; }
	unknownKeys(value, keys, path, add);
	for (const key of required) if (!strings(value[key])) add('agent_activity_string_list_invalid', `${path}.${key}`, `${path}.${key} must contain unique non-empty strings.`);
	for (const key of keys) if (value[key] !== undefined && !strings(value[key])) add('agent_activity_string_list_invalid', `${path}.${key}`, `${path}.${key} must contain unique non-empty strings.`);
}

function validateBranch(value: unknown, path: string, add: Add) {
	if (!record(value) || typeof value.kind !== 'string' || !BRANCH_KEYS[value.kind]) { add('agent_activity_branch_policy_invalid', path, 'branchPolicy.kind is invalid.'); return; }
	unknownKeys(value, BRANCH_KEYS[value.kind], path, add);
	const expected = value.kind === 'read-only' ? ['main', 'staging'] : value.kind === 'main-planning-content' ? ['main'] : ['staging'];
	if (!expected.includes(String(value.base))) add('agent_activity_branch_base_invalid', `${path}.base`, `branchPolicy.base must be ${expected.join(' or ')}.`);
	if (value.kind === 'assignment-feature' && value.target !== 'staging') add('agent_activity_branch_target_invalid', `${path}.target`, 'assignment-feature target must be staging.');
	if (value.kind === 'staging-release' && value.target !== 'main') add('agent_activity_branch_target_invalid', `${path}.target`, 'staging-release target must be main.');
}

function validateContentAccess(value: unknown, path: string, add: Add) {
	if (value === undefined) return;
	if (!record(value)) { add('agent_activity_content_access_invalid', path, 'contentAccess must be an object.'); return; }
	unknownKeys(value, CONTENT_ACCESS_KEYS, path, add);
	for (const key of ['read', 'write']) {
		const scope = value[key];
		if (scope === undefined) continue;
		if (!record(scope)) { add('agent_activity_content_scope_invalid', `${path}.${key}`, 'Content scope must be an object.'); continue; }
		unknownKeys(scope, CONTENT_SCOPE_KEYS, `${path}.${key}`, add);
		if (!strings(scope.models)) add('agent_activity_content_models_invalid', `${path}.${key}.models`, 'Content scope models must contain unique non-empty strings.');
		for (const optional of ['actions', 'books', 'paths', 'relations']) if (scope[optional] !== undefined && !strings(scope[optional])) add('agent_activity_string_list_invalid', `${path}.${key}.${optional}`, 'Content scope lists must contain unique non-empty strings.');
	}
	if (value.commit !== undefined && (!record(value.commit) || typeof value.commit.allowed !== 'boolean' || Object.keys(value.commit).some((key) => key !== 'allowed'))) add('agent_activity_commit_policy_invalid', `${path}.commit`, 'commit must contain only a boolean allowed field.');
}

function validateQuestionPolicy(value: unknown, path: string, add: Add) {
	if (value === undefined) return;
	if (!record(value)) { add('agent_activity_question_policy_invalid', path, 'questionPolicy must be an object.'); return; }
	unknownKeys(value, QUESTION_KEYS, path, add);
	if (value.blockExecutionWhenCreated !== undefined && typeof value.blockExecutionWhenCreated !== 'boolean') add('agent_activity_question_block_invalid', `${path}.blockExecutionWhenCreated`, 'blockExecutionWhenCreated must be boolean.');
	if (value.defaultAnswerPolicy !== undefined) {
		if (!record(value.defaultAnswerPolicy)) add('agent_activity_answer_policy_invalid', `${path}.defaultAnswerPolicy`, 'defaultAnswerPolicy must be an object.');
		else {
			unknownKeys(value.defaultAnswerPolicy, QUESTION_POLICY_KEYS, `${path}.defaultAnswerPolicy`, add);
			if (!['team-human', 'human-or-agent', 'specific-human', 'specific-agent'].includes(String(value.defaultAnswerPolicy.kind))) add('agent_activity_answer_policy_kind_invalid', `${path}.defaultAnswerPolicy.kind`, 'Unknown answer policy kind.');
		}
	}
}

function validateExecution(value: unknown, path: string, add: Add) {
	if (value === undefined) return;
	if (!record(value)) { add('agent_activity_execution_invalid', path, 'execution must be an object.'); return; }
	unknownKeys(value, EXECUTION_KEYS, path, add);
	for (const key of ['providerPreference', 'allowedPaths', 'forbiddenPaths']) if (value[key] !== undefined && !strings(value[key])) add('agent_activity_string_list_invalid', `${path}.${key}`, `${path}.${key} must contain unique non-empty strings.`);
	if (value.maxRuntimeSeconds !== undefined && (!Number.isInteger(value.maxRuntimeSeconds) || Number(value.maxRuntimeSeconds) < 1)) add('agent_activity_runtime_invalid', `${path}.maxRuntimeSeconds`, 'maxRuntimeSeconds must be a positive integer.');
	if (value.maxRetries !== undefined && (!Number.isInteger(value.maxRetries) || Number(value.maxRetries) < 0)) add('agent_activity_retries_invalid', `${path}.maxRetries`, 'maxRetries must be a non-negative integer.');
	if (value.verificationRequired !== undefined && typeof value.verificationRequired !== 'boolean') add('agent_activity_verification_invalid', `${path}.verificationRequired`, 'verificationRequired must be boolean.');
}

export type ValidAgentActivityProfilesConfiguration = Partial<Record<AgentActivityType, AgentActivityProfile>>;
