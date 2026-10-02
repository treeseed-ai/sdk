import { readFileSync } from 'node:fs';
import { calculateAssignmentAllocation } from '../../../../src/capacity/agents/agent-capacity.ts';

// Independent process exercising the public SDK boundary, not a fabricated receipt.
const input: Parameters<typeof calculateAssignmentAllocation>[0] = JSON.parse(readFileSync(0, 'utf8'));
try {
	process.stdout.write(JSON.stringify({ result: calculateAssignmentAllocation(input) }));
} catch (error) {
	process.stdout.write(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
}
