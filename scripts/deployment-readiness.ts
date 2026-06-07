import { collectTreeseedDeploymentReadiness, formatTreeseedReadinessReport } from '../src/operations/services/deployment-readiness.ts';

function arg(name: string) {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : null;
}

const environment = (arg('--environment') ?? 'staging') as 'local' | 'staging' | 'prod';
const strict = process.argv.includes('--strict');
const report = collectTreeseedDeploymentReadiness({
	tenantRoot: process.cwd(),
	environment,
});

if (process.argv.includes('--json')) {
	console.log(JSON.stringify(report, null, 2));
} else {
	console.log(formatTreeseedReadinessReport(report));
}

if (strict && !report.ok) {
	process.exitCode = 1;
}
