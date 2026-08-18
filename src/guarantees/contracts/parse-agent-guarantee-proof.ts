import { isRecord,stringArray,stringValue } from '../index/guarantee-journey-audit-item.ts';
import {
	AGENT_GUARANTEE_PROOF_SCHEMA_VERSION,
	type AgentGuaranteeProofCommand,
	type AgentGuaranteeProofInput,
	type AgentGuaranteeProofOutcome,
	type AgentGuaranteeProofPredicate,
	type AgentGuaranteeProofValueRef,
	type GuaranteeCatalogContract,
} from './agent-guarantee-contracts.ts';

const ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/u;
const COMMAND_KINDS = new Set(['read','operator-mutation','simulated-human-mutation','recovery']);
const OPERATORS = new Set(['exists','absent','equals','not-equals','includes','matches','length-at-least','distinct']);
const ALLOWED_ROOTS = new Set(['capacity','dev','governance','platform','projects']);
const FORBIDDEN_ROOTS = new Set(['release','save','stage']);
const GOVERNANCE_READS = new Set(['proposal-list','proposal-show','proposal-events','decision-list','decision-show','decision-events']);
const PLACEHOLDER = /<[^>]+>/u;
const GENERATION = /^[a-f0-9]{64}$/u;
const EXACT_SELECTORS:Record<string,string[]>={
	'capacity.context-query-checks':['--team','--project'],'capacity.context-query-test':['--team','--project','--agent-test'],
	'capacity.workday':['--workday'],'capacity.assignment':['--assignment'],'capacity.mode-runs':['--assignment'],
	'capacity.audit-events':['--resource-type','--resource-id'],'capacity.treedx-proxy-audit':['--assignment'],
	'capacity.workday-summary':['--workday'],'capacity.workday-log':['--workday'],'capacity.decision-planning':['--decision'],
	'capacity.execution-inputs':['--decision'],'capacity.capacity-plan':['--capacity-plan'],'capacity.checkpoint-integrate':['--assignment'],'capacity.assignment-authority-probe':['--assignment'],
	'capacity.assignment-explanation':['--assignment'],'governance.proposal-show':['--project','--proposal'],'projects.list':['--team'],
};

function ref(value: unknown, path: string, issues: string[]): AgentGuaranteeProofValueRef {
	const row = isRecord(value) ? value : {};
	const commandId = stringValue(row.commandId);
	const valuePath = stringValue(row.path);
	if (!ID.test(commandId)) issues.push(`${path}.commandId must be a stable command id.`);
	if (!valuePath) issues.push(`${path}.path is required.`);
	if (PLACEHOLDER.test(valuePath)) issues.push(`${path}.path contains an unresolved placeholder.`);
	return { commandId, path: valuePath };
}

function command(value: unknown, index: number, variant: string, issues: string[]): AgentGuaranteeProofCommand {
	const row = isRecord(value) ? value : {};
	const id = stringValue(row.id);
	const args = stringArray(row.args);
	const kind = stringValue(row.kind);
	const expectedExitCode = Number(row.expectedExitCode);
	const path = `commands[${index}]`;
	if (!ID.test(id)) issues.push(`${path}.id must be stable lowercase kebab-case.`);
	if (!args.length || !ALLOWED_ROOTS.has(args[0]) || FORBIDDEN_ROOTS.has(args[0])) issues.push(`${path}.args must start with an allowed trsd command.`);
	if (args.some((entry)=>PLACEHOLDER.test(entry))) issues.push(`${path}.args contains unresolved placeholders.`);
	const action=`${args[0]}.${args[1]??''}`;
	for(const selector of EXACT_SELECTORS[action]??[]) if(!args.includes(selector)) issues.push(`${path} ${action} requires exact selector ${selector}.`);
	if(['capacity','governance','projects'].includes(args[0])&&!args.includes('--market')) issues.push(`${path} must name the exact --market.`);
	if (!COMMAND_KINDS.has(kind)) issues.push(`${path}.kind is invalid.`);
	if (!Number.isInteger(expectedExitCode) || expectedExitCode < 0) issues.push(`${path}.expectedExitCode must be a nonnegative integer.`);
	if (kind === 'read' && args.includes('--execute')) issues.push(`${path} classifies an executing mutation as a read.`);
	if (args[0] === 'governance' && !GOVERNANCE_READS.has(args[1]) && kind !== 'simulated-human-mutation') issues.push(`${path} governance mutations must be classified as simulated-human-mutation.`);
	if (kind === 'operator-mutation' && (!args.includes('--execute') || !args.includes('--idempotency-key'))) issues.push(`${path} operator mutations require --execute and --idempotency-key.`);
	if (kind === 'simulated-human-mutation') {
		for (const flag of ['--simulate-human','--workday','--reason','--idempotency-key']) if (!args.includes(flag)) issues.push(`${path} simulated-human mutations require ${flag}.`);
		if (args[0] === 'governance' && ['proposal-vote','proposal-evaluate','proposal-admin-decide'].includes(args[1]) && !args.includes('--yes')) issues.push(`${path} binding governance requires --yes.`);
	}
	if (kind === 'recovery' && (variant !== 'interruption-resume' || args[0] !== 'dev' || args[1] !== 'restart' || !args.includes('--app'))) issues.push(`${path} recovery commands are limited to an explicit app restart in the interruption variant.`);
	return { id, args, kind: kind as AgentGuaranteeProofCommand['kind'], expectedExitCode };
}

function predicate(value: unknown, path: string, issues: string[]): AgentGuaranteeProofPredicate {
	const row = isRecord(value) ? value : {};
	const id = stringValue(row.id);
	const operator = stringValue(row.operator);
	if (!ID.test(id)) issues.push(`${path}.id must be stable lowercase kebab-case.`);
	if (!OPERATORS.has(operator)) issues.push(`${path}.operator is invalid.`);
	if (!('expected' in row) && !row.expectedRef && !['exists','absent','distinct'].includes(operator)) issues.push(`${path} requires expected or expectedRef.`);
	return { id, ...ref(row,path,issues), operator: operator as AgentGuaranteeProofPredicate['operator'], ...('expected' in row ? { expected:row.expected } : {}), ...(row.expectedRef ? { expectedRef:ref(row.expectedRef,`${path}.expectedRef`,issues) } : {}) };
}

function outcome(value: unknown, index: number, issues: string[]): AgentGuaranteeProofOutcome {
	const row = isRecord(value) ? value : {};
	const outcomeId = stringValue(row.outcomeId);
	const path = `outcomes[${index}]`;
	const entityRows = isRecord(row.entityRefs) ? row.entityRefs : {};
	return {
		outcomeId,
		evidenceCommands:stringArray(row.evidenceCommands),
		entityRefs:Object.fromEntries(Object.entries(entityRows).map(([key,value])=>[key,ref(value,`${path}.entityRefs.${key}`,issues)])),
		predicates:(Array.isArray(row.predicates)?row.predicates:[]).map((entry,predicateIndex)=>predicate(entry,`${path}.predicates[${predicateIndex}]`,issues)),
	};
}

export function parseAgentGuaranteeProofInput(value: unknown, contract: GuaranteeCatalogContract, expectedVariant: string, expectedSourceGeneration?: string) {
	const issues:string[]=[];
	const row=isRecord(value)?value:{};
	if(row.schemaVersion!==AGENT_GUARANTEE_PROOF_SCHEMA_VERSION) issues.push(`schemaVersion must be ${AGENT_GUARANTEE_PROOF_SCHEMA_VERSION}.`);
	if(row.capabilityId!==contract.capabilityId) issues.push('capabilityId does not match the selected guarantee.');
	if(row.variant!==expectedVariant) issues.push('variant does not match the requested guarantee run.');
	const sourceGeneration=stringValue(row.sourceGeneration);
	if(!GENERATION.test(sourceGeneration)) issues.push('sourceGeneration must be one pinned 64-character lowercase hex digest.');
	if(expectedSourceGeneration&&sourceGeneration!==expectedSourceGeneration) issues.push('sourceGeneration is stale or divergent from the current guarantee run.');
	const commands=(Array.isArray(row.commands)?row.commands:[]).map((entry,index)=>command(entry,index,expectedVariant,issues));
	const outcomes=(Array.isArray(row.outcomes)?row.outcomes:[]).map((entry,index)=>outcome(entry,index,issues));
	if(!commands.length) issues.push('commands cannot be empty.');
	const commandIds=new Set(commands.map((entry)=>entry.id));
	if(commandIds.size!==commands.length) issues.push('command ids must be unique.');
	const expectedOutcomes=contract.outcomes.filter((entry)=>!entry.variants?.length||entry.variants.includes(expectedVariant));
	const outcomeIds=new Set(outcomes.map((entry)=>entry.outcomeId));
	for(const expected of expectedOutcomes) if(!outcomeIds.has(expected.id)) issues.push(`Missing proof outcome ${expected.id}.`);
	for(const candidate of outcomes) {
		const outcomeContract=expectedOutcomes.find((entry)=>entry.id===candidate.outcomeId);
		if(!outcomeContract) issues.push(`Unknown proof outcome ${candidate.outcomeId}.`);
		if(!candidate.evidenceCommands.length || !candidate.predicates.length) issues.push(`Proof outcome ${candidate.outcomeId} requires evidence commands and predicates.`);
		for(const id of candidate.evidenceCommands) if(!commandIds.has(id)) issues.push(`Proof outcome ${candidate.outcomeId} references unknown command ${id}.`);
		for(const subject of outcomeContract?.authoritativeSubjects??[]) if(!candidate.entityRefs[subject]) issues.push(`Proof outcome ${candidate.outcomeId} omits authoritative subject ${subject}.`);
		const predicateIds=new Set(candidate.predicates.map((entry)=>entry.id));
		for(const predicateId of contract.proof.outcomePredicates[candidate.outcomeId]??[]) if(!predicateIds.has(predicateId)) issues.push(`Proof outcome ${candidate.outcomeId} omits required predicate ${predicateId}.`);
	}
	const commandActions=new Set(commands.map((entry)=>`${entry.args[0]}.${entry.args[1]??''}`));
	for(const action of contract.proof.requiredCommands) if(!commandActions.has(action)) issues.push(`Proof omits required CLI command ${action}.`);
	const cleanupRow=isRecord(row.cleanup)?row.cleanup:{};
	const cleanupFields=['verified','activeAssignments','activeLeases','activeReservations','activeDemands','activeWorkspaces','activeWorktrees','unpublishedBranches','staleAuthorities'] as const;
	const cleanup={commandId:stringValue(cleanupRow.commandId),...Object.fromEntries(cleanupFields.map((field)=>[field,ref(cleanupRow[field],`cleanup.${field}`,issues)]))} as AgentGuaranteeProofInput['cleanup'];
	if(!commandIds.has(cleanup.commandId)) issues.push(`Cleanup references unknown command ${cleanup.commandId}.`);
	const repositoryPostconditions=(Array.isArray(row.repositoryPostconditions)?row.repositoryPostconditions:[]).map((entry,index)=>{
		const item=isRecord(entry)?entry:{}; const path=`repositoryPostconditions[${index}]`;
		const repository=stringValue(item.repository); if(PLACEHOLDER.test(repository)) issues.push(`${path}.repository contains an unresolved placeholder.`);
		return {repository,baseRef:ref(item.baseRef,`${path}.baseRef`,issues),effectiveRef:ref(item.effectiveRef,`${path}.effectiveRef`,issues),...(item.targetRef?{targetRef:ref(item.targetRef,`${path}.targetRef`,issues)}:{}),changedPaths:ref(item.changedPaths,`${path}.changedPaths`,issues),readBackVerified:ref(item.readBackVerified,`${path}.readBackVerified`,issues)};
	});
	if(repositoryPostconditions.length<contract.proof.minimumRepositoryPostconditions) issues.push(`Proof requires at least ${contract.proof.minimumRepositoryPostconditions} repository postconditions.`);
	const proof={schemaVersion:AGENT_GUARANTEE_PROOF_SCHEMA_VERSION,capabilityId:stringValue(row.capabilityId),variant:stringValue(row.variant),sourceGeneration,commands,outcomes,repositoryPostconditions,cleanup} as AgentGuaranteeProofInput;
	for(const candidate of [...outcomes.flatMap((entry)=>[...Object.values(entry.entityRefs),...entry.predicates,...entry.predicates.flatMap((entry)=>entry.expectedRef?[entry.expectedRef]:[])]),...repositoryPostconditions.flatMap((entry)=>[entry.baseRef,entry.effectiveRef,...(entry.targetRef?[entry.targetRef]:[]),entry.changedPaths,entry.readBackVerified]),...cleanupFields.map((field)=>cleanup[field])]) if(!commandIds.has(candidate.commandId)) issues.push(`Proof references unknown command ${candidate.commandId}.`);
	return issues.length?{ok:false as const,issues}:{ok:true as const,proof};
}
