import net from 'node:net';
import tls from 'node:tls';
import {
	getEnvironmentSuggestedValues,
	type EnvironmentScope,
	validateEnvironmentValues,
} from '../../../platform/configuration/environment.ts';
import {
	collectConfigSeedValues,
	collectEnvironmentContext,
	checkProviderConnections,
} from '../configuration/config-runtime.ts';
import {
	buildProvisioningSummary,
	createBranchPreviewDeployTarget,
	createPersistentDeployTarget,
	loadDeployState,
} from '../hosting/deployment/deploy.ts';
import {
	currentManagedBranch,
	PRODUCTION_BRANCH,
	STAGING_BRANCH,
} from '../operations/git-workflow.ts';
import { loadPlatformConfig } from '../../../platform/configuration/config.ts';
import {
	collectReconcileStatus,
	reconcileTarget,
	type RunnableBootstrapSystem,
} from '../../../reconcile/index.ts';
import type { ReconcileTarget } from '../../../reconcile/support/contracts/contracts.ts';
import { HostingAuditReport } from './hosting-audit-environment.ts';

export function formatHostingAuditReport(report: HostingAuditReport) {
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
