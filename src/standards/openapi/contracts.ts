import type { CanonicalJsonValue } from '../canonicalize.ts';
import type { CompatibilityClassification } from '../contracts.ts';

export interface OpenApiOperationModel {
	operationId: string | null;
	security: CanonicalJsonValue;
	parameters: CanonicalJsonValue[];
	requestBody: CanonicalJsonValue | null;
	responses: Record<string, CanonicalJsonValue>;
}

export interface OpenApiContractModel {
	schemaVersion: 1;
	openapi: string;
	operations: Record<string, OpenApiOperationModel>;
}

export interface OpenApiCompatibilityFinding {
	code: string;
	path: string;
	message: string;
	classification: CompatibilityClassification;
}

export interface OpenApiCompatibilityComparison {
	classification: CompatibilityClassification;
	findings: OpenApiCompatibilityFinding[];
}
