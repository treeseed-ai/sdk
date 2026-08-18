import type { AgentLabAssertion, AgentLabWorkdaySnapshot } from '../types.ts';

type Row = Record<string, unknown>;

export type AgentLabArtifactExpectation = {
	id: string;
	agentId: string;
	activityType: string;
	model: string;
	pathPrefix: string;
	subjectRefs: string[];
	relationFields: string[];
	requiredClaims: string[];
};

const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const strings = (value: unknown): string[] => Array.isArray(value) ? value.map(text).filter(Boolean) : [];

export function agentLabArtifactExpectations(tests: Array<{ frontmatter: Row }>): AgentLabArtifactExpectation[] {
	return tests.flatMap((test) => {
		const values = record(test.frontmatter.expect).semanticArtifacts;
		return (Array.isArray(values) ? values : []).map(record).map((value) => ({
			id: text(value.id), agentId: text(value.agentId), activityType: text(value.activityType),
			model: text(value.model), pathPrefix: text(value.pathPrefix), subjectRefs: strings(value.subjectRefs),
			relationFields: strings(value.relationFields), requiredClaims: strings(value.requiredClaims),
		})).filter((value) => value.id && value.agentId && value.activityType && value.model && value.pathPrefix);
	});
}

export function selectedAgentLabArtifactExpectations(
	tests: Array<{ frontmatter: Row }>,
	agentIds: string[],
	profiles: string[],
) {
	return agentLabArtifactExpectations(tests).filter((expectation) => agentIds.includes(expectation.agentId)
		&& profiles.includes(`${expectation.agentId}:${expectation.activityType}`));
}

export function agentLabArtifactChecks(artifact: Row, expectation: AgentLabArtifactExpectation) {
	const path = text(artifact.contentPath || artifact.path);
	const frontmatter = record(artifact.frontmatter);
	const searchableRelations = JSON.stringify({ frontmatter, subjectId: artifact.subjectId });
	const content = text(artifact.content || artifact.body).toLowerCase();
	return {
		model: text(artifact.model) === expectation.model,
		path: path.startsWith(expectation.pathPrefix),
		commit: /^[a-f0-9]{40}$/u.test(text(artifact.commitSha || artifact.ref)),
		readBack: !artifact.inspectionError,
		subjects: expectation.subjectRefs.every((subject) => searchableRelations.includes(subject)),
		relations: expectation.relationFields.every((field) => {
			const value = frontmatter[field];
			return Array.isArray(value) ? value.length > 0 : Boolean(text(value));
		}),
		claims: expectation.requiredClaims.every((claim) => content.includes(claim.toLowerCase())),
	};
}

function artifactMatches(artifact: Row, expectation: AgentLabArtifactExpectation) {
	return Object.values(agentLabArtifactChecks(artifact, expectation)).every(Boolean);
}

export function semanticArtifactAssertions(
	day: AgentLabWorkdaySnapshot,
	expectations: AgentLabArtifactExpectation[],
): AgentLabAssertion[] {
	return expectations.map((expectation) => {
		const executions = day.executions.filter((execution) => execution.agentId === expectation.agentId
			&& execution.activityType === expectation.activityType);
		const passed = executions.some((execution) => execution.artifacts.some((artifact) => artifactMatches(artifact, expectation)));
		const terminal = executions.some((execution) => ['completed', 'failed', 'cancelled', 'expired'].includes(execution.status));
		const candidates = executions.flatMap((execution) => execution.artifacts).filter((artifact) => {
			const value = record(artifact);
			return text(value.model) === expectation.model || text(value.contentPath || value.path).startsWith(expectation.pathPrefix);
		});
		const failedChecks = [...new Set(candidates.flatMap((artifact) => Object.entries(agentLabArtifactChecks(record(artifact), expectation))
			.filter(([, ok]) => !ok).map(([name]) => name)))];
		return {
			id: `semantic-artifact:${expectation.id}`,
			label: `${expectation.agentId} produced the exact ${expectation.model} repository artifact`,
			status: passed ? 'passed' : terminal ? 'failed' : 'pending',
			detail: passed ? `${expectation.pathPrefix} passed model, path, subject, relation, claim, commit, and read-back checks.`
				: candidates.length
					? `Candidate artifact failed: ${failedChecks.join(', ') || 'unknown assertion'}.`
					: `No ${expectation.model} candidate was read back under ${expectation.pathPrefix}.`,
		};
	});
}
