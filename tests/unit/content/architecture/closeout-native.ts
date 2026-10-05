import { readFileSync } from 'node:fs';
import { appliedWorkdaySchema, estimateSchema } from '../../../../src/capacity/agents/agent-capacity.ts';
import * as publicContracts from '../../../../src/capacity/agents/agent-capacity.ts';
import { z } from 'zod';
import { CONTROL_PLANE_OPERATIONS, buildMcpResources } from '../../../../src/operator-contracts/index.ts';

// Independent native process, actual public owning SDK entry point. No mock or
// generated result is substituted for the validator's real observation.
const input: unknown = JSON.parse(readFileSync(0, 'utf8'));
const kind = process.argv[2];
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
const inventory = kind === 'lease' || kind === 'reservation' || kind === 'context-item' || kind === 'policy';
const schema = kind === 'context-item' ? exports.authorizedContextItemSchema
	: kind === 'policy' ? exports.workdayProfileSchema
	: inventory ? exports[`${kind}Schema`] : undefined;
if (inventory && (!(schema instanceof z.ZodType) || !Array.isArray(input))) {
	throw new Error(`Missing public ${kind} validator or native record inventory.`);
}
const result = schema instanceof z.ZodType && Array.isArray(input) ? input.map(record => schema.safeParse(record))
	: kind === 'estimate' ? estimateSchema.safeParse(input) : appliedWorkdaySchema.safeParse(input);
process.stdout.write(JSON.stringify(result));
