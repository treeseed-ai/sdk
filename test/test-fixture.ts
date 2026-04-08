import path from 'node:path';

export const sdkFixtureRoot = path.resolve(import.meta.dirname, '../../fixtures/fixture-sdk-sample-site/template');

process.env.TREESEED_SDK_REPO_ROOT = sdkFixtureRoot;
