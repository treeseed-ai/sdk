import { requireSharedFixtureRoot } from '../src/fixture-support.ts';

process.env.TREESEED_FIXTURE_ID ??= 'treeseed-working-site';

export const sdkFixtureRoot = requireSharedFixtureRoot();
process.env.TREESEED_SDK_REPO_ROOT = sdkFixtureRoot;
