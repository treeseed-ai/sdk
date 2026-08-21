import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	canonicalStandardsJson,
	createCompatibilityAttestation,
	semanticBumpResult,
	standardsSha256,
} from '../../src/standards/index.ts';
import type { SemanticVersionRequirement } from '../../src/standards/index.ts';
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
const outputPath = argument('--output');
const declared = (process.argv[process.argv.indexOf('--declared') + 1] ?? 'none') as SemanticVersionRequirement;
if (!['none', 'patch', 'minor', 'major'].includes(declared)) throw new Error('--declared must be none, patch, minor, or major.');
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as { typescript: TypeScriptApiModel; openapi: OpenApiContractModel };
const candidate = JSON.parse(readFileSync(candidatePath, 'utf8')) as { typescript: TypeScriptApiModel; openapi: OpenApiContractModel };
const typescript = compareTypeScriptApi(baseline.typescript, candidate.typescript);
const openapi = compareOpenApi(baseline.openapi, candidate.openapi);
const classification = [typescript.classification, openapi.classification].includes('breaking')
	? 'breaking'
	: [typescript.classification, openapi.classification].includes('compatible_addition') ? 'compatible_addition' : 'unchanged';
const result = semanticBumpResult(classification, declared);
const attestation = createCompatibilityAttestation({
	contractId: '@treeseed/sdk/public-contracts',
	baselineBundle: await standardsSha256(baseline), candidateBundle: await standardsSha256(candidate), result,
	findings: [...typescript.findings, ...openapi.findings],
	evidence: [{ kind: 'artifact', uri: baselinePath }, { kind: 'artifact', uri: candidatePath }],
});
writeFileSync(outputPath, `${canonicalStandardsJson(attestation)}\n`);
console.log(JSON.stringify({ ok: result.sufficient, classification, result, outputPath, digest: await standardsSha256(attestation) }));
if (!result.sufficient) process.exitCode = 1;
