import { z } from 'zod';
import { AGENT_ACTIVITY_TYPES,AGENT_HANDLER_KINDS } from '../../types/agents.ts';
import { validateAgentActivityProfilesConfiguration,type AgentActivityProfileDiagnostic } from './activity-profile.ts';

const nonEmpty = z.string().trim().min(1);
const stringList = z.array(nonEmpty).superRefine((items, context) => {
	if (new Set(items).size !== items.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Values must be unique.' });
});
const nonEmptyStringList = z.array(nonEmpty).min(1).superRefine((items,context) => {
	if (new Set(items).size !== items.length) context.addIssue({ code:z.ZodIssueCode.custom,message:'Values must be unique.' });
});
const exactRevisionRefSchema=z.object({id:nonEmpty,revision:z.number().int().positive()}).strict();
const exactRevisionRefList=z.array(exactRevisionRefSchema).superRefine((items,context)=>{
	if(new Set(items.map((item)=>`${item.id}@${item.revision}`)).size!==items.length) context.addIssue({code:z.ZodIssueCode.custom,message:'Exact revision references must be unique.'});
});
const promptSchema = z.object({ system: nonEmpty, task: z.string().optional(), templates: z.record(z.string()).optional() }).strict();
const toolPolicySchema = z.object({ allowed: stringList, denied: stringList.optional() }).strict();
const modelPermissionSchema = z.object({ operations:nonEmptyStringList,filters:z.record(z.unknown()).optional() }).strict();
const permissionsSchema = z.object({
	content:z.record(modelPermissionSchema).optional(),
	commit: z.object({ allowed: z.boolean() }).strict().optional(),
	repository: z.object({ readPaths:stringList.optional(),writePaths:stringList.optional(),allowCodeMutation:z.boolean().optional() }).strict().optional(),
	network: z.object({ allowWeb:z.boolean().optional(),allowedDomains:stringList.optional() }).strict().optional(),
	shell: z.object({ allowCommands:z.boolean().optional(),allowedCommands:stringList.optional(),deniedCommands:stringList.optional() }).strict().optional(),
}).strict();
const artifactTriggerSchema = z.object({
	event: nonEmpty,artifactKind: nonEmpty,model: nonEmpty.optional(),required: z.boolean().optional(),
}).strict();
const closeoutPolicySchema = z.object({
	warningSeconds: z.number().int().positive().optional(),summaryRequired: z.boolean().optional(),
	requiredArtifactKinds: stringList.optional(),blockOnOpenQuestions: z.boolean().optional(),
}).strict();
const providerOverridesSchema = z.object({
	requiredCapabilities: stringList.optional(),disallowedProviderIds: stringList.optional(),
	promptRef:nonEmpty.optional(),instructionTemplateRefs:exactRevisionRefList.optional(),
	maxRuntimeSeconds: z.number().int().positive().optional(),maxTotalTokens: z.number().int().positive().optional(),
	maxCostAmount: z.number().nonnegative().optional(),
}).strict();
const branchPolicySchema = z.object({
	kind: z.enum(['read-only','main-planning-content','staging-content','assignment-feature','staging-release']),
	base: z.enum(['main','staging']),
	target: z.enum(['main','staging']).optional(),
	prefix: z.string().optional(),
	branchNameTemplate: z.string().optional(),
	worktree: z.string().optional(),
	updateBaseBeforeRun: z.boolean().optional(),
	mergeTargetBeforeSave: z.boolean().optional(),
}).strict();
const signalPolicySchema = z.object({
	subscribesTo: z.array(z.object({
		contract: nonEmpty,
		groupScope: z.object({ mode: nonEmpty, projectId: nonEmpty.optional(), groupRefs: z.array(z.object({ projectId: nonEmpty, groupId: nonEmpty }).strict()).optional() }).strict().optional(),
		filters: z.record(z.unknown()).optional(),
		cardinality: z.enum(['single','each']).optional(),
		producerPolicy: z.enum(['any','all','quorum']).optional(),
		quorum: z.number().int().positive().optional(),
	}).strict()).optional(),
	publishes: stringList.optional(),
}).strict();
const planningSignalsSchema = signalPolicySchema.optional();
const planningIntentSchema = z.object({
	objective: nonEmpty.optional(),
	proposalTypes: stringList.optional(),
	artifactKind: nonEmpty.optional(),
	subjectModel: nonEmpty.optional(),
	subjectId: nonEmpty.nullable().optional(),
	includeWorkdayArtifacts: z.boolean().optional(),
	stage: z.enum(['discovery','synthesis','deliberation','evaluation','revision','closeout']).optional(),
	stages: z.array(z.object({
		stage: z.enum(['discovery','synthesis','deliberation','evaluation','revision','closeout']),
		promptTask: nonEmpty.optional(),
		signals: planningSignalsSchema,
	}).strict()).min(1).optional(),
	requiresArtifactKinds: stringList.optional(),
}).strict();
const answerPolicySchema = z.object({
	kind: z.enum(['team-human','human-or-agent','specific-human','specific-agent']),
	teamId: nonEmpty.optional(),
	requiredRoles: stringList.optional(),
	allowedRoles: stringList.optional(),
	allowedAgentIds: stringList.optional(),
	allowedAgentClasses: stringList.optional(),
	allowedActivityProfiles: stringList.optional(),
	teamMemberId: nonEmpty.optional(),
	projectId: nonEmpty.optional(),
	agentSlug: nonEmpty.optional(),
}).strict();
const executionSchema = z.object({
	requiredCapabilities: stringList.optional(),
	maxRuntimeSeconds: z.number().int().positive().optional(),
	closeoutWarningSeconds: z.number().int().positive().optional(),
	preparationSeconds: z.number().int().positive().optional(),
	closeoutSeconds: z.number().int().positive().optional(),
	maxRetries: z.number().int().nonnegative().optional(),
	verificationRequired: z.boolean().optional(),
	maxTotalTokens: z.number().int().positive().optional(),
	warningTokens: z.number().int().positive().optional(),
	maxCostAmount: z.number().nonnegative().optional(),
	costCurrency: z.string().length(3).optional(),
	nativeLimits: z.array(z.object({ unit: nonEmpty, amount: z.number().nonnegative(), enforceable: z.boolean().optional() }).strict()).optional(),
	pricingGeneration: z.string().optional(),
	enforcementConfidence: z.enum(['exact','bounded','estimated','opaque']).optional(),
	allowedPaths: stringList.optional(),
	forbiddenPaths: stringList.optional(),
}).strict();
const activityProfileSchema = z.object({
	activityType: z.enum(AGENT_ACTIVITY_TYPES).optional(),
	enabled: z.boolean(),
	handler: z.enum(AGENT_HANDLER_KINDS),
	prompt: promptSchema,
	branchPolicy: branchPolicySchema,
	contextQueryRefs: exactRevisionRefList.optional(),
	contextQuerySetRefs: exactRevisionRefList.optional(),
	instructionTemplateRefs: exactRevisionRefList.optional(),
	permissions: permissionsSchema.optional(),
	artifactTriggers: z.array(artifactTriggerSchema).optional(),
	closeoutPolicy: closeoutPolicySchema.optional(),
	providerOverrides: providerOverridesSchema.optional(),
	tools: toolPolicySchema,
	signals: signalPolicySchema.optional(),
	outputs: z.object({ messageTypes: stringList, modelMutations: stringList }).strict(),
	planningIntent: planningIntentSchema.optional(),
	questionPolicy: z.object({ blockExecutionWhenCreated: z.boolean().optional(), defaultAnswerPolicy: answerPolicySchema.optional() }).strict().optional(),
	execution: executionSchema.optional(),
}).strict().superRefine((profile,context) => {
	const overrides = profile.providerOverrides;
	if (!overrides) return;
	for (const key of ['maxRuntimeSeconds','maxTotalTokens','maxCostAmount'] as const) {
		if (overrides[key] !== undefined && (profile.execution?.[key] === undefined || overrides[key]! > profile.execution[key]!)) {
			context.addIssue({ code:z.ZodIssueCode.custom,path:['providerOverrides',key],message:`${key} must narrow an explicit profile execution limit.` });
		}
	}
	if (overrides.promptRef && !Object.hasOwn(profile.prompt.templates ?? {},overrides.promptRef)) {
		context.addIssue({ code:z.ZodIssueCode.custom,path:['providerOverrides','promptRef'],message:'Provider promptRef must select a declared profile prompt template.' });
	}
});

export const agentDefinitionSchema = z.object({
	id: nonEmpty,
	slug: nonEmpty,
	title: nonEmpty,
	name: nonEmpty,
	description: nonEmpty,
	summary: nonEmpty,
	agentClass: nonEmpty,
	projectAgentClassId: nonEmpty,
	projectAgentClassSlug: nonEmpty,
	template: z.string().optional(),
	enabled: z.boolean(),
	designMaturity: z.enum(['draft','validated','simulated','proven']).optional(),
	runtimeStatus: z.enum(['active','experimental','dormant']).optional(),
	groupIds: nonEmptyStringList,
	topicIds: stringList.optional(),
	contextQueryRefs: exactRevisionRefList.optional(),
	contextQuerySetRefs: exactRevisionRefList.optional(),
	instructionTemplateRefs: exactRevisionRefList.optional(),
	identity: z.object({ purpose: nonEmpty, responsibilities: stringList, durableInstructions: nonEmpty }).passthrough(),
	capabilities: z.array(z.union([nonEmpty, z.object({ id: nonEmpty }).passthrough()])).optional(),
	activityProfiles:z.record(activityProfileSchema),
}).passthrough().superRefine((agent,context) => {
	const raw = agent as Record<string,unknown>;
	for (const legacy of ['primaryGroupId','permissionPolicy','contentAccess']) if (legacy in raw) context.addIssue({ code:z.ZodIssueCode.custom,path:[legacy],message:`${legacy} is not part of the canonical agent contract.` });
	for (const [profileName,profile] of Object.entries(agent.activityProfiles)) {
		const key = (ref:{id:string;revision:number}) => `${ref.id}@${ref.revision}`;
		const allowed = new Set([...(agent.instructionTemplateRefs ?? []),...(profile.instructionTemplateRefs ?? [])].map(key));
		if (profile.providerOverrides?.instructionTemplateRefs?.some((ref) => !allowed.has(key(ref)))) context.addIssue({
			code:z.ZodIssueCode.custom,path:['activityProfiles',profileName,'providerOverrides','instructionTemplateRefs'],message:'Provider instruction templates must narrow common or profile instruction templates.',
		});
	}
});

function issuePath(path: Array<string | number>) {
	return path.reduce<string>((current, segment) => typeof segment === 'number' ? `${current}[${segment}]` : current ? `${current}.${segment}` : segment, '');
}

export function validateAgentDefinitionModel(value: unknown) {
	const parsed = agentDefinitionSchema.safeParse(value);
	const diagnostics: AgentActivityProfileDiagnostic[] = parsed.success ? [] : parsed.error.issues.map((issue) => ({
		code: `agent_zod_${issue.code}`,
		path: issuePath(issue.path),
		message: issue.message,
	}));
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		diagnostics.push(...validateAgentActivityProfilesConfiguration((value as Record<string, unknown>).activityProfiles).diagnostics);
	}
	const unique = new Map(diagnostics.map((diagnostic) => [`${diagnostic.code}:${diagnostic.path}:${diagnostic.message}`, diagnostic]));
	return { ok: unique.size === 0, diagnostics: [...unique.values()], data: parsed.success ? parsed.data : null };
}
