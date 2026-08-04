export const AGENT_ARTIFACT_SCHEMA = 'treeseed.agent-artifact/v1' as const;
export type AgentArtifactKind = 'artifact' | 'signal';
export interface AgentArtifactContract {
	schemaVersion: typeof AGENT_ARTIFACT_SCHEMA;
	id: string;
	label: string;
	kind: AgentArtifactKind;
	description: string;
	mediaType: string;
	schema: Record<string, unknown>;
	relations?: string[];
}
export interface AgentArtifactValidation { ok: boolean; diagnostics: Array<{ code: string; path: string; message: string }>; value?: AgentArtifactContract }
function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
export function validateAgentArtifactContract(value: unknown): AgentArtifactValidation {
	const diagnostics: AgentArtifactValidation['diagnostics'] = [];
	if (!record(value)) return { ok: false, diagnostics: [{ code: 'agent_artifact_invalid', path: '', message: 'Artifact contract must be an object.' }] };
	const text = (key: string) => { if (typeof value[key] !== 'string' || !String(value[key]).trim()) diagnostics.push({ code: 'agent_artifact_text_required', path: key, message: `${key} must be a non-empty string.` }); };
	if (value.schemaVersion !== AGENT_ARTIFACT_SCHEMA) diagnostics.push({ code: 'agent_artifact_schema_invalid', path: 'schemaVersion', message: `schemaVersion must be ${AGENT_ARTIFACT_SCHEMA}.` });
	for (const key of ['id', 'label', 'description', 'mediaType']) text(key);
	if (!['artifact', 'signal'].includes(String(value.kind))) diagnostics.push({ code: 'agent_artifact_kind_invalid', path: 'kind', message: 'kind must be artifact or signal.' });
	if (!record(value.schema)) diagnostics.push({ code: 'agent_artifact_shape_invalid', path: 'schema', message: 'schema must be an object.' });
	if (value.relations !== undefined && (!Array.isArray(value.relations) || value.relations.some((entry) => typeof entry !== 'string'))) diagnostics.push({ code: 'agent_artifact_relations_invalid', path: 'relations', message: 'relations must contain strings.' });
	return diagnostics.length ? { ok: false, diagnostics } : { ok: true, diagnostics, value: value as unknown as AgentArtifactContract };
}
