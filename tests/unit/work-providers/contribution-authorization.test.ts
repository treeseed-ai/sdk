import { describe,expect,it } from 'vitest';
import {
	parseAgentContributionAttestationBlock,renderAgentContributionAttestationBlock,
	contributionAttestationPayload,contributionAttestationPayloadDigest,verifyAgentContributionReceipt,
	TREESEED_AGENT_CONTRIBUTION_ATTESTATION_VERSION,TREESEED_CONTRIBUTION_GRANT_VERSION,
	validateAgentContributionAttestation,validateProjectContributionAuthorization,
	type AgentContributionAttestation,type ProjectContributionAuthorization,
} from '../../../src/work-providers/index.ts';

const authorization = (): ProjectContributionAuthorization => ({
	schemaVersion:TREESEED_CONTRIBUTION_GRANT_VERSION,id:'grant-sdk',generation:2,status:'active',projectId:'project-sdk',
	repository:{provider:'github',owner:'treeseed-ai',name:'sdk'},grant:{version:'dual-license-v1',digest:'sha256:grant'},receiptKey:{keyId:'local-key-1',algorithm:'Ed25519',publicKeyJwk:{kty:'OKP',crv:'Ed25519',x:'public-key'}},
	authorizedBy:{principalId:'human-adrian'},agentIds:['agent-engineer'],capacityProviderIds:['provider-local'],
	contributionModes:['agent-assisted','agent-authored'],targetBranches:['staging'],allowedActions:['populate_pr_attestation','update_pr_attestation'],
	effectiveAt:'2026-08-20T12:00:00.000Z',expiresAt:'2027-08-20T12:00:00.000Z',
});
const attestation = (): AgentContributionAttestation => ({
	schemaVersion:TREESEED_AGENT_CONTRIBUTION_ATTESTATION_VERSION,authorization:{id:'grant-sdk',generation:2,digest:'sha256:grant'},
	projectId:'project-sdk',repository:{provider:'github',owner:'treeseed-ai',name:'sdk'},assignmentId:'assignment-1',
	agentId:'agent-engineer',capacityProviderId:'provider-local',mode:'agent-authored',base:{branch:'staging',sha:'a'.repeat(40)},
	head:{branch:'codex/assignment-1',sha:'b'.repeat(40)},issuedAt:'2026-08-20T13:00:00.000Z',
	receipt:{keyId:'local-key-1',algorithm:'Ed25519',payloadDigest:'sha256:payload',signature:'signature'},
});
const expected = () => ({ projectId:'project-sdk',repository:{provider:'github',owner:'treeseed-ai',name:'sdk'},assignmentId:'assignment-1',baseBranch:'staging',baseSha:'a'.repeat(40),headBranch:'codex/assignment-1',headSha:'b'.repeat(40) });

describe('project contribution authorization', () => {
	it('accepts an active human-authorized project grant and exact-head agent attestation', () => {
		expect(validateProjectContributionAuthorization(authorization(),new Date('2026-08-20T14:00:00.000Z')).ok).toBe(true);
		expect(validateAgentContributionAttestation({authorization:authorization(),attestation:attestation(),expected:expected(),now:new Date('2026-08-20T14:00:00.000Z')})).toEqual({ok:true,diagnostics:[]});
	});
	it.each([
		['stale head',(value:AgentContributionAttestation)=>{value.head.sha='c'.repeat(40);},'contribution_attestation_exact_ref_mismatch'],
		['wrong assignment',(value:AgentContributionAttestation)=>{value.assignmentId='assignment-2';},'contribution_attestation_assignment_mismatch'],
		['unauthorized provider',(value:AgentContributionAttestation)=>{value.capacityProviderId='provider-other';},'contribution_attestation_provider_unauthorized'],
	])('fails closed for %s',(_label,mutate,code) => {
		const value=attestation(); mutate(value);
		expect(validateAgentContributionAttestation({authorization:authorization(),attestation:value,expected:expected(),now:new Date('2026-08-20T14:00:00.000Z')}).diagnostics.map((entry)=>entry.code)).toContain(code);
	});
	it('rejects revoked or expired standing authorization', () => {
		const revoked=authorization(); revoked.status='revoked'; revoked.revokedAt='2026-08-20T13:30:00.000Z';
		expect(validateProjectContributionAuthorization(revoked,new Date('2026-08-20T14:00:00.000Z')).diagnostics.map((entry)=>entry.code)).toContain('contribution_authorization_inactive');
		const expired=authorization(); expired.expiresAt='2026-08-20T13:30:00.000Z';
		expect(validateProjectContributionAuthorization(expired,new Date('2026-08-20T14:00:00.000Z')).diagnostics.map((entry)=>entry.code)).toContain('contribution_authorization_expired');
	});
	it('rejects future activation and unsupported delegated scope values', () => {
		const future=authorization(); future.effectiveAt='2026-08-20T14:01:00.000Z';
		expect(validateProjectContributionAuthorization(future,new Date('2026-08-20T14:00:00.000Z')).diagnostics.map((entry)=>entry.code)).toContain('contribution_authorization_not_yet_effective');
		const invalid=authorization() as ProjectContributionAuthorization & { contributionModes:string[]; allowedActions:string[] };
		invalid.contributionModes=['human-authored']; invalid.allowedActions=['merge_pr'];
		expect(validateProjectContributionAuthorization(invalid,new Date('2026-08-20T14:00:00.000Z')).diagnostics.map((entry)=>entry.code)).toEqual(expect.arrayContaining(['contribution_authorization_mode_invalid','contribution_authorization_action_invalid']));
	});
	it('round-trips the managed PR body block', () => {
		const value={authorization:authorization(),attestation:attestation()}; expect(parseAgentContributionAttestationBlock(renderAgentContributionAttestationBlock(value))).toEqual(value);
	});
	it('verifies a receipt signed by the project authorization key', async () => {
		const pair=await crypto.subtle.generateKey({name:'Ed25519'},true,['sign','verify']);
		const grant=authorization(); grant.receiptKey.publicKeyJwk=await crypto.subtle.exportKey('jwk',pair.publicKey);
		const value=attestation(); value.receipt.payloadDigest=await contributionAttestationPayloadDigest(value);
		const signature=await crypto.subtle.sign('Ed25519',pair.privateKey,contributionAttestationPayload(value));
		value.receipt.signature=Buffer.from(signature).toString('base64url');
		expect(await verifyAgentContributionReceipt(value,grant)).toBe(true);
		value.head.sha='c'.repeat(40);
		expect(await verifyAgentContributionReceipt(value,grant)).toBe(false);
	});
});
