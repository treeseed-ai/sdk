import type { AgentActivityProfilesConfiguration,AgentContentRevisionRef } from '../../types/agents/agent-activity-profile.ts';

export const AGENT_RUNTIME_STATUSES = ['dormant','blocked','queued','running','waiting','degraded','idle'] as const;
export type AgentRuntimeStatus = (typeof AGENT_RUNTIME_STATUSES)[number];
export type AgentDesignMaturity = 'draft' | 'validated' | 'simulated' | 'proven';

export interface AgentAuthoringIntent {
	name: string;
	description: string;
	purpose: string;
	responsibilities: string[];
	durableInstructions: string;
	agentClass: string;
	template?: string;
	enabled: boolean;
	designMaturity?: AgentDesignMaturity;
	activityProfiles: AgentActivityProfilesConfiguration;
	groupIds?: string[];
	topicIds?: string[];
	contextQueryRefs?: AgentContentRevisionRef[];
	contextQuerySetRefs?: AgentContentRevisionRef[];
	instructionTemplateRefs?: AgentContentRevisionRef[];
}

export interface LockedAgentIdentity {
	id: string;
	slug: string;
	path: string;
	createdAt?: string;
	createdFromTemplate?: string;
}

export interface CompiledAgentDefinition {
	identity: LockedAgentIdentity;
	frontmatter: Record<string, unknown>;
	generated: {
		projectAgentClassId: string;
		projectAgentClassSlug: string;
		groupIds: string[];
	};
}

export interface AgentRuntimeEvidence {
	enabled: boolean;
	valid?: boolean;
	syncBlocked?: boolean;
	hardBlocked?: boolean;
	activeRunStatus?: string | null;
	assignmentStatus?: string | null;
	latestTerminalStatus?: string | null;
	settlementIssue?: boolean;
}

function slug(value: string) {
	return value.trim().toLowerCase().replace(/[^a-z0-9]+/gu,'-').replace(/^-|-$/gu,'');
}

function unique(values: string[]) {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
function revisionRefs(values:unknown):AgentContentRevisionRef[] {
	if(!Array.isArray(values)) return [];
	const refs=values.flatMap((value)=>value&&typeof value==='object'&&!Array.isArray(value)&&typeof (value as Record<string,unknown>).id==='string'&&Number.isInteger((value as Record<string,unknown>).revision)
		?[{id:String((value as Record<string,unknown>).id).trim(),revision:Number((value as Record<string,unknown>).revision)}]:[]);
	return [...new Map(refs.map((ref)=>[`${ref.id}@${ref.revision}`,ref])).values()];
}

export function deriveAgentRuntimeStatus(evidence: AgentRuntimeEvidence): AgentRuntimeStatus {
	if (!evidence.enabled) return 'dormant';
	if (evidence.valid === false || evidence.syncBlocked || evidence.hardBlocked) return 'blocked';
	if (evidence.activeRunStatus === 'running') return 'running';
	if (['waiting','retrying','awaiting_human','awaiting_external'].includes(evidence.activeRunStatus ?? '')) return 'waiting';
	if (['pending','admitted','leased','queued'].includes(evidence.assignmentStatus ?? '')) return 'queued';
	if (['failed','expired','returned'].includes(evidence.latestTerminalStatus ?? '') || evidence.settlementIssue) return 'degraded';
	return 'idle';
}

export function compileAgentDefinition(input: {
	intent: AgentAuthoringIntent;
	projectId: string;
	contentRoot?: string;
	existing?: { identity: LockedAgentIdentity; frontmatter?: Record<string, unknown> };
}): CompiledAgentDefinition {
	const agentSlug = input.existing?.identity.slug || slug(input.intent.name);
	const classSlug = slug(input.intent.agentClass) || 'planning';
	if (!agentSlug) throw new Error('Agent name must produce a stable identity.');
	const identity: LockedAgentIdentity = input.existing?.identity ?? {
		id: `agent:${agentSlug}`,
		slug: agentSlug,
		path: `${(input.contentRoot ?? 'src/content').replace(/^\/+|\/+$/gu, '')}/agents/${agentSlug}.mdx`,
		createdAt: new Date().toISOString(),
		createdFromTemplate: input.intent.template,
	};
	const prior = input.existing?.frontmatter ?? {};
	const legacyField = ['primaryGroupId', 'permissionPolicy', 'contentAccess'].find((field) => field in prior);
	if (legacyField) throw new Error(`Existing agent definition uses removed field ${legacyField}. Migrate it before authoring a revision.`);
	const priorGroups = Array.isArray(prior.groupIds) ? prior.groupIds.map(String) : [];
	const groupIds = unique([...priorGroups,...(input.intent.groupIds ?? [])]);
	if (!groupIds.length) groupIds.push('group:project');
	const frontmatter = {
		...prior,
		id: identity.id,
		slug: identity.slug,
		title: input.intent.name.trim(),
		name: input.intent.name.trim(),
		agentClass: classSlug,
		projectAgentClassId: classSlug,
		projectAgentClassSlug: classSlug,
		template: input.intent.template || prior.template,
		enabled: input.intent.enabled,
		description: input.intent.description.trim(),
		summary: input.intent.description.trim(),
		designMaturity: input.intent.designMaturity ?? prior.designMaturity ?? 'draft',
		groupIds,
		topicIds: unique(input.intent.topicIds ?? (Array.isArray(prior.topicIds) ? prior.topicIds.map(String) : [])),
		contextQueryRefs: revisionRefs(input.intent.contextQueryRefs ?? prior.contextQueryRefs),
		contextQuerySetRefs: revisionRefs(input.intent.contextQuerySetRefs ?? prior.contextQuerySetRefs),
		instructionTemplateRefs: revisionRefs(input.intent.instructionTemplateRefs ?? prior.instructionTemplateRefs),
		identity: {
			purpose: input.intent.purpose.trim(),
			responsibilities: unique(input.intent.responsibilities),
			durableInstructions: input.intent.durableInstructions.trim(),
		},
		activityProfiles: input.intent.activityProfiles,
	};
	delete (frontmatter as Record<string, unknown>).runtimeStatus;
	delete (frontmatter as Record<string,unknown>).execution;
	return { identity,frontmatter,generated:{ projectAgentClassId:classSlug,projectAgentClassSlug:classSlug,groupIds } };
}
