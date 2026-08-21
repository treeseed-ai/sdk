import type { CanonicalJsonValue } from '../canonicalize.ts';
import type { CompatibilityClassification } from '../contracts.ts';
import type {
	OpenApiCompatibilityComparison,
	OpenApiCompatibilityFinding,
	OpenApiContractModel,
	OpenApiOperationModel,
} from './contracts.ts';

const rank: Record<CompatibilityClassification, number> = { unchanged: 0, compatible_addition: 1, breaking: 2 };
type JsonRecord = Record<string, CanonicalJsonValue>;

function isRecord(value: CanonicalJsonValue | undefined): value is JsonRecord {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function add(findings: OpenApiCompatibilityFinding[], code: string, path: string, message: string, classification: CompatibilityClassification) {
	findings.push({ code, path, message, classification });
}

function same(left: CanonicalJsonValue, right: CanonicalJsonValue) {
	return JSON.stringify(left) === JSON.stringify(right);
}

function schemaFrom(value: CanonicalJsonValue | null | undefined): CanonicalJsonValue | undefined {
	const input = value ?? undefined;
	if (!isRecord(input)) return undefined;
	if (isRecord(input.schema)) return input.schema;
	const content = isRecord(input.content) ? input.content : undefined;
	const json = content && isRecord(content['application/json']) ? content['application/json'] : undefined;
	return json && isRecord(json.schema) ? json.schema : undefined;
}

function compareSchema(
	baseline: CanonicalJsonValue | undefined,
	candidate: CanonicalJsonValue | undefined,
	path: string,
	direction: 'input' | 'output',
	findings: OpenApiCompatibilityFinding[],
) {
	if (baseline === undefined && candidate !== undefined) {
		add(findings, 'openapi_schema_added', path, 'A schema was added.', direction === 'input' ? 'breaking' : 'compatible_addition');
		return;
	}
	if (baseline !== undefined && candidate === undefined) {
		add(findings, 'openapi_schema_removed', path, 'A schema was removed.', direction === 'output' ? 'breaking' : 'compatible_addition');
		return;
	}
	if (!isRecord(baseline) || !isRecord(candidate)) {
		if (baseline !== undefined && candidate !== undefined && !same(baseline, candidate)) add(findings, 'openapi_schema_changed', path, 'A schema changed.', 'breaking');
		return;
	}
	const previousEnum = Array.isArray(baseline.enum) ? baseline.enum : [];
	const nextEnum = Array.isArray(candidate.enum) ? candidate.enum : [];
	if (previousEnum.length || nextEnum.length) {
		const removed = previousEnum.some((entry) => !nextEnum.some((next) => same(entry, next)));
		const added = nextEnum.some((entry) => !previousEnum.some((previous) => same(entry, previous)));
		if (removed && direction === 'input' || added && direction === 'output') add(findings, 'openapi_enum_contract_broken', path, 'Accepted input narrowed or possible output widened.', 'breaking');
		else if (removed || added) add(findings, 'openapi_enum_changed', path, 'An enum changed compatibly for this direction.', 'compatible_addition');
	}
	const previousProperties = isRecord(baseline.properties) ? baseline.properties : {};
	const nextProperties = isRecord(candidate.properties) ? candidate.properties : {};
	const nextRequired = new Set(Array.isArray(candidate.required) ? candidate.required.filter((entry): entry is string => typeof entry === 'string') : []);
	const previousRequired = new Set(Array.isArray(baseline.required) ? baseline.required.filter((entry): entry is string => typeof entry === 'string') : []);
	for (const name of Object.keys(previousProperties)) {
		if (!(name in nextProperties)) add(findings, 'openapi_property_removed', `${path}.properties.${name}`, 'A schema property was removed.', 'breaking');
		else compareSchema(previousProperties[name], nextProperties[name], `${path}.properties.${name}`, direction, findings);
	}
	for (const name of Object.keys(nextProperties).filter((entry) => !(entry in previousProperties))) {
		add(findings, 'openapi_property_added', `${path}.properties.${name}`, 'A schema property was added.',
			direction === 'input' && nextRequired.has(name) ? 'breaking' : 'compatible_addition');
	}
	for (const name of nextRequired) if (!previousRequired.has(name)) {
		add(findings, direction === 'input' ? 'openapi_required_input_added' : 'openapi_required_output_added', `${path}.required.${name}`,
			'A required property was added.', direction === 'input' ? 'breaking' : 'compatible_addition');
	}
	for (const name of previousRequired) if (!nextRequired.has(name)) {
		add(findings, direction === 'input' ? 'openapi_required_input_removed' : 'openapi_required_output_removed', `${path}.required.${name}`,
			'A required property was removed.', direction === 'output' ? 'breaking' : 'compatible_addition');
	}
	compareSchema(baseline.items, candidate.items, `${path}.items`, direction, findings);
	const structuralKeys = new Set(['enum', 'items', 'properties', 'required']);
	const previousConstraints = Object.fromEntries(Object.entries(baseline).filter(([key]) => !structuralKeys.has(key)));
	const nextConstraints = Object.fromEntries(Object.entries(candidate).filter(([key]) => !structuralKeys.has(key)));
	if (!same(previousConstraints, nextConstraints)) {
		add(findings, 'openapi_schema_constraint_changed', path, 'A schema type, format, composition, or constraint changed.', 'breaking');
	}
}

function compareOperation(path: string, baseline: OpenApiOperationModel, candidate: OpenApiOperationModel, findings: OpenApiCompatibilityFinding[]) {
	if (!same(baseline.security, candidate.security)) add(findings, 'openapi_security_changed', `${path}.security`, 'Operation security changed.', 'breaking');
	if (!same(baseline.parameters, candidate.parameters)) add(findings, 'openapi_parameters_changed', `${path}.parameters`, 'Operation parameters changed.', 'breaking');
	compareSchema(schemaFrom(baseline.requestBody), schemaFrom(candidate.requestBody), `${path}.requestBody`, 'input', findings);
	const statuses = new Set([...Object.keys(baseline.responses), ...Object.keys(candidate.responses)]);
	for (const status of statuses) {
		if (!(status in baseline.responses) || !(status in candidate.responses)) {
			add(findings, 'openapi_response_status_changed', `${path}.responses.${status}`, 'A response status was added or removed.', 'breaking');
			continue;
		}
		compareSchema(schemaFrom(baseline.responses[status]), schemaFrom(candidate.responses[status]), `${path}.responses.${status}`, 'output', findings);
	}
}

export function compareOpenApi(baseline: OpenApiContractModel, candidate: OpenApiContractModel): OpenApiCompatibilityComparison {
	const findings: OpenApiCompatibilityFinding[] = [];
	for (const [path, operation] of Object.entries(baseline.operations)) {
		const next = candidate.operations[path];
		if (!next) add(findings, 'openapi_operation_removed', path, 'An operation was removed.', 'breaking');
		else compareOperation(path, operation, next, findings);
	}
	for (const path of Object.keys(candidate.operations).filter((entry) => !(entry in baseline.operations))) {
		add(findings, 'openapi_operation_added', path, 'An operation was added.', 'compatible_addition');
	}
	findings.sort((left, right) => `${left.path}:${left.code}`.localeCompare(`${right.path}:${right.code}`));
	const classification = findings.reduce<CompatibilityClassification>((current, entry) => rank[entry.classification] > rank[current] ? entry.classification : current, 'unchanged');
	return { classification, findings };
}
