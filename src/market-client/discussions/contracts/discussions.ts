import { MarketClient } from '../../../entrypoints/clients/market-client.ts';

export interface DiscussionMessageRequest {
	teamId:string; projectId:string; idempotencyKey:string; body:string;
	discussionId?:string; topic?:string; intent?:'discuss'|'propose';
	contextRefs?:unknown[]; fileRefs?:unknown[]; durationSeconds?:number; decisionId?:string;
	simulateHuman?:true; workdayId?:string; reason?:string;
	parentWorkdayId?:string; parentAssignmentId?:string;
}

export function discussionsMethod(this:MarketClient,projectId:string,input:{
	discussionId?:string;query?:string;collection?:'discussions'|'messages'|'events';limit?:number;after?:string;
}={}) {
	const query=new URLSearchParams({ projectId });
	if(input.discussionId)query.set('discussionId',input.discussionId);
	if(input.query)query.set('query',input.query);
	if(input.collection)query.set('collection',input.collection);
	if(input.limit)query.set('limit',String(input.limit));
	if(input.after)query.set('after',input.after);
	return this.request<{ok:true;payload:{ref:string;discussions:unknown[];messages:unknown[];events:unknown[];cursor:string}}>(`/v1/discussions?${query}`,{requireAuth:true});
}

export function createDiscussionMessageMethod(this:MarketClient,input:DiscussionMessageRequest) {
	return this.request<Record<string,unknown>>('/v1/discussions',{ method:'POST',body:input,
		headers:{'Idempotency-Key':input.idempotencyKey},requireAuth:true });
}
