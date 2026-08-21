import type { CompatibilityClassification } from '../contracts.ts';

export interface TypeScriptApiMember {
	name: string;
	type: string;
	optional: boolean;
	readonly: boolean;
	deprecated: boolean;
}

export interface TypeScriptApiParameter {
	name: string;
	type: string;
	optional: boolean;
	rest: boolean;
}

export interface TypeScriptApiSymbol {
	name: string;
	kind: 'class' | 'enum' | 'function' | 'interface' | 'type' | 'variable';
	deprecated: boolean;
	members: TypeScriptApiMember[];
	parameters: TypeScriptApiParameter[];
	returnType: string | null;
	definition: string | null;
}

export interface TypeScriptApiEntrypoint {
	specifier: string;
	declarationPath: string;
	symbols: TypeScriptApiSymbol[];
}

export interface TypeScriptApiModel {
	schemaVersion: 1;
	entrypoints: TypeScriptApiEntrypoint[];
}

export interface TypeScriptApiFinding {
	code: string;
	path: string;
	message: string;
	classification: CompatibilityClassification;
}

export interface TypeScriptApiComparison {
	classification: CompatibilityClassification;
	findings: TypeScriptApiFinding[];
}
