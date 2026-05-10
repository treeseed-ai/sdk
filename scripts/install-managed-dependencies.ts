import { formatTreeseedDependencyFailureDetails, installTreeseedDependencies } from '../src/managed-dependencies.ts';

const force = process.argv.includes('--force');
const result = await installTreeseedDependencies({
	tenantRoot: process.cwd(),
	force,
	env: process.env,
});

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

if (!result.ok) {
	process.stderr.write(`Treeseed dependency initialization failed:\n- ${formatTreeseedDependencyFailureDetails(result)}\n`);
	process.exit(1);
}
