import { AGENT_ACTIVITY_TYPES,AGENT_HANDLER_KINDS,type AgentActivityProfile,type AgentActivityType } from '../../types/agents.ts';
import { compileAgentAuthoritySnapshot } from '../authority/agent-authority-presets.ts';

export interface AgentActivityProfileDiagnostic { code: string; path: string; message: string }
export interface AgentActivityProfileValidation { ok: boolean; diagnostics: AgentActivityProfileDiagnostic[] }

const PROFILE_KEYS = new Set(['activityType','enabled','handler','prompt','branchPolicy','contextQueryRefs','contextQuerySetRefs','instructionTemplateRefs','capabilityRequirements','permissions','authorityPresets','artifactTriggers','closeoutPolicy','tools','signals','outputs','planningIntent','questionPolicy','execution']);
const PROMPT_KEYS = new Set(['system', 'task', 'templates']);
const TOOL_KEYS = new Set(['allowed', 'denied']);
const SIGNAL_KEYS = new Set(['subscribesTo', 'publishes']);
const SUBSCRIPTION_KEYS = new Set(['contract', 'groupScope', 'filters', 'cardinality', 'producerPolicy', 'quorum']);
const OUTPUT_KEYS = new Set(['messageTypes', 'modelMutations']);
const EXECUTION_KEYS = new Set(['requiredCapabilities', 'maxRuntimeSeconds', 'preparationSeconds', 'closeoutSeconds', 'closeoutWarningSeconds', 'maxRetries', 'verificationRequired', 'maxTotalTokens', 'warningTokens', 'maxCostAmount', 'costCurrency', 'nativeLimits', 'pricingGeneration', 'enforcementConfidence', 'allowedPaths', 'forbiddenPaths']);
const CONTENT_ACCESS_KEYS = new Set(['content','commit','repository','network','shell']);
const MODEL_PERMISSION_KEYS = new Set(['operations','filters']);
const QUESTION_KEYS = new Set(['defaultAnswerPolicy', 'blockExecutionWhenCreated']);
const PLANNING_INTENT_KEYS = new Set(['objective', 'proposalTypes', 'artifactKind', 'subjectModel', 'subjectId', 'includeWorkdayArtifacts', 'stage', 'stages', 'requiresArtifactKinds']);
const PLANNING_STAGE_KEYS = new Set(['stage', 'promptTask', 'signals']);
const QUESTION_POLICY_KEYS = new Set(['kind', 'teamId', 'requiredRoles', 'allowedRoles', 'allowedAgentIds', 'allowedAgentClasses', 'allowedActivityProfiles', 'teamMemberId', 'projectId', 'agentSlug']);
const BRANCH_KEYS: Record<string, Set<string>> = {
	'read-only': new Set(['kind', 'base']),
	'main-planning-content': new Set(['kind', 'base']),
	'staging-content': new Set(['kind', 'base']),
	'assignment-feature': new Set(['kind', 'base', 'target', 'prefix', 'branchNameTemplate', 'worktree', 'updateBaseBeforeRun', 'mergeTargetBeforeSave']),
	'staging-release': new Set(['kind', 'base', 'target']),
};

function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.trim().length > 0) && new Set(value).size === value.length; }
function exactRefs(value:unknown) { return Array.isArray(value)&&value.every((entry)=>record(entry)&&typeof entry.id==='string'&&entry.id.trim()&&Number.isInteger(entry.revision)&&Number(entry.revision)>0)&&new Set(value.map((entry)=>`${(entry as Record<string,unknown>).id}@${(entry as Record<string,unknown>).revision}`)).size===value.length; }
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
		validateSignals(raw.signals, `${path}.signals`, add);
		validateStringLists(raw.outputs, OUTPUT_KEYS, ['messageTypes', 'modelMutations'], `${path}.outputs`, add);
		validatePlanningIntent(raw.planningIntent, `${path}.planningIntent`, add);
		validateContentAccess(raw.permissions,`${path}.permissions`,add);
		if (raw.authorityPresets !== undefined && (!strings(raw.authorityPresets) || raw.authorityPresets.some((preset) => !['messaging','direction','influence','estimation','plan-contribution','source-execution','review-authority','reporting'].includes(preset)))) add('agent_activity_authority_presets_invalid',`${path}.authorityPresets`,'authorityPresets must contain supported unique preset ids.');
		for (const key of ['contextQueryRefs','contextQuerySetRefs','instructionTemplateRefs']) if (raw[key] !== undefined && !exactRefs(raw[key])) add('agent_activity_revision_refs_invalid',`${path}.${key}`,`${path}.${key} must contain unique exact id and revision references.`);
		validateCapabilityRequirements(raw.capabilityRequirements,`${path}.capabilityRequirements`,add);
		validateArtifactTriggers(raw.artifactTriggers,`${path}.artifactTriggers`,add);
		validateCloseoutPolicy(raw.closeoutPolicy,`${path}.closeoutPolicy`,add);
		validateQuestionPolicy(raw.questionPolicy, `${path}.questionPolicy`, add);
		validateExecution(raw.execution, `${path}.execution`, add);
		if (typeof raw.enabled === 'boolean' && typeof raw.handler === 'string' && record(raw.tools) && record(raw.outputs) && record(raw.branchPolicy)) {
			for (const message of compileAgentAuthoritySnapshot(activity as AgentActivityType,raw as unknown as AgentActivityProfile).diagnostics) {
				add('agent_activity_authority_widening_forbidden',path,message);
			}
		}
	}
	if (enabled === 0) add('agent_activity_profile_enabled_required', 'activityProfiles', 'At least one activity profile must be enabled.');
	return { ok: diagnostics.length === 0, diagnostics };
}

function validateSignals(value: unknown, path: string, add: Add) {
	if (value === undefined) return;
	if (!record(value)) { add('agent_activity_signals_invalid', path, 'signals must be an object.'); return; }
	unknownKeys(value, SIGNAL_KEYS, path, add);
	if (value.publishes !== undefined && !strings(value.publishes)) add('agent_activity_signal_publications_invalid', `${path}.publishes`, 'publishes must contain unique signal contract IDs.');
	if (value.subscribesTo === undefined) return;
	if (!Array.isArray(value.subscribesTo)) { add('agent_activity_signal_subscriptions_invalid', `${path}.subscribesTo`, 'subscribesTo must be an array.'); return; }
	value.subscribesTo.forEach((candidate, index) => {
		const itemPath = `${path}.subscribesTo[${index}]`;
		if (!record(candidate)) { add('agent_activity_signal_subscription_invalid', itemPath, 'Signal subscription must be an object.'); return; }
		unknownKeys(candidate, SUBSCRIPTION_KEYS, itemPath, add);
		if (typeof candidate.contract !== 'string' || !candidate.contract.trim()) add('agent_activity_signal_contract_required', `${itemPath}.contract`, 'Signal subscription contract is required.');
		if (candidate.filters !== undefined && !record(candidate.filters)) add('agent_activity_signal_filters_invalid', `${itemPath}.filters`, 'Signal filters must be an object.');
		if (candidate.groupScope !== undefined) validateGroupScope(candidate.groupScope, `${itemPath}.groupScope`, add);
		if (candidate.cardinality !== undefined && !['single', 'each'].includes(String(candidate.cardinality))) add('agent_activity_signal_cardinality_invalid', `${itemPath}.cardinality`, 'cardinality must be single or each.');
		if (candidate.producerPolicy !== undefined && !['any', 'all', 'quorum'].includes(String(candidate.producerPolicy))) add('agent_activity_producer_policy_invalid', `${itemPath}.producerPolicy`, 'producerPolicy must be any, all, or quorum.');
		if (candidate.producerPolicy === 'quorum' && (!Number.isInteger(candidate.quorum) || Number(candidate.quorum) < 1)) add('agent_activity_signal_quorum_invalid', `${itemPath}.quorum`, 'quorum must be a positive integer.');
	});
}

function validateGroupScope(value: unknown, path: string, add: Add) {
	if (!record(value) || !['member-groups', 'specific-groups', 'project'].includes(String(value.mode))) { add('agent_activity_group_scope_invalid', path, 'groupScope.mode must be member-groups, specific-groups, or project.'); return; }
	if (value.mode === 'project' && (typeof value.projectId !== 'string' || !value.projectId.trim())) add('agent_activity_group_scope_project_required', `${path}.projectId`, 'Project-scoped subscriptions require projectId.');
	if (value.mode === 'specific-groups' && (!Array.isArray(value.groupRefs) || value.groupRefs.length === 0 || value.groupRefs.some((candidate) => !record(candidate) || typeof candidate.projectId !== 'string' || typeof candidate.groupId !== 'string'))) add('agent_activity_group_scope_refs_required', `${path}.groupRefs`, 'Specific group scopes require projectId and groupId references.');
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
	const stages = ['discovery', 'synthesis', 'deliberation', 'evaluation', 'revision', 'closeout'];
	if (value.stage !== undefined && !stages.includes(String(value.stage))) add('agent_activity_planning_stage_invalid', `${path}.stage`, `${path}.stage is unsupported.`);
	if (value.stages !== undefined) {
		if (!Array.isArray(value.stages) || value.stages.length === 0) add('agent_activity_planning_stages_invalid', `${path}.stages`, 'stages must be a non-empty array.');
		else value.stages.forEach((candidate, index) => {
			const stagePath = `${path}.stages[${index}]`;
			if (!record(candidate)) { add('agent_activity_planning_stage_invalid', stagePath, 'Planning stage must be an object.'); return; }
			unknownKeys(candidate, PLANNING_STAGE_KEYS, stagePath, add);
			if (!stages.includes(String(candidate.stage))) add('agent_activity_planning_stage_invalid', `${stagePath}.stage`, 'Planning stage is unsupported.');
			if (candidate.promptTask !== undefined && (typeof candidate.promptTask !== 'string' || !candidate.promptTask.trim())) add('agent_activity_planning_stage_prompt_invalid', `${stagePath}.promptTask`, 'promptTask must be non-empty.');
			validateSignals(candidate.signals, `${stagePath}.signals`, add);
		});
	}
	if (value.requiresArtifactKinds !== undefined && !strings(value.requiresArtifactKinds)) add('agent_activity_string_list_invalid', `${path}.requiresArtifactKinds`, `${path}.requiresArtifactKinds must contain unique non-empty strings.`);
	if (value.proposalTypes !== undefined && !strings(value.proposalTypes)) add('agent_activity_string_list_invalid', `${path}.proposalTypes`, `${path}.proposalTypes must contain unique non-empty strings.`);
}

function validateStringLists(value: unknown, keys: Set<string>, required: string[], path: string, add: Add) {
	if (!record(value)) { add('agent_activity_policy_invalid', path, `${path} must be an object.`); return; }
	unknownKeys(value, keys, path, add);
	for (const key of required) if (!strings(value[key])) add('agent_activity_string_list_invalid', `${path}.${key}`, `${path}.${key} must contain unique non-empty strings.`);
	for (const key of keys) if (!['producerPolicy', 'fanout'].includes(key) && value[key] !== undefined && !strings(value[key])) add('agent_activity_string_list_invalid', `${path}.${key}`, `${path}.${key} must contain unique non-empty strings.`);
}

function validateBranch(value: unknown, path: string, add: Add) {
	if (!record(value) || typeof value.kind !== 'string' || !BRANCH_KEYS[value.kind]) { add('agent_activity_branch_policy_invalid', path, 'branchPolicy.kind is invalid.'); return; }
	unknownKeys(value, BRANCH_KEYS[value.kind], path, add);
	const expected = value.kind === 'read-only' ? ['main', 'staging'] : value.kind === 'main-planning-content' ? ['main'] : ['staging'];
	if (!expected.includes(String(value.base))) add('agent_activity_branch_base_invalid', `${path}.base`, `branchPolicy.base must be ${expected.join(' or ')}.`);
	if (value.kind === 'assignment-feature' && value.target !== 'staging') add('agent_activity_branch_target_invalid', `${path}.target`, 'assignment-feature target must be staging.');
	if (value.kind === 'staging-release' && value.target !== 'main') add('agent_activity_branch_target_invalid', `${path}.target`, 'staging-release target must be main.');
}

function validateContentAccess(value: unknown,path: string,add: Add) {
	if (value === undefined) return;
	if (!record(value)) { add('agent_activity_permissions_invalid',path,'permissions must be an object.'); return; }
	unknownKeys(value, CONTENT_ACCESS_KEYS, path, add);
	if (value.content !== undefined) {
		if (!record(value.content)) add('agent_activity_content_matrix_invalid',`${path}.content`,'content permissions must map model names to operation/filter policies.');
		else for (const [model,permission] of Object.entries(value.content)) {
			const modelPath = `${path}.content.${model}`;
			if (!model.trim() || !record(permission)) { add('agent_activity_model_permission_invalid',modelPath,'Each model permission must be an object.'); continue; }
			unknownKeys(permission,MODEL_PERMISSION_KEYS,modelPath,add);
			if (!strings(permission.operations) || permission.operations.length === 0) add('agent_activity_model_operations_invalid',`${modelPath}.operations`,'Model operations must contain unique non-empty values.');
			if (permission.filters !== undefined && !record(permission.filters)) add('agent_activity_model_filters_invalid',`${modelPath}.filters`,'Model filters must be an object.');
		}
	}
	if (value.commit !== undefined && (!record(value.commit) || typeof value.commit.allowed !== 'boolean' || Object.keys(value.commit).some((key) => key !== 'allowed'))) add('agent_activity_commit_policy_invalid', `${path}.commit`, 'commit must contain only a boolean allowed field.');
	for (const key of ['repository','network','shell']) if (value[key] !== undefined && !record(value[key])) add('agent_activity_permissions_invalid',`${path}.${key}`,`${key} permissions must be an object.`);
}

function validateArtifactTriggers(value: unknown,path: string,add: Add) {
	if (value === undefined) return;
	if (!Array.isArray(value)) { add('agent_activity_artifact_triggers_invalid',path,'artifactTriggers must be an array.'); return; }
	value.forEach((candidate,index) => {
		const itemPath = `${path}[${index}]`;
		if (!record(candidate)) { add('agent_activity_artifact_trigger_invalid',itemPath,'Artifact trigger must be an object.'); return; }
		unknownKeys(candidate,new Set(['event','artifactKind','model','required']),itemPath,add);
		for (const key of ['event','artifactKind']) if (typeof candidate[key] !== 'string' || !candidate[key].trim()) add('agent_activity_artifact_trigger_invalid',`${itemPath}.${key}`,`${key} is required.`);
	});
}

function validateCloseoutPolicy(value: unknown,path: string,add: Add) {
	if (value === undefined) return;
	if (!record(value)) { add('agent_activity_closeout_policy_invalid',path,'closeoutPolicy must be an object.'); return; }
	unknownKeys(value,new Set(['warningSeconds','summaryRequired','requiredArtifactKinds','blockOnOpenQuestions']),path,add);
	if (value.warningSeconds !== undefined && (!Number.isInteger(value.warningSeconds) || Number(value.warningSeconds) < 1)) add('agent_activity_closeout_warning_invalid',`${path}.warningSeconds`,'warningSeconds must be positive.');
	if (value.requiredArtifactKinds !== undefined && !strings(value.requiredArtifactKinds)) add('agent_activity_string_list_invalid',`${path}.requiredArtifactKinds`,'requiredArtifactKinds must contain unique non-empty strings.');
}

function validateCapabilityRequirements(value: unknown,path: string,add: Add) {
	if (value === undefined) return;
	if (!Array.isArray(value) || value.length === 0) { add('agent_activity_capability_requirements_required',path,'capabilityRequirements must be a non-empty array.'); return; }
	value.forEach((candidate,index) => {
		const itemPath=`${path}[${index}]`;
		if (!record(candidate)) { add('agent_activity_capability_requirement_invalid',itemPath,'Capability requirement must be an object.'); return; }
		unknownKeys(candidate,new Set(['capabilityId','versionRange','requirement','alternativeGroup','requiredFeatures','configuration']),itemPath,add);
		if (typeof candidate.capabilityId !== 'string' || !/^(?:treeseed\.|provider\.)/u.test(candidate.capabilityId)) add('agent_activity_capability_id_invalid',`${itemPath}.capabilityId`,'capabilityId must use a TreeSeed or provider namespace.');
		if (typeof candidate.versionRange !== 'string' || !candidate.versionRange.trim()) add('agent_activity_capability_version_invalid',`${itemPath}.versionRange`,'versionRange is required.');
		if (!['required','preferred'].includes(String(candidate.requirement))) add('agent_activity_capability_requirement_invalid',`${itemPath}.requirement`,'requirement must be required or preferred.');
		if (candidate.requiredFeatures !== undefined && !strings(candidate.requiredFeatures)) add('agent_activity_capability_features_invalid',`${itemPath}.requiredFeatures`,'requiredFeatures must contain unique values.');
		if (candidate.configuration !== undefined && !record(candidate.configuration)) add('agent_activity_capability_configuration_invalid',`${itemPath}.configuration`,'configuration must be an object.');
	});
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
	for (const key of ['requiredCapabilities', 'allowedPaths', 'forbiddenPaths']) if (value[key] !== undefined && !strings(value[key])) add('agent_activity_string_list_invalid', `${path}.${key}`, `${path}.${key} must contain unique non-empty strings.`);
	if (value.maxRuntimeSeconds !== undefined && (!Number.isInteger(value.maxRuntimeSeconds) || Number(value.maxRuntimeSeconds) < 1)) add('agent_activity_runtime_invalid', `${path}.maxRuntimeSeconds`, 'maxRuntimeSeconds must be a positive integer.');
	if (value.closeoutWarningSeconds !== undefined && (!Number.isInteger(value.closeoutWarningSeconds) || Number(value.closeoutWarningSeconds) < 1)) add('agent_activity_closeout_warning_invalid', `${path}.closeoutWarningSeconds`, 'closeoutWarningSeconds must be a positive integer.');
	if (value.preparationSeconds !== undefined && (!Number.isInteger(value.preparationSeconds) || Number(value.preparationSeconds) < 1)) add('agent_activity_preparation_duration_invalid', `${path}.preparationSeconds`, 'preparationSeconds must be a positive integer.');
	if (value.closeoutSeconds !== undefined && (!Number.isInteger(value.closeoutSeconds) || Number(value.closeoutSeconds) < 1)) add('agent_activity_closeout_duration_invalid', `${path}.closeoutSeconds`, 'closeoutSeconds must be a positive integer.');
	if (value.maxRetries !== undefined && (!Number.isInteger(value.maxRetries) || Number(value.maxRetries) < 0)) add('agent_activity_retries_invalid', `${path}.maxRetries`, 'maxRetries must be a non-negative integer.');
	if (value.verificationRequired !== undefined && typeof value.verificationRequired !== 'boolean') add('agent_activity_verification_invalid', `${path}.verificationRequired`, 'verificationRequired must be boolean.');
}

export type ValidAgentActivityProfilesConfiguration = Partial<Record<AgentActivityType, AgentActivityProfile>>;
