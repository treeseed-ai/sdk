import type { ExecutionUsageActual } from '../types/agents.ts';
import type { ResearchCitation } from './contracts/support/research-citation.ts';
import type { ArtifactRef } from '../treedx/types.ts';
import { validateResearchCitations } from './validation/research/citation.ts';
import { validateArtifactMutationReceipt,type ArtifactMutationReceipt } from './artifact-mutation-receipt.ts';

export interface AgentToolEventReference {
	id: string;
	toolId: string;
	status: 'completed' | 'failed';
	operation?: string | null;
	startedAt?: string | null;
	completedAt?: string | null;
	durationMs?: number | null;
	derivedEventTypes: string[];
	capturedInputRef?: string | null;
	capturedOutputRef?: string | null;
}

export interface AgentContentReference {
	model: string;
	contentPath: string;
	receiptId: string;
	toolEventId: string;
	subjectId?: string | null;
	subjectField?: string | null;
	artifactKind?: string | null;
	producedByAgent?: string | null;
	commitSha?: string | null;
	ref?: string | null;
	groupIds?: string[];
}

export interface AgentSourceWorktreeReference {
	root?: string | null;
	branch?: string | null;
	baseRef?: string | null;
	changedPaths: string[];
}

export interface AgentCommitReference {
	sha: string;
	ref?: string | null;
	message?: string | null;
}

export interface AgentVerificationResult {
	status: 'passed' | 'failed' | 'not-run' | 'unknown' | string;
	summary?: string | null;
	commands?: string[];
	evidenceRefs?: string[];
}

export interface AgentSignal {
	code: string;
	severity: 'info' | 'warning' | 'error';
	message?: string | null;
	metadata?: Record<string, unknown>;
}

export interface AgentControlPlaneReference {
	kind: string;
	id: string;
	status?: string | null;
	metadata?: Record<string, unknown>;
}

export interface AgentDiagnosticReference {
	code: string;
	message?: string | null;
	retryable?: boolean | null;
	evidenceRef?: string | null;
}

/** Portable, secret-free terminal evidence emitted by AgentKernel. */
export interface AgentArtifactManifest {
	schemaVersion: 1;
	assignmentId: string;
	modeRunId: string;
	teamId: string;
	projectId: string;
	workDayId?: string | null;
	providerId: string;
	runnerId?: string | null;
	executionProviderId?: string | null;
	mode: 'planning' | 'acting';
	agentClassId: string;
	agentId: string;
	handlerId: string;
	activityType: string;
	status: 'completed' | 'returned' | 'failed';
	summary: string;
	toolEvents: AgentToolEventReference[];
	contentReferences: AgentContentReference[];
	mutationReceipts?: ArtifactMutationReceipt[];
	artifactReferences?: ArtifactRef[];
	sourceWorktree?: AgentSourceWorktreeReference;
	commit?: AgentCommitReference;
	verification: AgentVerificationResult[];
	citations: ResearchCitation[];
	signals: AgentSignal[];
	controlPlaneReferences?: AgentControlPlaneReference[];
	usage: ExecutionUsageActual[];
	diagnostics: AgentDiagnosticReference[];
	createdAt: string;
}

export function validateAgentArtifactManifest(manifest: AgentArtifactManifest, expected: {
	publishedSignals?: unknown;
	artifactContracts?: unknown;
	signalContracts?: unknown;
} = {}) {
	const invalidReceipt = (manifest.mutationReceipts ?? []).find((receipt) => {
		const validation = validateArtifactMutationReceipt(receipt);
		return !validation.ok || receipt.assignmentId !== manifest.assignmentId || receipt.modeRunId !== manifest.modeRunId
			|| receipt.teamId !== manifest.teamId || receipt.projectId !== manifest.projectId;
	});
	if (invalidReceipt) return { ok: false as const, reason: 'Artifact mutation receipt is invalid or outside the manifest authority scope.' };
	if ((manifest.artifactReferences ?? []).some((reference) => reference.contract !== 'treeseed.artifact-ref/v1'
		|| typeof reference.sha256 === 'string' && !/^[0-9a-f]{64}$/u.test(reference.sha256)
		|| 'signedUrl' in reference || 'credentials' in reference)) {
		return { ok: false as const, reason: 'Artifact references must be stable, digest-addressed, and secret-free.' };
	}
	const citationValidation = validateResearchCitations(manifest.citations, 'artifactManifest.citations');
	if (!citationValidation.ok) {
		return { ok: false as const, reason: citationValidation.diagnostics.map((diagnostic) => `${diagnostic.code} at ${diagnostic.path}`).join(', ') };
	}
	if (manifest.status !== 'completed') return { ok: true as const };
	const ids = (value: unknown) => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim())).map((entry) => entry.replace(/_/gu, '-')) : [];
	const producedSignals = new Set(manifest.signals.map((signal) => signal.code.replace(/_/gu, '-')));
	const requestedSignals = [...ids(expected.publishedSignals), ...ids(expected.signalContracts)];
	const missingSignals = requestedSignals.filter((id) => !producedSignals.has(id));
	if (missingSignals.length) return {
		ok: false as const,
		reason: `Completed agent execution omitted validated publications: ${missingSignals.map((id) => `signal:${id}`).join(', ')}.`,
	};
	const producedArtifacts = new Set(manifest.contentReferences
		.map((reference) => reference.artifactKind?.replace(/_/gu, '-')).filter(Boolean));
	const missingArtifacts = ids(expected.artifactContracts).filter((id) => !producedArtifacts.has(id));
	if (missingArtifacts.length) return {
		ok: false as const,
		reason: `Completed agent execution omitted validated publications: ${missingArtifacts.map((id) => `artifact:${id}`).join(', ')}.`,
	};
	if (manifest.contentReferences.some((reference) => reference.model === 'note' && (!reference.subjectId || !reference.subjectField))) {
		return { ok: false as const, reason: 'Completed note receipt is missing its validated subject link.' };
	}
	if (manifest.contentReferences.length || manifest.sourceWorktree || manifest.verification.length || manifest.controlPlaneReferences?.length) return { ok: true as const };
	return { ok: false as const, reason: 'Completed agent execution did not produce a TreeDX content receipt, durable control-plane output, source worktree change, or verification result.' };
}
