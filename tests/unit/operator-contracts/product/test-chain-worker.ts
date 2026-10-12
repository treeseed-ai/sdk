import { verifySdkCommittedTests } from '../../../acceptance/product/test-chain.ts';
const [repository, base, tester, engineer] = process.argv.slice(2);
if (!repository || !base || !tester || !engineer) throw new Error('Complete native test-chain inputs required.');
process.stdout.write(JSON.stringify(verifySdkCommittedTests(repository, base, tester, engineer)));
