import { describe,expect,it } from 'vitest';
import type { GuaranteeCatalogContract } from '../../../../src/guarantees/contracts/agent-guarantee-contracts.ts';
import { parseAgentGuaranteeProofInput } from '../../../../src/guarantees/contracts/parse-agent-guarantee-proof.ts';
import { createAgentGuaranteeProofTemplate } from '../../../../src/guarantees/contracts/create-agent-guarantee-proof-template.ts';

const contract:GuaranteeCatalogContract={
	capabilityId:'agent.profile.planning-outcome',catalog:'agent.system',
	activation:{minimumConsecutivePasses:3,requiredVariants:['baseline','clean-repeat','interruption-resume'],invalidateOnSourceChange:true},
	outcomes:[{id:'planning.semantic-artifact',kind:'required',description:'Exact artifact.',evidenceKinds:['treedx_read_back'],authoritativeSubjects:['assignment','artifactRef']}],
	proof:{requiredCommands:['capacity.assignment'],outcomePredicates:{'planning.semantic-artifact':['planning.model','planning.path']},minimumRepositoryPostconditions:1},
};

function input() {
	const assignment={commandId:'assignment',path:'assignment.id'};
	return {schemaVersion:'treeseed.agent-guarantee-proof/v1',capabilityId:contract.capabilityId,variant:'baseline',sourceGeneration:'a'.repeat(64),commands:[{id:'assignment',args:['capacity','assignment','--market','local','--team','team-1','--assignment','assignment-1'],kind:'read',expectedExitCode:0},{id:'cleanup',args:['platform','status'],kind:'read',expectedExitCode:0}],outcomes:[{outcomeId:'planning.semantic-artifact',evidenceCommands:['assignment'],entityRefs:{assignment,artifactRef:{commandId:'assignment',path:'assignment.lifecycleOutput.artifactManifest.artifacts[0].ref'}},predicates:[{id:'planning.model',commandId:'assignment',path:'assignment.lifecycleOutput.artifactManifest.artifacts[0].model',operator:'equals',expected:'proposal'},{id:'planning.path',commandId:'assignment',path:'assignment.lifecycleOutput.artifactManifest.artifacts[0].path',operator:'matches',expected:'^src/content/proposals/'}]}],repositoryPostconditions:[{repository:'market-content',baseRef:{commandId:'assignment',path:'assignment.baseRef'},effectiveRef:{commandId:'assignment',path:'assignment.effectiveRef'},targetRef:{commandId:'assignment',path:'assignment.targetRef'},changedPaths:{commandId:'assignment',path:'assignment.changedPaths'},readBackVerified:{commandId:'assignment',path:'assignment.readBackVerified'}}],cleanup:{commandId:'cleanup',verified:{commandId:'cleanup',path:'cleanup.verified'},activeAssignments:{commandId:'cleanup',path:'cleanup.activeAssignments'},activeLeases:{commandId:'cleanup',path:'cleanup.activeLeases'},activeReservations:{commandId:'cleanup',path:'cleanup.activeReservations'},activeDemands:{commandId:'cleanup',path:'cleanup.activeDemands'},activeWorkspaces:{commandId:'cleanup',path:'cleanup.activeWorkspaces'},activeWorktrees:{commandId:'cleanup',path:'cleanup.activeWorktrees'},unpublishedBranches:{commandId:'cleanup',path:'cleanup.unpublishedBranches'},staleAuthorities:{commandId:'cleanup',path:'cleanup.staleAuthorities'}}};
}

describe('agent guarantee proof inputs',()=>{
	it('generates a complete deliberately unresolved operator template',()=>{
		const template=createAgentGuaranteeProofTemplate({contract,variant:'baseline'});
		expect(template.outcomes[0].predicates.map((entry)=>entry.id)).toEqual(['planning.model','planning.path']);
		expect(template.cleanup.commandId).toBe('capacity-assignment-1');
		expect(template.commands.some((entry)=>entry.id==='platform-status-cleanup')).toBe(false);
		expect(parseAgentGuaranteeProofInput(template,contract,'baseline')).toMatchObject({ok:false,issues:expect.arrayContaining([expect.stringContaining('unresolved placeholder')])});
	});

	it('falls back to platform cleanup only when no exact assignment read is required',()=>{
		const withoutAssignment:GuaranteeCatalogContract={...contract,proof:{...contract.proof,requiredCommands:['capacity.workday-summary']}};
		const template=createAgentGuaranteeProofTemplate({contract:withoutAssignment,variant:'baseline'});
		expect(template.cleanup.commandId).toBe('platform-status-cleanup');
	});

	it('includes only outcomes admitted for the selected run variant',()=>{
		const scoped:GuaranteeCatalogContract={...contract,outcomes:[...contract.outcomes,{id:'planning.recovery',kind:'required',description:'Recovery only.',evidenceKinds:['replay'],variants:['interruption-resume']}],proof:{...contract.proof,outcomePredicates:{...contract.proof.outcomePredicates,'planning.recovery':['planning.replayed']}}};
		expect(createAgentGuaranteeProofTemplate({contract:scoped,variant:'baseline'}).outcomes.map((entry)=>entry.outcomeId)).toEqual(['planning.semantic-artifact']);
		expect(createAgentGuaranteeProofTemplate({contract:scoped,variant:'interruption-resume'}).outcomes.map((entry)=>entry.outcomeId)).toEqual(['planning.semantic-artifact','planning.recovery']);
	});

	it('accepts exact CLI evidence, semantic predicates, repository refs, and cleanup read-back',()=>{
		expect(parseAgentGuaranteeProofInput(input(),contract,'baseline')).toMatchObject({ok:true});
	});

	it('accepts an explicit absence assertion without fabricated expected data',()=>{
		const value=input(); value.outcomes[0].predicates[0]={id:'planning.model',commandId:'assignment',path:'assignment.persistedResult',operator:'absent'} as typeof value.outcomes[0].predicates[0];
		expect(parseAgentGuaranteeProofInput(value,contract,'baseline')).toMatchObject({ok:true});
	});

	it('rejects proof evidence from another source generation',()=>{
		expect(parseAgentGuaranteeProofInput(input(),contract,'baseline','b'.repeat(64))).toMatchObject({ok:false,issues:expect.arrayContaining([expect.stringContaining('stale or divergent')])});
	});

	it('rejects missing capability predicates and repository proof',()=>{
		const value=input(); value.outcomes[0].predicates=value.outcomes[0].predicates.slice(0,1); value.repositoryPostconditions=[];
		const result=parseAgentGuaranteeProofInput(value,contract,'baseline');
		expect(result).toMatchObject({ok:false});
		if(!result.ok) expect(result.issues.join('\n')).toMatch(/planning\.path|at least 1 repository/u);
	});

	it('rejects ungoverned mutations and recovery outside the interruption variant',()=>{
		const value=input(); value.commands.push({id:'decision',args:['governance','proposal-vote','--execute'],kind:'simulated-human-mutation',expectedExitCode:0});
		value.commands.push({id:'restart',args:['dev','restart','--app','api'],kind:'recovery',expectedExitCode:0});
		const result=parseAgentGuaranteeProofInput(value,contract,'baseline');
		expect(result).toMatchObject({ok:false});
		if(!result.ok) expect(result.issues.join('\n')).toMatch(/--simulate-human|interruption variant/u);
	});
});
