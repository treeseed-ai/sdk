import { readFileSync } from 'node:fs';
import { appliedWorkdaySchema, estimateSchema } from '../../../../src/capacity/agents/agent-capacity.ts';

// Independent native process, actual public owning SDK entry point. No mock or
// generated result is substituted for the validator's real observation.
const input: unknown = JSON.parse(readFileSync(0, 'utf8'));
const result = process.argv[2] === 'estimate' ? estimateSchema.safeParse(input) : appliedWorkdaySchema.safeParse(input);
process.stdout.write(JSON.stringify(result));
