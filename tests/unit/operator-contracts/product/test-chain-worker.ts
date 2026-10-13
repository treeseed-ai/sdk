import { verifySdkCommittedTests, verifySdkPublishedBranch } from '../../../acceptance/product/test-chain.ts';
import { assignmentReferenceSchema } from '@treeseed/sdk/agent-capacity';
const [repository, base, tester, engineer, reference, integration] = process.argv.slice(2);
if (!repository || !base || !tester || !engineer) throw new Error('Complete native test-chain inputs required.');
if (reference) verifySdkPublishedBranch(repository, assignmentReferenceSchema.parse(JSON.parse(reference)));
process.stdout.write(JSON.stringify(verifySdkCommittedTests(repository, base, tester, engineer, integration ? JSON.parse(integration) : undefined)));
