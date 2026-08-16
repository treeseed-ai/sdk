import { existsSync,readdirSync,readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { guaranteeSourceClosure,guaranteeSourceGeneration } from '../features/guarantee-source-closure.ts';
import { discoverGuarantees } from '../index/parse-verifier-registry.ts';
import { buildGuaranteeDependencyGraph } from '../index/build-guarantee-dependency-graph.ts';
import type { GuaranteeManifest } from '../index/guarantee-schema-version.ts';
import { isRecord,stringArray,stringValue } from '../index/guarantee-journey-audit-item.ts';

export type AgentGuaranteeReadiness = 'broken' | 'blocked' | 'passing' | 'active';

function readJson(path: string): Record<string, unknown> | null {
	try {
		const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function structuredResult(workspaceRoot: string, result: Record<string, unknown>) {
	for (const evidence of stringArray(result.evidence)) {
		const envelope = readJson(resolve(workspaceRoot, evidence));
		const stdout = stringValue(envelope?.stdout);
		if (!stdout) continue;
		try {
			const parsed = JSON.parse(stdout) as unknown;
			const candidate = isRecord(parsed) && isRecord(parsed.verifierResult)
				? parsed.verifierResult
				: isRecord(parsed) && isRecord(parsed.report) && isRecord(parsed.report.verifierResult)
					? parsed.report.verifierResult
					: parsed;
			if (isRecord(candidate) && candidate.schemaVersion === 'treeseed.guarantee-verifier-result/v1') return candidate;
		} catch {
			// Other evidence formats cannot contribute an activation variant.
		}
	}
	return null;
}

function currentGenerationResults(workspaceRoot: string, guaranteeId: string, generation: string) {
	const root = resolve(workspaceRoot, '.treeseed/guarantees/runs');
	if (!existsSync(root)) return [];
	return readdirSync(root).flatMap((runId) => {
		const report = readJson(resolve(root, runId, 'report.json'));
		const closure = isRecord(report?.sourceClosure) ? report.sourceClosure : {};
		const source = isRecord(closure.started) ? closure.started : null;
		if (!source || guaranteeSourceGeneration(source as ReturnType<typeof guaranteeSourceClosure>) !== generation || closure.matches !== true) return [];
		const result = Array.isArray(report?.results) ? report.results.find((entry) => isRecord(entry) && entry.id === guaranteeId) : null;
		if (!isRecord(result)) return [];
		const verifierResult = structuredResult(workspaceRoot, result);
		return [{
			runId,
			completedAt: stringValue(result.completedAt) || stringValue(report?.completedAt),
			status: stringValue(result.status),
			variant: stringValue(verifierResult?.variant),
			failedAssertions: Array.isArray(verifierResult?.assertions)
				? verifierResult.assertions.filter((entry) => isRecord(entry) && entry.status !== 'passed').map((entry) => stringValue((entry as Record<string, unknown>).id)).filter(Boolean)
				: [],
			entityRefs: Array.isArray(verifierResult?.assertions) ? Object.assign({},...verifierResult.assertions.filter(isRecord).map((entry)=>isRecord(entry.entityRefs)?entry.entityRefs:{})) : {},
			evidence: stringArray(result.evidence),
		}];
	}).sort((a, b) => a.completedAt.localeCompare(b.completedAt));
}

function readinessFor(workspaceRoot: string, manifest: GuaranteeManifest, generation: string) {
	const contract = manifest.catalogContract!;
	const attempts = currentGenerationResults(workspaceRoot, manifest.id, generation);
	let streak: typeof attempts = [];
	for (const attempt of attempts) streak = attempt.status === 'passed' && attempt.variant ? [...streak, attempt] : [];
	const covered = new Set(streak.map((entry) => entry.variant));
	const missingVariants = contract.activation.requiredVariants.filter((variant) => !covered.has(variant));
	const latest = attempts.at(-1);
	const builtInProof = contract.capabilityId === 'agent.context.dynamic-readiness';
	const activationIssues=(contract.activation.distinctEntityRefs??[]).flatMap((requirement)=>{
		const values=requirement.variants.map((variant)=>stringValue(attempts.findLast((attempt)=>attempt.variant===variant)?.entityRefs?.[requirement.subject]));
		return values.every(Boolean)&&new Set(values).size===values.length?[]:[`Entity ref ${requirement.subject} must be present and distinct across ${requirement.variants.join(', ')}.`];
	});
	const state: AgentGuaranteeReadiness = latest?.status && latest.status !== 'passed'
		? 'broken'
		: streak.length >= contract.activation.minimumConsecutivePasses && missingVariants.length === 0 && activationIssues.length===0
			? 'active'
			: streak.length > 0
				? 'passing'
				: 'blocked';
	return {
		id: manifest.id,
		capabilityId: contract.capabilityId,
		catalog: contract.catalog,
		state,
		manifestStatus: manifest.status,
		passingStreak: streak.length,
		requiredPasses: contract.activation.minimumConsecutivePasses,
		coveredVariants: [...covered].sort(),
		missingVariants,
		lastRunId: latest?.runId ?? null,
		lastCompletedAt: latest?.completedAt ?? null,
		failedAssertions: latest?.status === 'failed' ? latest.failedAssertions : [],
		evidence: latest?.evidence ?? [],
		activationIssues,
		proofReadiness: {
			requiresProofInput: !builtInProof,
			requiredCommands: contract.proof.requiredCommands,
			outcomePredicates: contract.proof.outcomePredicates,
			minimumRepositoryPostconditions: contract.proof.minimumRepositoryPostconditions,
			invocation: `trsd guarantees run --id ${manifest.id} --prove-planned --variant <baseline|clean-repeat|interruption-resume>${builtInProof?'':' --proof-input <workspace-relative-json>'} --no-dependencies --json`,
		},
	};
}

export function createAgentGuaranteeCatalogStatus(input: { workspaceRoot: string; catalog?: string }) {
	const registry = discoverGuarantees({ workspaceRoot: input.workspaceRoot });
	const generation = guaranteeSourceGeneration(guaranteeSourceClosure(input.workspaceRoot));
	const ordered = buildGuaranteeDependencyGraph({ guarantees: registry.guarantees });
	const manifests = ordered.entries
		.map((entry) => entry.manifest)
		.filter((manifest): manifest is GuaranteeManifest => Boolean(manifest?.catalogContract && (!input.catalog || manifest.catalogContract.catalog === input.catalog)));
	const manifestById = new Map(manifests.map((manifest) => [manifest.id, manifest]));
	const entryById = new Map<string,ReturnType<typeof readinessFor>>();
	for (const manifest of manifests) {
		const entry = readinessFor(input.workspaceRoot, manifest, generation);
		const blockedBy = manifest.dependencies.guarantees.filter((id) => manifestById.has(id) && entryById.get(id)?.state !== 'active');
		entryById.set(manifest.id, { ...entry, state: entry.state === 'broken' || blockedBy.length === 0 ? entry.state : 'blocked', blockedBy });
	}
	const entries = manifests.map((manifest) => entryById.get(manifest.id)!);
	return {
		schemaVersion: 'treeseed.agent-guarantee-catalog-status/v1' as const,
		ok: registry.ok,
		generation,
		entries,
		counts: {
			total: entries.length,
			broken: entries.filter((entry) => entry.state === 'broken').length,
			blocked: entries.filter((entry) => entry.state === 'blocked').length,
			passing: entries.filter((entry) => entry.state === 'passing').length,
			active: entries.filter((entry) => entry.state === 'active').length,
		},
		diagnostics: registry.diagnostics,
	};
}
