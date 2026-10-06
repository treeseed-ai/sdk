import { readFileSync } from 'node:fs';
import { calculateAssignmentAllocation } from '../../../../src/capacity/agents/agent-capacity.ts';

// Independent process exercising the public SDK boundary, not a fabricated receipt.
type Input = Parameters<typeof calculateAssignmentAllocation>[0];
const input: Input | { cases: Input[] } = JSON.parse(readFileSync(0, 'utf8'));
function observe(value: Input) {
	try { return { result: calculateAssignmentAllocation(value) }; }
	catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
}
// Batch controlled inputs through the SAME public SDK, not a second allocator
// or one new subprocess per malformed sample. Original child bound unchanged.
process.stdout.write(JSON.stringify('cases' in input ? { cases: input.cases.map(observe) } : observe(input)));
