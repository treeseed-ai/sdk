export type StandardsErrorCode =
	| 'standards_invalid_contract'
	| 'standards_invalid_digest_input'
	| 'standards_invalid_semantic_version'
	| 'standards_duplicate_identity';

export class StandardsError extends Error {
	readonly code: StandardsErrorCode;
	readonly path?: string;

	constructor(code: StandardsErrorCode, message: string, path?: string) {
		super(message);
		this.name = 'StandardsError';
		this.code = code;
		this.path = path;
	}
}
