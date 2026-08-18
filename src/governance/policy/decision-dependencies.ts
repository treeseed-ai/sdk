export interface DecisionDependencyReference {
	projectId: string;
	decisionId: string;
}

export interface DecisionDependencySnapshot extends DecisionDependencyReference {
	teamId: string;
	proposalId: string;
	proposalVersion: number;
	proposalContentHash: string;
}

export interface DecisionAuthoritySnapshot extends DecisionDependencySnapshot {
	decisionDependencies: DecisionDependencySnapshot[];
}

export interface DecisionAuthorityValidation {
	valid: boolean;
	code: string | null;
	message: string | null;
	current: DecisionAuthoritySnapshot | null;
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown) {
	return typeof value === 'string' ? value.trim() : '';
}

export function normalizeDecisionDependencyReferences(value: unknown): DecisionDependencyReference[] {
	if (!Array.isArray(value)) return [];
	const references = value.map(record).map((entry) => ({
		projectId: text(entry.projectId ?? entry.project_id),
		decisionId: text(entry.decisionId ?? entry.decision_id),
	})).filter((entry) => entry.projectId && entry.decisionId);
	return [...new Map(references.map((entry) => [`${entry.projectId}:${entry.decisionId}`, entry])).values()]
		.sort((left, right) => `${left.projectId}:${left.decisionId}`.localeCompare(`${right.projectId}:${right.decisionId}`));
}

export function decisionDependencyReferencesAreComplete(value: unknown) {
	return !Array.isArray(value) || value.length === normalizeDecisionDependencyReferences(value).length;
}
