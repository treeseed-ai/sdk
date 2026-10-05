import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { validateAgentDefinitionModel } from '../../../../../../src/capacity/agents/agent-capacity.ts';

// Native process, public SDK validator and governed YAML. Not a new runner or
// live API/provider authority: the caller supplies each isolated document.
try {
	process.stdout.write(JSON.stringify(validateAgentDefinitionModel(parse(readFileSync(0, 'utf8')))));
} catch (error) {
	process.stdout.write(JSON.stringify({ ok: false, diagnostics: [{ message: error instanceof Error ? error.message : String(error) }] }));
}
