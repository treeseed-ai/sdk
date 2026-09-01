import { createHash } from 'node:crypto';
import type { ProviderContextCapacity } from '../../../../capacity-provider/capability-ontology.ts';
import type { AssignmentContextPack,AssignmentContextSource } from './assignment-context-pack.ts';

export interface ContextPackCandidate {
	source: Omit<AssignmentContextSource,'disposition'|'measurement'|'reason'>;
	measurement: { unit:'tokens'|'bytes'|'items';amount:number;provenance:string };
	priority: number;
	mandatory?:boolean;
	minimumBudget?:number;
	maximumBudget?:number;
	summaryMeasurement?: { unit:'tokens'|'bytes'|'items';amount:number;provenance:string };
	omissionReason?:string;
}

const canonical=(value:unknown):string=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(canonical).join(',')}]`:`{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;

export function compileAssignmentContextPack(input:{assignmentId:string;capacity:ProviderContextCapacity;candidates:ContextPackCandidate[]}):AssignmentContextPack {
	const capacityUnit=input.capacity.mode==='bounded'?input.capacity.measurement:null;
	const budgetUnit=input.capacity.mode==='bounded'?input.capacity.measurement:'bytes';
	const ordered=[...input.candidates].sort((left,right)=>Number(Boolean(right.mandatory))-Number(Boolean(left.mandatory))||Number(right.source.required)-Number(left.source.required)||right.priority-left.priority||left.source.id.localeCompare(right.source.id));
	const mandatoryAmount=ordered.filter((candidate)=>candidate.mandatory&&!candidate.omissionReason).reduce((sum,candidate)=>{
		if(candidate.measurement.unit!==budgetUnit)throw new Error(`Context source ${candidate.source.id} uses ${candidate.measurement.unit}, but the offer budgets ${budgetUnit}.`);
		return sum+candidate.measurement.amount;
	},0);
	const requiredFloor=ordered.filter((candidate)=>candidate.source.required&&!candidate.omissionReason).reduce((sum,candidate)=>{
		if(candidate.measurement.unit!==budgetUnit)throw new Error(`Context source ${candidate.source.id} uses ${candidate.measurement.unit}, but the offer budgets ${budgetUnit}.`);
		if(candidate.mandatory)return sum+candidate.measurement.amount;
		const summarized=candidate.summaryMeasurement?.unit===budgetUnit&&candidate.summaryMeasurement.amount>=(candidate.minimumBudget??0)
			?candidate.summaryMeasurement.amount:candidate.measurement.amount;
		return sum+summarized;
	},0);
	const maximumInput=input.capacity.mode==='bounded'?input.capacity.maximum-input.capacity.reservedOutput:input.capacity.transportPayloadBytes;
	if(input.capacity.mode==='bounded'&&mandatoryAmount>maximumInput)throw new Error('Mandatory context exceeds the selected provider offer maximum input capacity.');
	if(input.capacity.mode==='bounded'&&requiredFloor>maximumInput)throw new Error('Required context exceeds the selected provider offer maximum input capacity.');
	const limit=input.capacity.mode==='bounded'?Math.min(maximumInput,Math.max(input.capacity.defaultInitial,mandatoryAmount,requiredFloor)):input.capacity.transportPayloadBytes;
	const sources:AssignmentContextSource[]=[]; let consumed=0;
	for(const candidate of ordered) {
		if(candidate.omissionReason){sources.push({...candidate.source,disposition:'omitted',measurement:{...candidate.measurement,amount:0},reason:candidate.omissionReason});continue;}
		const compatible=candidate.measurement.unit===budgetUnit;
		if(!compatible) throw new Error(`Context source ${candidate.source.id} uses ${candidate.measurement.unit}, but the offer budgets ${budgetUnit}.`);
		if(candidate.maximumBudget!==undefined&&candidate.minimumBudget!==undefined&&candidate.minimumBudget>candidate.maximumBudget)throw new Error(`Context source ${candidate.source.id} has an invalid minimum/maximum budget.`);
		if(candidate.minimumBudget!==undefined&&candidate.measurement.amount<candidate.minimumBudget&&candidate.source.required)throw new Error(`Required context source ${candidate.source.id} cannot satisfy its minimum budget.`);
		if(candidate.mandatory&&consumed+candidate.measurement.amount>limit)throw new Error(`Mandatory context exceeds the selected provider offer default: ${candidate.source.id}.`);
		if(consumed+candidate.measurement.amount<=limit&&(candidate.maximumBudget===undefined||candidate.measurement.amount<=candidate.maximumBudget)) {
			sources.push({...candidate.source,disposition:'included',measurement:candidate.measurement,reason:null}); consumed+=candidate.measurement.amount; continue;
		}
		if(!candidate.mandatory&&candidate.summaryMeasurement&&consumed+candidate.summaryMeasurement.amount<=limit&&(candidate.maximumBudget===undefined||candidate.summaryMeasurement.amount<=candidate.maximumBudget)&&(candidate.minimumBudget===undefined||candidate.summaryMeasurement.amount>=candidate.minimumBudget)) {
			sources.push({...candidate.source,disposition:'summarized',measurement:candidate.summaryMeasurement,reason:'provider_context_default'}); consumed+=candidate.summaryMeasurement.amount; continue;
		}
		if(candidate.source.required) throw new Error(`Mandatory context exceeds the selected provider offer default: ${candidate.source.id}.`);
		sources.push({...candidate.source,disposition:'omitted',measurement:{...candidate.measurement,amount:0},reason:'provider_context_default'});
	}
	const totals={tokens:0,bytes:0,items:0}; for(const source of sources) totals[source.measurement.unit]+=source.measurement.amount;
	const material={schemaVersion:'treeseed.assignment-context-pack/v1' as const,assignmentId:input.assignmentId,
		capacity:{mode:input.capacity.mode,measurement:capacityUnit,defaultInitial:input.capacity.mode==='bounded'?input.capacity.defaultInitial:null,maximum:input.capacity.mode==='bounded'?input.capacity.maximum:null,
			reservedOutput:input.capacity.mode==='bounded'?input.capacity.reservedOutput:null,transportPayloadBytes:input.capacity.transportPayloadBytes,
			measurementProvenance:input.capacity.measurementProvenance},totals,sources};
	return {...material,digest:`sha256:${createHash('sha256').update(canonical(material)).digest('hex')}`};
}
