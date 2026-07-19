import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { renderCapacityOperatorCapabilityMarkdown } from '../src/agent-capacity/contracts/operator-surface.ts';

const output = process.argv[2];
const markdown = renderCapacityOperatorCapabilityMarkdown();
if (!output) process.stdout.write(markdown);
else {
	const path = resolve(output);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, markdown, 'utf8');
	process.stdout.write(`${path}\n`);
}
