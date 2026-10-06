import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { validateAgentDefinitionModel } from '../../../../../../src/capacity/agents/agent-capacity.ts';
import { describeContentFrontmatterSchema } from '../../../../../../src/content/validation/index.ts';
import { exportSchemaConstraints } from '../../../../../../src/content/validation/schema-constraints.ts';
import { zodToJsonSchema } from 'zod-to-json-schema';

// Native process, public SDK validator and governed YAML. Not a new runner or
// live API/provider authority: the caller supplies each isolated document.
try {
	const value: unknown = parse(readFileSync(0, 'utf8'));
	if (process.argv[2] === '--inventory') {
		if (!Array.isArray(value)) throw new Error('Complete supplied profile inventory required.');
		process.stdout.write(JSON.stringify({ schema: zodToJsonSchema(describeContentFrontmatterSchema('agent'),
			{ $refStrategy: 'none', postProcess: exportSchemaConstraints }), observations: value.map(validateAgentDefinitionModel) }));
	} else process.stdout.write(JSON.stringify(validateAgentDefinitionModel(value)));
} catch (error) {
	process.stdout.write(JSON.stringify({ ok: false, diagnostics: [{ message: error instanceof Error ? error.message : String(error) }] }));
}
