import { MarketClient } from '../../../../entrypoints/clients/market-client.ts';

export function checkProjectContextQueryMethod(this:MarketClient,teamId:string,projectId:string,input:{
	testId:string;idempotencyKey:string;freshForSeconds?:number;includeResult?:boolean;
}) {
	return this.request<{ok:true;payload:Record<string,unknown>}>(`/v1/teams/${encodeURIComponent(teamId)}/projects/${encodeURIComponent(projectId)}/context-query-checks`,{
		method:'POST',body:input,headers:{'Idempotency-Key':input.idempotencyKey},requireAuth:true,
	});
}
