import { MarketClient } from '../../../../entrypoints/clients/market-client.ts';
import type { AgentDeploymentBindings,AgentDeploymentPlan,AgentDeploymentReceipt } from '../../../../agent-capacity/authoring/agent-deployment.ts';

export type AgentDeploymentRequest={
	sourceProjectId:string;targetProjectId:string;sourceRef?:string;agentId?:string;groupId?:string;
	bindings:Omit<AgentDeploymentBindings,'targetProjectId'|'targetContentRoot'>;generation?:string;deploymentId?:string;idempotencyKey?:string;
};
export type AgentDeploymentActivationEvidence={id:string;passed:boolean;evidenceRef:string;observedRef?:string};

export function planAgentDeploymentMethod(this:MarketClient,teamId:string,input:AgentDeploymentRequest){return this.request<{ok:true;payload:AgentDeploymentPlan}>(`/v1/teams/${encodeURIComponent(teamId)}/agent-deployments/plan`,{method:'POST',body:input,requireAuth:true});}
export function executeAgentDeploymentMethod(this:MarketClient,teamId:string,input:AgentDeploymentRequest&{idempotencyKey:string}){return this.request<{ok:true;payload:AgentDeploymentReceipt;replayed?:boolean}>(`/v1/teams/${encodeURIComponent(teamId)}/agent-deployments/execute`,{method:'POST',body:input,requireAuth:true});}
export function agentDeploymentMethod(this:MarketClient,teamId:string,deploymentId:string){return this.request<{ok:true;payload:Array<Record<string,unknown>>}>(`/v1/teams/${encodeURIComponent(teamId)}/agent-deployments/${encodeURIComponent(deploymentId)}`,{requireAuth:true});}
export function activateAgentDeploymentMethod(this:MarketClient,teamId:string,deploymentId:string,input:{idempotencyKey:string;prerequisiteEvidence:AgentDeploymentActivationEvidence[]}){return this.request<{ok:true;payload:Record<string,unknown>;replayed?:boolean}>(`/v1/teams/${encodeURIComponent(teamId)}/agent-deployments/${encodeURIComponent(deploymentId)}/activate`,{method:'POST',body:input,requireAuth:true});}
export function upgradeAgentDeploymentMethod(this:MarketClient,teamId:string,deploymentId:string,input:{sourceRef:string;execute:boolean;idempotencyKey?:string;generation?:string}){return this.request<{ok:true;payload:Record<string,unknown>;replayed?:boolean}>(`/v1/teams/${encodeURIComponent(teamId)}/agent-deployments/${encodeURIComponent(deploymentId)}/upgrade`,{method:'POST',body:input,requireAuth:true});}
