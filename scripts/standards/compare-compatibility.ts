import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	canonicalStandardsJson,
	createCompatibilityAttestation,
	declaredSemanticBump,
	semanticBumpResult,
	standardsSha256,
} from '../../src/standards/index.ts';
import type { SemanticVersionRequirement, StandardsContractBundle } from '../../src/standards/index.ts';
import { compareOpenApi, type OpenApiContractModel } from '../../src/standards/openapi/index.ts';
import { compareTypeScriptApi, type TypeScriptApiModel } from '../../src/standards/typescript/index.ts';

function argument(name: string) {
	const index = process.argv.indexOf(name);
	const value = index >= 0 ? process.argv[index + 1] : null;
	if (!value) throw new Error(`Missing required ${name} argument.`);
	return resolve(value);
}

const baselinePath = argument('--baseline');
const candidatePath = argument('--candidate');
const baselineBundlePath = argument('--baseline-bundle');
const candidateBundlePath = argument('--candidate-bundle');
const outputPath = argument('--output');
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as { packageVersion: string; typescript: TypeScriptApiModel; openapi: OpenApiContractModel };
const candidate = JSON.parse(readFileSync(candidatePath, 'utf8')) as { packageVersion: string; typescript: TypeScriptApiModel; openapi: OpenApiContractModel };
const baselineBundle = JSON.parse(readFileSync(baselineBundlePath, 'utf8')) as StandardsContractBundle;
const candidateBundle = JSON.parse(readFileSync(candidateBundlePath, 'utf8')) as StandardsContractBundle;
if (baselineBundle.package.version !== baseline.packageVersion || candidateBundle.package.version !== candidate.packageVersion) {
	throw new Error('Contract model versions must match their exact contract bundles.');
}
const declared = declaredSemanticBump(baseline.packageVersion, candidate.packageVersion);
const declaredArgumentIndex = process.argv.indexOf('--declared');
const declaredArgument = declaredArgumentIndex >= 0 ? process.argv[declaredArgumentIndex + 1] as SemanticVersionRequirement | undefined : undefined;
if (declaredArgument && declaredArgument !== declared) {
	throw new Error(`Declared bump ${declaredArgument} does not match version-derived bump ${declared}.`);
}
const typescript = compareTypeScriptApi(baseline.typescript, candidate.typescript);
const openapi = compareOpenApi(baseline.openapi, candidate.openapi);
const classification = [typescript.classification, openapi.classification].includes('breaking')
	? 'breaking'
	: [typescript.classification, openapi.classification].includes('compatible_addition') ? 'compatible_addition' : 'unchanged';
const result = semanticBumpResult(classification, declared, baseline.packageVersion);
const attestation = createCompatibilityAttestation({
	contractId: '@treeseed/sdk/public-contracts',
	baselineBundle: await standardsSha256(baselineBundle), candidateBundle: await standardsSha256(candidateBundle), result,
	findings: [...typescript.findings, ...openapi.findings],
	evidence: [
		{ kind: 'artifact', uri: `npm:@treeseed/sdk@${baseline.packageVersion}`, digest: await standardsSha256(baseline) },
		{ kind: 'artifact', uri: `candidate:@treeseed/sdk@${candidate.packageVersion}`, digest: await standardsSha256(candidate) },
	],
});
writeFileSync(outputPath, `${canonicalStandardsJson(attestation)}\n`);
console.log(JSON.stringify({ ok: result.sufficient, classification, result, outputPath, digest: await standardsSha256(attestation) }));
if (!result.sufficient) process.exitCode = 1;
