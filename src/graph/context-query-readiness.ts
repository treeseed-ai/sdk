import type { ContextQueryResultStats,ContextQueryTestAssertion } from './context-query-test.ts';

export type ContextQueryCheckStatus = 'passing'|'failing'|'stale';
export type ContextQueryReadinessStatus = ContextQueryCheckStatus|'unchecked';
export type ExactContextDefinitionRef = { kind:'query'|'query-set'; id:string; revision:number; commit:string };

export type ContextQueryCheck = {
	id:string;
	teamId:string;
	projectId:string;
	testId:string;
	testRef:string;
	definition:ExactContextDefinitionRef;
	status:ContextQueryCheckStatus;
	checkedAt:string;
	expiresAt:string;
	latencyMs:number;
	stats:ContextQueryResultStats;
	assertions:ContextQueryTestAssertion[];
	resultDigest:string;
};

export function contextQueryReadiness(input:{
	check:ContextQueryCheck|null;
	definition:ExactContextDefinitionRef;
	now?:Date;
}) {
	const check = input.check;
	if (!check) return { status:'unchecked' as const,selectable:false,reason:'never_checked' as const };
	const exact = check.definition.kind === input.definition.kind && check.definition.id === input.definition.id
		&& check.definition.revision === input.definition.revision;
	if (!exact) return { status:'stale' as const,selectable:false,reason:'definition_changed' as const };
	if (Date.parse(check.expiresAt) <= (input.now ?? new Date()).getTime()) return { status:'stale' as const,selectable:false,reason:'check_expired' as const };
	if (check.status !== 'passing') return { status:check.status,selectable:false,reason:'assertions_failed' as const };
	return { status:'passing' as const,selectable:true,reason:'fresh_passing_check' as const };
}
