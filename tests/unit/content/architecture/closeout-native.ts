import { readFileSync } from 'node:fs';
import { appliedWorkdaySchema, estimateSchema } from '../../../../src/capacity/agents/agent-capacity.ts';
import * as publicContracts from '../../../../src/capacity/agents/agent-capacity.ts';
import { z } from 'zod';

// Independent native process, actual public owning SDK entry point. No mock or
// generated result is substituted for the validator's real observation.
const input: unknown = JSON.parse(readFileSync(0, 'utf8'));
const kind = process.argv[2];
const exports: Record<string, unknown> = publicContracts;
const inventory = kind === 'lease' || kind === 'reservation' || kind === 'context-item';
const schema = kind === 'context-item' ? exports.authorizedContextItemSchema
	: inventory ? exports[`${kind}Schema`] : undefined;
if (inventory && (!(schema instanceof z.ZodType) || !Array.isArray(input))) {
	throw new Error(`Missing public ${kind} validator or native record inventory.`);
}
const result = schema instanceof z.ZodType && Array.isArray(input) ? input.map(record => schema.safeParse(record))
	: kind === 'estimate' ? estimateSchema.safeParse(input) : appliedWorkdaySchema.safeParse(input);
process.stdout.write(JSON.stringify(result));
