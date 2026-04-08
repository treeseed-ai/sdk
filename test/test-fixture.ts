import { existsSync } from 'node:fs';
import path from 'node:path';

const workspaceFixtureRoot = path.resolve(import.meta.dirname, '../../fixtures/fixture-sdk-sample-site/template');
const localFixtureRoot = path.resolve(import.meta.dirname, '../fixture');

export const sdkFixtureRoot = existsSync(path.join(workspaceFixtureRoot, 'src', 'content'))
	? workspaceFixtureRoot
	: localFixtureRoot;

process.env.TREESEED_SDK_REPO_ROOT = sdkFixtureRoot;
