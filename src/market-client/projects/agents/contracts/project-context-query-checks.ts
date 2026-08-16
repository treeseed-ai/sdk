import { MarketClient } from '../../../../entrypoints/clients/market-client.ts';

export function projectContextQueryChecksMethod(this:MarketClient,teamId:string,projectId:string) {
	return this.request<{ok:true;payload:{definitionCommit:string;unpublishedAuthoring:Array<Record<string,unknown>>;items:Array<Record<string,unknown>>;tests:Array<Record<string,unknown>>;selectableTests:Array<Record<string,unknown>>;definitions:Array<Record<string,unknown>>;selectableDefinitions:Array<Record<string,unknown>>}}>(`/v1/teams/${encodeURIComponent(teamId)}/projects/${encodeURIComponent(projectId)}/context-query-checks`,{requireAuth:true});
}
