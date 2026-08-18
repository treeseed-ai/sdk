import { collectDeploymentReadiness, formatReadinessReport } from '../../src/operations/services/hosting/deployment/deployment-readiness.ts';

function arg(name: string) {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : null;
}

const environment = (arg('--environment') ?? 'staging') as 'local' | 'staging' | 'prod';
const strict = process.argv.includes('--strict');
const report = collectDeploymentReadiness({
	tenantRoot: process.cwd(),
	environment,
});

if (process.argv.includes('--json')) {
	console.log(JSON.stringify(report, null, 2));
} else {
	console.log(formatReadinessReport(report));
}

if (strict && !report.ok) {
	process.exitCode = 1;
}
