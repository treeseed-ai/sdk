import net from 'node:net';
import tls from 'node:tls';
import {
	getTreeseedEnvironmentSuggestedValues,
	type TreeseedEnvironmentScope,
	validateTreeseedEnvironmentValues,
} from '../../../platform/environment.ts';
import {
	collectTreeseedConfigSeedValues,
	collectTreeseedEnvironmentContext,
	checkTreeseedProviderConnections,
} from '../config-runtime.ts';
import {
	buildProvisioningSummary,
	createBranchPreviewDeployTarget,
	createPersistentDeployTarget,
	loadDeployState,
} from '../deploy.ts';
import {
	currentManagedBranch,
	PRODUCTION_BRANCH,
	STAGING_BRANCH,
} from '../git-workflow.ts';
import { loadTreeseedPlatformConfig } from '../../../platform/config.ts';
import {
	collectTreeseedReconcileStatus,
	reconcileTreeseedTarget,
	type TreeseedRunnableBootstrapSystem,
} from '../../../reconcile/index.ts';
import type { TreeseedReconcileTarget } from '../../../reconcile/contracts.ts';
import { TreeseedHostingAuditReport } from './treeseed-hosting-audit-environment.ts';

export function formatTreeseedHostingAuditReport(report: TreeseedHostingAuditReport) {
	const lines = [
		`Treeseed hosting audit (${report.environment}, ${report.repairMode ? 'repair' : 'read-only'})`,
		`Status: ${report.ok ? 'ready' : 'blocked'}`,
		`Target: ${report.target.label}`,
		'',
		'Checks:',
		...report.checks.map((check) => {
			const status = check.status.toUpperCase();
			const resource = check.resourceRef ? ` [${check.resourceRef}]` : '';
			const detail = check.detail ? ` ${check.detail}` : '';
			return `  - ${status} ${check.hostType}/${check.provider}/${check.category}: ${check.summary}${resource}${detail}`;
		}),
	];
	if (report.blockers.length > 0) {
		lines.push('', 'Blockers:', ...report.blockers.map((blocker) => `  - ${blocker}`));
	}
	if (report.warnings.length > 0) {
		lines.push('', 'Warnings:', ...report.warnings.map((warning) => `  - ${warning}`));
	}
	lines.push('', 'Next actions:', ...report.nextActions.map((action) => `  - ${action}`));
	return lines.join('\n');
}
