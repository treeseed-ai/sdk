import type { SdkContextPack,SdkGraphEdge,SdkGraphNode } from '../entrypoints/models/sdk-types.ts';
import { compileDeclarativeContextQuery,type DeclarativeContextQuery } from './context-query-contracts.ts';

export type ContextQueryTestDefinition = {
	queryRef?: { id:string; revision:number };
	querySetRef?: { id:string; revision:number };
	testRef: string;
	expectedIdentities: string[];
	expectedRelations: string[];
	expectedPaths?: string[];
	expectedSchemaVersions?: string[];
	resultBounds: { min:number; max:number };
	budget: { maxContextItems:number; maxTokens:number };
	maxLatencyMs?: number;
};

export type ContextQuerySetDefinition = {
	id:string;
	revision:number;
	queryRefs:Array<{ id:string; revision:number }>;
	mergePolicy:'append'|'replace';
};

export type ContextQueryTestAssertion = {
	id: string;
	passed: boolean;
	gating?: boolean;
	expected: unknown;
	actual: unknown;
};

export type ContextQueryResultStats = {
	itemCount: number;
	bytes: number;
	estimatedTokens: number;
	reportedTokens: number | null;
	identities: string[];
	relations: string[];
	paths: string[];
	schemaVersions: string[];
};

function record(value: unknown): Record<string,unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string,unknown> : {};
}

function unwrapContextPack(value: unknown): Record<string,unknown> {
	const root = record(value);
	const payload = record(root.payload);
	const context = record(payload.context);
	if (Array.isArray(root.nodes)) return root;
	if (Array.isArray(payload.nodes)) return payload;
	if (Array.isArray(context.nodes)) return context;
	return payload;
}

function graphNode(value: unknown): SdkGraphNode | null {
	const candidate = record(record(value).node ?? value);
	return typeof candidate.id === 'string' ? candidate as unknown as SdkGraphNode : null;
}

function graphEdge(value: unknown): SdkGraphEdge | null {
	const candidate = record(value);
	return typeof candidate.type === 'string' ? candidate as unknown as SdkGraphEdge : null;
}

function utf8Bytes(value: string) {
	return new TextEncoder().encode(value).byteLength;
}

function effectiveContextText(nodes: SdkGraphNode[],edges: SdkGraphEdge[]) {
	return JSON.stringify({
		nodes:nodes.map((node)=>({ id:node.id,text:node.text ?? null,data:node.data ?? null })),
		edges:edges.map((edge)=>({ sourceId:edge.sourceId,type:edge.type,targetId:edge.targetId })),
	});
}

function identityValues(node: SdkGraphNode) {
	const frontmatter = record(record(node.data).frontmatter);
	return [node.id,node.entityId,node.canonicalId,node.slug,node.path,frontmatter.id]
		.filter((value):value is string => typeof value === 'string' && value.length > 0);
}

function normalizedRelation(value: string) {
	return value.trim().toLowerCase().replaceAll('-', '_');
}

export function contextQueryResultFacts(result: unknown): ContextQueryResultStats {
	const pack = unwrapContextPack(result);
	const nodes = (Array.isArray(pack.nodes) ? pack.nodes : []).map(graphNode).filter((node):node is SdkGraphNode => Boolean(node));
	const edges = (Array.isArray(pack.edges) ? pack.edges : []).map(graphEdge).filter((edge):edge is SdkGraphEdge => Boolean(edge));
	const serialized = effectiveContextText(nodes,edges);
	const reportedTokens = typeof pack.totalTokenEstimate === 'number' ? pack.totalTokenEstimate : null;
	return {
		itemCount:nodes.length,
		bytes:utf8Bytes(serialized),
		estimatedTokens:reportedTokens ?? Math.ceil(serialized.length / 4),
		reportedTokens,
		identities:[...new Set(nodes.flatMap(identityValues))].sort(),
		relations:[...new Set(edges.map((edge) => normalizedRelation(edge.type)))].sort(),
		paths:[...new Set(nodes.flatMap((node) => typeof node.path === 'string' ? [node.path] : []))].sort(),
		schemaVersions:[...new Set(nodes.flatMap((node) => {
			const value=record(record(node.data).frontmatter).schemaVersion;
			return typeof value === 'string' ? [value] : [];
		}))].sort(),
	};
}

function semanticAssertions(test:ContextQueryTestDefinition,stats:ContextQueryResultStats):ContextQueryTestAssertion[] {
	return [
		...(test.expectedIdentities??[]).map((identity) => ({ id:`identity:${identity}`,passed:stats.identities.includes(identity),expected:identity,actual:stats.identities })),
		...(test.expectedRelations??[]).map((relation) => ({ id:`relation:${relation}`,passed:includesRelation(stats.relations,relation),expected:relation,actual:stats.relations })),
		...(test.expectedPaths??[]).map((path) => ({ id:`path:${path}`,passed:stats.paths.includes(path),expected:path,actual:stats.paths })),
		...(test.expectedSchemaVersions??[]).map((version) => ({ id:`schema-version:${version}`,passed:stats.schemaVersions.includes(version),expected:version,actual:stats.schemaVersions })),
		...(test.expectedPaths?.length ? [{ id:'unexpected-paths',passed:stats.paths.every((path) => test.expectedPaths!.includes(path)),expected:test.expectedPaths,actual:stats.paths }] : []),
		...(test.expectedSchemaVersions?.length ? [{ id:'unexpected-schema-versions',passed:stats.schemaVersions.every((version) => test.expectedSchemaVersions!.includes(version)),expected:test.expectedSchemaVersions,actual:stats.schemaVersions }] : []),
	];
}

function latencyObservation(test:ContextQueryTestDefinition,latencyMs:number):ContextQueryTestAssertion {
	return { id:'latency-target',passed:test.maxLatencyMs === undefined || latencyMs <= test.maxLatencyMs,gating:false,expected:test.maxLatencyMs ?? null,actual:latencyMs };
}

function includesRelation(relations: string[], expected: string) {
	const normalized = normalizedRelation(expected);
	return relations.includes(normalized) || relations.includes(`${normalized}s`) || relations.includes(normalized.replace(/s$/u,''));
}

export async function executeContextQueryTest(input:{
	query:DeclarativeContextQuery;
	test:ContextQueryTestDefinition;
	execute(request:Record<string,unknown>):Promise<unknown>;
	now?:()=>Date;
}) {
	if (!input.test.queryRef) return { ok:false,status:'failing' as const,phase:'identity' as const,errors:['A single-query test requires queryRef.'],warnings:[] };
	const compiled = compileDeclarativeContextQuery(input.query);
	if (!compiled.ok || !compiled.compiled) {
		return { ok:false,status:'failing' as const,phase:'compile' as const,errors:compiled.errors,warnings:compiled.warnings };
	}
	if (input.query.id !== input.test.queryRef.id || input.query.revision !== input.test.queryRef.revision) {
		return {
			ok:false,status:'stale' as const,phase:'identity' as const,
			errors:['Query id and revision do not match the immutable test reference.'],warnings:compiled.warnings,
		};
	}
	const started = performance.now();
	const checkedAt = (input.now ?? (() => new Date()))().toISOString();
	const result = await input.execute(compiled.compiled.request as unknown as Record<string,unknown>);
	const latencyMs = Math.round(performance.now() - started);
	const stats = contextQueryResultFacts(result);
	const assertions: ContextQueryTestAssertion[] = [
		{ id:'result-minimum',passed:stats.itemCount >= input.test.resultBounds.min,expected:input.test.resultBounds.min,actual:stats.itemCount },
		{ id:'result-maximum',passed:stats.itemCount <= input.test.resultBounds.max,expected:input.test.resultBounds.max,actual:stats.itemCount },
		{ id:'context-items',passed:stats.itemCount <= input.test.budget.maxContextItems,expected:input.test.budget.maxContextItems,actual:stats.itemCount },
		{ id:'token-budget',passed:stats.estimatedTokens <= input.test.budget.maxTokens,expected:input.test.budget.maxTokens,actual:stats.estimatedTokens },
		latencyObservation(input.test,latencyMs),
		...semanticAssertions(input.test,stats),
	];
	const ok = assertions.every((assertion) => assertion.gating === false || assertion.passed);
	return {
		ok,status:ok ? 'passing' as const : 'failing' as const,phase:'executed' as const,checkedAt,
		queryRef:input.test.queryRef,testRef:input.test.testRef,query:compiled.compiled.query,
		request:compiled.compiled.request,latencyMs,stats,assertions,warnings:compiled.warnings,result,
	};
}

function mergedContextResult(results: unknown[]) {
	const packs = results.map(unwrapContextPack);
	const nodes = new Map<string,unknown>();
	const edges = new Map<string,unknown>();
	for (const pack of packs) {
		for (const entry of Array.isArray(pack.nodes) ? pack.nodes : []) {
			const node = graphNode(entry); if (node) nodes.set(node.id,entry);
		}
		for (const entry of Array.isArray(pack.edges) ? pack.edges : []) {
			const edge = graphEdge(entry); if (edge) edges.set(`${edge.sourceId}:${edge.type}:${edge.targetId}`,entry);
		}
	}
	const reported = packs.map((pack) => typeof pack.totalTokenEstimate === 'number' ? pack.totalTokenEstimate : null);
	return {
		nodes:[...nodes.values()],edges:[...edges.values()],memberResults:results,
		totalTokenEstimate:reported.every((value) => value !== null) ? reported.reduce<number>((total,value) => total + Number(value),0) : undefined,
	};
}

export async function executeContextQuerySetTest(input:{
	querySet:ContextQuerySetDefinition;
	queries:DeclarativeContextQuery[];
	test:ContextQueryTestDefinition;
	execute(query:DeclarativeContextQuery,request:Record<string,unknown>):Promise<unknown>;
	now?:()=>Date;
}) {
	const expected = input.test.querySetRef;
	if (!expected || expected.id !== input.querySet.id || expected.revision !== input.querySet.revision) return {
		ok:false,status:'stale' as const,phase:'identity' as const,errors:['Query-set id and revision do not match the immutable test reference.'],warnings:[],
	};
	const byRef = new Map(input.queries.map((query) => [`${query.id}@${query.revision}`,query]));
	const ordered = input.querySet.queryRefs.map((reference) => byRef.get(`${reference.id}@${reference.revision}`));
	if (ordered.some((query) => !query)) return {
		ok:false,status:'stale' as const,phase:'identity' as const,errors:['One or more exact query-set member revisions are missing.'],warnings:[],
	};
	const started = performance.now();
	const checkedAt = (input.now ?? (() => new Date()))().toISOString();
	const memberResults:unknown[] = [];
	const requests:Record<string,unknown>[] = [];
	const warnings:string[] = [];
	for (const query of ordered as DeclarativeContextQuery[]) {
		const compiled = compileDeclarativeContextQuery(query);
		if (!compiled.ok || !compiled.compiled) return { ok:false,status:'failing' as const,phase:'compile' as const,errors:compiled.errors,warnings:[...warnings,...compiled.warnings] };
		warnings.push(...compiled.warnings); requests.push(compiled.compiled.request as unknown as Record<string,unknown>);
		memberResults.push(await input.execute(query,compiled.compiled.request as unknown as Record<string,unknown>));
	}
	const result = mergedContextResult(memberResults);
	const latencyMs = Math.round(performance.now() - started);
	const stats = contextQueryResultFacts(result);
	const assertions:ContextQueryTestAssertion[] = [
		{ id:'member-count',passed:memberResults.length === input.querySet.queryRefs.length,expected:input.querySet.queryRefs.length,actual:memberResults.length },
		{ id:'result-minimum',passed:stats.itemCount >= input.test.resultBounds.min,expected:input.test.resultBounds.min,actual:stats.itemCount },
		{ id:'result-maximum',passed:stats.itemCount <= input.test.resultBounds.max,expected:input.test.resultBounds.max,actual:stats.itemCount },
		{ id:'context-items',passed:stats.itemCount <= input.test.budget.maxContextItems,expected:input.test.budget.maxContextItems,actual:stats.itemCount },
		{ id:'token-budget',passed:stats.estimatedTokens <= input.test.budget.maxTokens,expected:input.test.budget.maxTokens,actual:stats.estimatedTokens },
		latencyObservation(input.test,latencyMs),
		...semanticAssertions(input.test,stats),
	];
	const ok = assertions.every((assertion) => assertion.gating === false || assertion.passed);
	return { ok,status:ok ? 'passing' as const : 'failing' as const,phase:'executed' as const,checkedAt,
		querySetRef:expected,testRef:input.test.testRef,querySet:input.querySet,requests,latencyMs,stats,assertions,warnings,result };
}
