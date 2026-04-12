import {
	DEFAULT_FIXTURE_ID,
	checkSharedFixture as checkFixtureFromSdk,
	requireSharedFixtureRoot as requireFixtureRootFromSdk,
	resolveFixturesRepoRoot as resolveFixturesRepoRootFromSdk,
	resolveSharedFixtureRoot as resolveSharedFixtureRootFromSdk,
} from '../src/fixture-support.ts';

export { DEFAULT_FIXTURE_ID };

export function resolveFixturesRepoRoot() {
	return resolveFixturesRepoRootFromSdk();
}

export function resolveSharedFixtureRoot() {
	return resolveSharedFixtureRootFromSdk();
}

export function requireSharedFixtureRoot() {
	return requireFixtureRootFromSdk();
}

export function checkSharedFixture() {
	return checkFixtureFromSdk();
}

function runCli(command: string) {
	switch (command) {
		case 'resolve':
			console.log(requireSharedFixtureRoot());
			return;
		case 'check':
			console.log(`Fixture check passed (${checkSharedFixture()})`);
			return;
		default:
			throw new Error(`Unknown fixture-tools command "${command}". Use resolve or check.`);
	}
}

if (process.argv[1] && /fixture-tools\.(?:ts|js|mjs)$/.test(process.argv[1])) {
	runCli(process.argv[2] ?? 'resolve');
}
