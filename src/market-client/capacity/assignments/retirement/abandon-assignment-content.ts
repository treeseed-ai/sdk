import { MarketClient } from '../../../../entrypoints/clients/market-client.ts';

export interface AbandonAssignmentContentRequest{
	idempotencyKey:string;
	expectedCommitShas:string[];
	reason:string;
	workdayId:string;
	simulateHuman:true;
}

export function abandonAssignmentContentMethod(this:MarketClient,teamId:string,assignmentId:string,body:AbandonAssignmentContentRequest){
	return this.request<{ok:true;payload:{assignmentId:string;projectId:string;ref:string;beforeHead:string;afterHead:null;expectedCommitShas:string[];abandonedCommitShas:string[];reason:string;workdayId:string;actorId:string;readBackVerified:true;replayed:boolean}}>(
		`/v1/teams/${encodeURIComponent(teamId)}/capacity/assignments/${encodeURIComponent(assignmentId)}/content-abandonment`,
		{method:'POST',body,headers:{'Idempotency-Key':body.idempotencyKey},requireAuth:true},
	);
}
