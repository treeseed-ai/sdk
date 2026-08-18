import { diagnostic,isRecord,stringArray,stringValue } from '../index/guarantee-journey-audit-item.ts';
import { existsSync } from 'node:fs';
import { isAbsolute,relative,resolve } from 'node:path';
import type { GuaranteeDiagnostic } from '../index/guarantee-schema-version.ts';
import { GUARANTEE_VERIFIER_RESULT_SCHEMA_VERSION,type GuaranteeCatalogContract,type GuaranteeOutcomeAssertion,type GuaranteeVerifierResult } from './agent-guarantee-contracts.ts';

const ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u;

function positiveInteger(value: unknown) {
	return Number.isInteger(value) && Number(value) > 0 ? Number(value) : 0;
}

function assertions(value: unknown, diagnostics: GuaranteeDiagnostic[], sourcePath: string) {
	if (!Array.isArray(value) || value.length === 0) {
		diagnostics.push(diagnostic('error', 'guarantee.v2_outcomes_required', 'v2 guarantees require at least one structured outcome.', 'outcomes', sourcePath));
		return [];
	}
	const parsed: GuaranteeOutcomeAssertion[] = [];
	for (const [index, candidate] of value.entries()) {
		const path = `outcomes[${index}]`;
		if (!isRecord(candidate)) {
			diagnostics.push(diagnostic('error', 'guarantee.v2_outcome_invalid', 'Outcome assertions must be objects.', path, sourcePath));
			continue;
		}
		const id = stringValue(candidate.id);
		const kind = stringValue(candidate.kind);
		const description = stringValue(candidate.description);
		const evidenceKinds = stringArray(candidate.evidenceKinds);
		if (!ID.test(id)) diagnostics.push(diagnostic('error', 'guarantee.v2_outcome_id_invalid', `Invalid outcome id "${id}".`, `${path}.id`, sourcePath));
		if (kind !== 'required' && kind !== 'forbidden') diagnostics.push(diagnostic('error', 'guarantee.v2_outcome_kind_invalid', 'Outcome kind must be required or forbidden.', `${path}.kind`, sourcePath));
		if (!description) diagnostics.push(diagnostic('error', 'guarantee.v2_outcome_description_required', 'Outcome description is required.', `${path}.description`, sourcePath));
		if (evidenceKinds.length === 0) diagnostics.push(diagnostic('error', 'guarantee.v2_outcome_evidence_required', 'Outcome evidenceKinds cannot be empty.', `${path}.evidenceKinds`, sourcePath));
		parsed.push({ id, kind: kind as GuaranteeOutcomeAssertion['kind'], description, evidenceKinds, authoritativeSubjects: stringArray(candidate.authoritativeSubjects),variants:stringArray(candidate.variants) });
	}
	if (new Set(parsed.map((entry) => entry.id)).size !== parsed.length) diagnostics.push(diagnostic('error', 'guarantee.v2_duplicate_outcome', 'Outcome ids must be unique within a guarantee.', 'outcomes', sourcePath));
	return parsed;
}

export function parseGuaranteeCatalogContract(value: Record<string, unknown>, diagnostics: GuaranteeDiagnostic[], sourcePath: string): GuaranteeCatalogContract {
	const capabilityId = stringValue(value.capabilityId);
	const catalog = stringValue(value.catalog);
	const activation = isRecord(value.activation) ? value.activation : {};
	const minimumConsecutivePasses = positiveInteger(activation.minimumConsecutivePasses);
	const requiredVariants = stringArray(activation.requiredVariants);
	const distinctEntityRefs=(Array.isArray(activation.distinctEntityRefs)?activation.distinctEntityRefs:[]).map((entry,index)=>{
		const row=isRecord(entry)?entry:{}; const subject=stringValue(row.subject); const variants=stringArray(row.variants);
		if(!subject||variants.length<2) diagnostics.push(diagnostic('error','guarantee.v2_activation_distinct_refs_invalid','Distinct entity refs require one subject and at least two variants.',`activation.distinctEntityRefs[${index}]`,sourcePath));
		for(const variant of variants) if(!requiredVariants.includes(variant)) diagnostics.push(diagnostic('error','guarantee.v2_activation_distinct_variant_invalid',`Distinct entity ref references unadmitted variant ${variant}.`,`activation.distinctEntityRefs[${index}].variants`,sourcePath));
		return {subject,variants};
	});
	if (!ID.test(capabilityId)) diagnostics.push(diagnostic('error', 'guarantee.v2_capability_id_invalid', `Invalid capabilityId "${capabilityId}".`, 'capabilityId', sourcePath));
	if (!ID.test(catalog)) diagnostics.push(diagnostic('error', 'guarantee.v2_catalog_invalid', `Invalid catalog "${catalog}".`, 'catalog', sourcePath));
	if (!minimumConsecutivePasses) diagnostics.push(diagnostic('error', 'guarantee.v2_activation_passes_invalid', 'minimumConsecutivePasses must be a positive integer.', 'activation.minimumConsecutivePasses', sourcePath));
	if (requiredVariants.length === 0) diagnostics.push(diagnostic('error', 'guarantee.v2_activation_variants_required', 'requiredVariants cannot be empty.', 'activation.requiredVariants', sourcePath));
	if (activation.invalidateOnSourceChange !== true) diagnostics.push(diagnostic('error', 'guarantee.v2_source_invalidation_required', 'v2 activation must invalidate on source change.', 'activation.invalidateOnSourceChange', sourcePath));
	const proof=isRecord(value.proof)?value.proof:{};
	const requiredCommands=stringArray(proof.requiredCommands);
	const outcomePredicateRows=isRecord(proof.outcomePredicates)?proof.outcomePredicates:{};
	const outcomePredicates=Object.fromEntries(Object.entries(outcomePredicateRows).map(([id,predicates])=>[id,stringArray(predicates)]));
	const minimumRepositoryPostconditions=Number(proof.minimumRepositoryPostconditions);
	if(!requiredCommands.length) diagnostics.push(diagnostic('error','guarantee.v2_proof_commands_required','v2 guarantees require proof.requiredCommands.','proof.requiredCommands',sourcePath));
	if(!Number.isInteger(minimumRepositoryPostconditions)||minimumRepositoryPostconditions<0) diagnostics.push(diagnostic('error','guarantee.v2_proof_repository_count_invalid','proof.minimumRepositoryPostconditions must be a nonnegative integer.','proof.minimumRepositoryPostconditions',sourcePath));
	const parsedOutcomes=assertions(value.outcomes, diagnostics, sourcePath);
	for(const outcome of parsedOutcomes) for(const variant of outcome.variants??[]) if(!requiredVariants.includes(variant)) diagnostics.push(diagnostic('error','guarantee.v2_outcome_variant_invalid',`Outcome ${outcome.id} references unadmitted variant ${variant}.`,`outcomes.${outcome.id}.variants`,sourcePath));
	for(const outcome of parsedOutcomes) if(!outcomePredicates[outcome.id]?.length) diagnostics.push(diagnostic('error','guarantee.v2_proof_predicates_required',`Outcome ${outcome.id} requires named proof predicates.`,`proof.outcomePredicates.${outcome.id}`,sourcePath));
	return {
		capabilityId,
		catalog,
		outcomes: parsedOutcomes,
		activation: { minimumConsecutivePasses, requiredVariants, invalidateOnSourceChange: activation.invalidateOnSourceChange === true,distinctEntityRefs },
		proof:{requiredCommands,outcomePredicates,minimumRepositoryPostconditions:Number.isInteger(minimumRepositoryPostconditions)?minimumRepositoryPostconditions:0},
		supersedes: stringArray(value.supersedes),
		...(stringValue(value.supersededBy) ? { supersededBy: stringValue(value.supersededBy) } : {}),
	};
}

function resultPayload(stdout: string): Record<string, unknown> | null {
	try {
		const parsed = JSON.parse(stdout.trim()) as unknown;
		if (!isRecord(parsed)) return null;
		if (isRecord(parsed.verifierResult)) return parsed.verifierResult;
		if (isRecord(parsed.report) && isRecord(parsed.report.verifierResult)) return parsed.report.verifierResult;
		return parsed;
	} catch {
		return null;
	}
}

export function validateGuaranteeVerifierResult(input: {
	stdout: string;
	guaranteeId: string;
	contract: GuaranteeCatalogContract;
	sourceGeneration: string;
	expectedVariant?: string;
	workspaceRoot?: string;
}) {
	const value = resultPayload(input.stdout);
	if (!value) return { ok: false as const, error: 'Verifier stdout did not contain one JSON result object.' };
	if (value.schemaVersion !== GUARANTEE_VERIFIER_RESULT_SCHEMA_VERSION) return { ok: false as const, error: `Verifier result must use ${GUARANTEE_VERIFIER_RESULT_SCHEMA_VERSION}.` };
	if (value.guaranteeId !== input.guaranteeId || value.capabilityId !== input.contract.capabilityId) return { ok: false as const, error: 'Verifier result identifies a different guarantee or capability.' };
	if (value.sourceGeneration !== input.sourceGeneration) return { ok: false as const, error: 'Verifier result source generation is stale or divergent.' };
	if (!input.contract.activation.requiredVariants.includes(String(value.variant))) return { ok: false as const, error: `Verifier result variant "${String(value.variant)}" is not admitted by the guarantee.` };
	if (input.expectedVariant && value.variant !== input.expectedVariant) return { ok: false as const, error: `Verifier result variant "${String(value.variant)}" does not match requested variant "${input.expectedVariant}".` };
	if (!Array.isArray(value.assertions)) return { ok: false as const, error: 'Verifier result assertions are required.' };
	const assertions = value.assertions.filter(isRecord);
	const byId = new Map(assertions.map((entry) => [stringValue(entry.id), entry]));
	for (const outcome of input.contract.outcomes.filter((entry)=>!entry.variants?.length||entry.variants.includes(String(value.variant)))) {
		const result = byId.get(outcome.id);
		if (!result || result.status !== 'passed') return { ok: false as const, error: `Required outcome ${outcome.id} did not pass.` };
		const evidence = stringArray(result.evidence);
		if (evidence.length === 0) return { ok: false as const, error: `Outcome ${outcome.id} has no evidence.` };
		if (input.workspaceRoot && evidence.some((path) => !admissibleEvidencePath(input.workspaceRoot!, path))) return { ok: false as const, error: `Outcome ${outcome.id} refers to missing or unsafe evidence.` };
		if (outcome.authoritativeSubjects?.length) {
			if (!isRecord(result.entityRefs) || outcome.authoritativeSubjects.some((subject) => !stringValue(result.entityRefs?.[subject]))) {
				return { ok: false as const, error: `Outcome ${outcome.id} omits authoritative subject identities.` };
			}
		}
	}
	if (!Array.isArray(value.repositoryPostconditions)) return { ok: false as const, error: 'Verifier repository postconditions are required.' };
	for (const [index, candidate] of value.repositoryPostconditions.entries()) {
		if (!isRecord(candidate) || !stringValue(candidate.repository) || !stringValue(candidate.baseRef) || !stringValue(candidate.effectiveRef)) return { ok: false as const, error: `Repository postcondition ${index} omits exact repository or ref identity.` };
		if (!Array.isArray(candidate.changedPaths) || candidate.changedPaths.some((path) => !stringValue(path))) return { ok: false as const, error: `Repository postcondition ${index} has invalid changed paths.` };
		if (candidate.readBackVerified !== true) return { ok: false as const, error: `Repository postcondition ${index} lacks authoritative read-back.` };
	}
	const rootEvidence = stringArray(value.evidence);
	if (rootEvidence.length === 0) return { ok: false as const, error: 'Verifier result evidence paths are required.' };
	if (input.workspaceRoot && rootEvidence.some((path) => !admissibleEvidencePath(input.workspaceRoot!, path))) return { ok: false as const, error: 'Verifier result refers to missing or unsafe evidence.' };
	if (!isRecord(value.cleanup) || value.cleanup.verified !== true) return { ok: false as const, error: 'Verifier result does not prove cleanup.' };
	for (const field of ['activeAssignments','activeLeases','activeReservations','activeDemands','activeWorkspaces','activeWorktrees','unpublishedBranches','staleAuthorities']) {
		if (value.cleanup[field] !== 0) return { ok: false as const, error: `Verifier cleanup field ${field} is not zero.` };
	}
	return { ok: true as const, result: value as unknown as GuaranteeVerifierResult };
}

function admissibleEvidencePath(workspaceRoot:string,path:string) {
	if (!path || isAbsolute(path)) return false;
	const target=resolve(workspaceRoot,path); const traversal=relative(resolve(workspaceRoot),target);
	return traversal!==''&&!traversal.startsWith('..')&&!isAbsolute(traversal)&&existsSync(target);
}
