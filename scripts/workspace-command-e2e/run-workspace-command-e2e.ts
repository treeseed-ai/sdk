#!/usr/bin/env node

import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import yaml from 'yaml';
import { packageScriptPath } from '../src/operations/services/runtime-tools.ts';
import { collectCliPreflight, createWranglerCommandEnv, formatCliPreflightReport, writeJsonArtifact } from '../src/operations/services/workspace-preflight.ts';
import { ensureDeployWorkflow, parseGitHubRepositoryFromRemote } from '../src/operations/services/github-automation.ts';
import { MERGE_CONFLICT_EXIT_CODE } from '../src/operations/services/workspace-save.ts';
import { createTempDir, run, workspacePackages, workspaceRoot } from '../src/operations/services/workspace-tools.ts';
import { artifactsRoot, log, report, runLocal, runStaging, writeReport } from './root.ts';
import { runLocalSuite, runStagingSuite } from './run-local-suite.ts';

(async () => {
	try {
		if (runLocal) {
			await runLocalSuite();
		}
		if (runStaging) {
			await runStagingSuite();
		}
		report.summary.ok = true;
		writeReport();
		console.log(`Treeseed command E2E completed successfully. Artifacts: ${artifactsRoot}`);
	} catch (error) {
		report.summary.ok = false;
		report.summary.error = error instanceof Error ? error.message : String(error);
		writeReport();
		console.error(report.summary.error);
		console.error(`Treeseed command E2E artifacts: ${artifactsRoot}`);
		process.exit(1);
	}
})();
