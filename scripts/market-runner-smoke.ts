import { runTreeseedMarketRunnerSmoke } from '../src/operations/services/market-runner-smoke.ts';

function arg(name: string) {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : null;
}

const environment = (arg('--environment') ?? 'staging') === 'prod' ? 'prod' : 'staging';
const report = await runTreeseedMarketRunnerSmoke({
	tenantRoot: process.cwd(),
	environment,
	baseUrl: arg('--base-url'),
	timeoutMs: arg('--timeout-ms') ? Number(arg('--timeout-ms')) : undefined,
});

console.log(JSON.stringify(report, null, 2));
if (!report.ok) {
	process.exitCode = 1;
}
