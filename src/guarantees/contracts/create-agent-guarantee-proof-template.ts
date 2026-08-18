import { AGENT_GUARANTEE_PROOF_SCHEMA_VERSION,type AgentGuaranteeProofInput,type GuaranteeCatalogContract } from './agent-guarantee-contracts.ts';

const idFor=(action:string,index:number)=>`${action.replaceAll('.','-')}-${index+1}`;
const ref=(commandId:string,path:string)=>({commandId,path});

export function createAgentGuaranteeProofTemplate(input:{contract:GuaranteeCatalogContract;variant:string}) {
	const commands=input.contract.proof.requiredCommands.map((action,index)=>{
		const [root,operation]=action.split('.');
		return {id:idFor(action,index),args:[root,operation,'<add-exact-scope-and-identity-options>'],kind:'read' as const,expectedExitCode:0};
	});
	const assignmentCleanup=commands.find((entry)=>entry.args[0]==='capacity'&&entry.args[1]==='assignment');
	if(!assignmentCleanup&&!commands.some((entry)=>entry.args[0]==='platform'&&entry.args[1]==='status')) commands.push({id:'platform-status-cleanup',args:['platform','status'],kind:'read',expectedExitCode:0});
	const evidenceCommand=commands[0].id;
	const cleanupCommand=(assignmentCleanup??commands.find((entry)=>entry.args[0]==='platform'&&entry.args[1]==='status'))!.id;
	const entityRef=(subject:string)=>ref(evidenceCommand,`<path-to-${subject}>`);
	const outcomes=input.contract.outcomes.filter((outcome)=>!outcome.variants?.length||outcome.variants.includes(input.variant)).map((outcome)=>({outcomeId:outcome.id,evidenceCommands:[evidenceCommand],entityRefs:Object.fromEntries((outcome.authoritativeSubjects??[]).map((subject)=>[subject,entityRef(subject)])),predicates:(input.contract.proof.outcomePredicates[outcome.id]??[]).map((id)=>({id,...ref(evidenceCommand,`<path-for-${id}>`),operator:'exists' as const}))}));
	const repositoryPostconditions=Array.from({length:input.contract.proof.minimumRepositoryPostconditions},(_,index)=>({repository:`<repository-${index+1}>`,baseRef:ref(evidenceCommand,'<path-to-base-ref>'),effectiveRef:ref(evidenceCommand,'<path-to-effective-ref>'),targetRef:ref(evidenceCommand,'<path-to-target-ref>'),changedPaths:ref(evidenceCommand,'<path-to-changed-paths>'),readBackVerified:ref(evidenceCommand,'<path-to-read-back-verification>')}));
	const cleanup={commandId:cleanupCommand,verified:ref(cleanupCommand,'<path-to-cleanup-verified>'),activeAssignments:ref(cleanupCommand,'<path-to-active-assignments>'),activeLeases:ref(cleanupCommand,'<path-to-active-leases>'),activeReservations:ref(cleanupCommand,'<path-to-active-reservations>'),activeDemands:ref(cleanupCommand,'<path-to-active-demands>'),activeWorkspaces:ref(cleanupCommand,'<path-to-active-workspaces>'),activeWorktrees:ref(cleanupCommand,'<path-to-active-worktrees>'),unpublishedBranches:ref(cleanupCommand,'<path-to-unpublished-branches>'),staleAuthorities:ref(cleanupCommand,'<path-to-stale-authorities>')};
	return {schemaVersion:AGENT_GUARANTEE_PROOF_SCHEMA_VERSION,capabilityId:input.contract.capabilityId,variant:input.variant,sourceGeneration:'<pinned-source-generation>',commands,outcomes,repositoryPostconditions,cleanup} satisfies AgentGuaranteeProofInput;
}
