import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { appliedWorkdaySchema, estimateSchema } from '../../../../src/capacity/agents/agent-capacity.ts';
import * as publicContracts from '../../../../src/capacity/agents/agent-capacity.ts';
import * as treeDxContracts from '../../../../src/treedx/index.ts';
import * as portfolioContracts from '../../../../src/platform/index.ts';
import { z } from 'zod';
import { CONTROL_PLANE_OPERATIONS, buildMcpResources } from '../../../../src/operator-contracts/index.ts';
import { describeContentFrontmatterSchema, validatePortableContentData } from '../../../../src/content/validation/index.ts';
import { exportSchemaConstraints } from '../../../../src/content/validation/schema-constraints.ts';
import { zodToJsonSchema } from 'zod-to-json-schema';

// Independent native process, actual public owning SDK entry point. No mock or
// generated result is substituted for the validator's real observation.
const input: unknown = JSON.parse(readFileSync(0, 'utf8'));
const kind = process.argv[2];
if (kind === 'installed-note-inventory') {
	if (!Array.isArray(input) || !process.argv[3]) throw new Error('Installed workspace and native Note inventory required.');
	const require = createRequire(process.argv[3]);
	const entry = require.resolve('@treeseed/sdk/content-validation');
	const contracts: typeof import('../../../../src/content/validation/index.ts') = await import(pathToFileURL(entry).href);
	const held = JSON.stringify(input);
	const observations = input.map(value => contracts.validatePortableContentData('note', value));
	if (JSON.stringify(input) !== held) throw new Error('Installed validator changed supplied Note bytes.');
	process.stdout.write(JSON.stringify({ entry, observations })); process.exit(0);
}
if (kind === 'decision-inventory' || kind === 'note-inventory' || kind === 'proposal-inventory' || kind === 'question-inventory') {
	const model = kind === 'decision-inventory' ? 'decision' : kind === 'note-inventory' ? 'note' : kind === 'question-inventory' ? 'question' : 'proposal';
	if (!Array.isArray(input)) throw new Error('Native governed content inventory required.');
	process.stdout.write(JSON.stringify({ schema: zodToJsonSchema(describeContentFrontmatterSchema(model),
		{ $refStrategy: 'none', postProcess: exportSchemaConstraints }), observations: input.map(value => validatePortableContentData(model, value)) }));
	process.exit(0);
}
if (kind === 'content-records') {
	if (!Array.isArray(input)) throw new Error('Native content inventory required.');
	const result = input.map(entry => {
		if (!entry || typeof entry !== 'object' || !('model' in entry) || typeof entry.model !== 'string' || !('data' in entry)) {
			throw new Error('Native content model and supplied record required.');
		}
		return validatePortableContentData(entry.model, entry.data);
	});
	process.stdout.write(JSON.stringify(result)); process.exit(0);
}
if (kind === 'fair-ready-weights') {
	if (!Array.isArray(input)) throw new Error('Native fair selection inventory required.');
	const result = input.map(entry => {
		if (!entry || typeof entry !== 'object' || !('policy' in entry) || !('layer' in entry)
			|| !('seconds' in entry) || typeof entry.seconds !== 'number') throw new Error('Native policy fairness layer and usage required.');
		const policy = publicContracts.workdayPolicySchema.parse(entry.policy);
		if (entry.layer !== 'project' && entry.layer !== 'class') throw new Error('Unknown native fairness layer.');
		const nodes = [
			{ id: 'first', projectId: 'a', agentClass: 'a', readyAt: '2026-10-03T00:00:00Z' },
			{ id: 'second', projectId: entry.layer === 'project' ? 'b' : 'a', agentClass: 'b', readyAt: '2026-10-03T00:00:00Z' },
		];
		return publicContracts.selectFairReadyNode(nodes, [{ projectId: 'a', agentClass: 'a', seconds: entry.seconds }], policy);
	});
	process.stdout.write(JSON.stringify(result)); process.exit(0);
}
if (kind === 'result-native-usage') {
	if (!Array.isArray(input)) throw new Error('Native provider usage inventory required.');
	const values: Record<string, unknown> = { nan: NaN, 'positive-infinity': Infinity, 'negative-infinity': -Infinity };
	const result = input.map(entry => {
		if (!entry || typeof entry !== 'object' || !('record' in entry) || !('value' in entry)) throw new Error('Native result and usage value required.');
		const value = typeof entry.value === 'string' && Object.hasOwn(values, entry.value) ? values[entry.value] : entry.value;
		const record = Object.assign({}, entry.record, { usage: { elapsedSeconds: 1, native: { providerUnit: value } } });
		return publicContracts.assignmentResultSchema.safeParse(record);
	});
	process.stdout.write(JSON.stringify(result)); process.exit(0);
}
if (kind === 'workday-resource') {
	if (!Array.isArray(input)) throw new Error('Native workday resource inventory required.');
	const result = input.map(patch => {
		if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Native operation patch required.');
		const operation = Object.assign({}, CONTROL_PLANE_OPERATIONS.workdays.show.descriptor, patch);
		try { return { resources: buildMcpResources([operation]) }; }
		catch (error) { if (!(error instanceof Error)) throw error; return { error: { name: error.name, message: error.message } }; }
	});
	process.stdout.write(JSON.stringify(result));
	process.exit(0);
}
const exports: Record<string, unknown> = publicContracts;
if (kind === 'team' || kind === 'project' || kind === 'agent-registration') {
	const exported: Record<string, unknown> = kind === 'agent-registration' ? publicContracts : portfolioContracts;
	const selected = exported[kind === 'team' ? 'teamRecordSchema' : kind === 'project' ? 'projectRecordSchema' : 'agentRegistrationSchema'];
	if (!(selected instanceof z.ZodType) || !Array.isArray(input)) throw new Error('Exact public portfolio validator required.');
	process.stdout.write(JSON.stringify(input.map(record => selected.safeParse(record)))); process.exit(0);
}
if (kind === 'workspace' || kind === 'workspace-review' || kind === 'publication-receipt') {
	const exported: Record<string, unknown> = treeDxContracts;
	const selected = exported[kind === 'workspace' ? 'treeDxWorkspaceSchema' : kind === 'workspace-review' ? 'treeDxWorkspaceReviewSchema' : 'treeDxPublicationReceiptSchema'];
	if (!(selected instanceof z.ZodType) || !Array.isArray(input)) throw new Error('Exact public TreeDX custody validator required.');
	process.stdout.write(JSON.stringify(input.map(record => selected.safeParse(record)))); process.exit(0);
}
const inventory = kind === 'schedule' || kind === 'lease' || kind === 'reservation' || kind === 'context-item' || kind === 'policy' || kind === 'attempt' || kind === 'graph-revision' || kind === 'node' || kind === 'node-inventory' || kind === 'provider-offer' || kind === 'provider-state';
const schema = kind === 'schedule' ? exports.workdayScheduleSchema : kind === 'provider-offer' ? exports.providerOfferSchema : kind === 'provider-state' ? exports.providerStateSchema
	: kind === 'node' || kind === 'node-inventory' ? exports.executionNodeSchema : kind === 'context-item' ? exports.authorizedContextItemSchema
	: kind === 'policy' ? exports.workdayProfileSchema
	: kind === 'attempt' ? exports.assignmentAttemptSchema
	: kind === 'graph-revision' ? exports.graphRevisionSchema
	: inventory ? exports[`${kind}Schema`] : undefined;
if (inventory && (!(schema instanceof z.ZodType) || !Array.isArray(input))) {
	throw new Error(`Missing public ${kind} validator or native record inventory.`);
}
const result = schema instanceof z.ZodType && Array.isArray(input) ? input.map(record => schema.safeParse(record))
	: kind === 'estimate' ? estimateSchema.safeParse(input) : appliedWorkdaySchema.safeParse(input);
process.stdout.write(JSON.stringify(kind === 'node-inventory' && schema instanceof z.ZodType
	? { schema: zodToJsonSchema(schema, { $refStrategy: 'none', postProcess: exportSchemaConstraints }), observations: result } : result));
