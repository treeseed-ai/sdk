export type BuildWarningRule = {
	label: string;
	pattern: RegExp;
};

export type BuildWarningPolicyOptions = {
	useDefaultPolicy?: boolean;
	allow?: Array<string | RegExp>;
};

export type BuildWarningClassification =
	| { kind: 'not-warning' }
	| { kind: 'allowed'; label: string }
	| { kind: 'unexpected'; line: string };

export declare const DEFAULT_BUILD_WARNING_RULES: BuildWarningRule[];
export declare function createBuildWarningRules(options?: BuildWarningPolicyOptions): BuildWarningRule[];
export declare function classifyBuildWarningLine(line: string, options?: BuildWarningPolicyOptions): BuildWarningClassification;
export declare function createBuildWarningSummary(): {
	allowedWarnings: Map<string, number>;
	unexpectedWarnings: string[];
	record(line: string, options?: BuildWarningPolicyOptions): BuildWarningClassification;
};
export declare function mergeAllowedBuildWarnings(target: Map<string, number>, source: Map<string, number>): Map<string, number>;
export declare function countAllowedBuildWarnings(allowedWarnings: Map<string, number>): number;
export declare function formatAllowedBuildWarnings(allowedWarnings: Map<string, number>): string[];
export declare function scanBuildWarningText(text: string, options?: BuildWarningPolicyOptions): {
	allowedWarnings: Map<string, number>;
	unexpectedWarnings: string[];
};
