import { expect, it } from 'vitest';
import { postgresTransitionSelectionSchema, postgresTransferPreparationResultSchema, postgresTransferStatusSchema } from '../../../src/deployment/index.ts';
import { listCommandPaths, TREESEED_COMMAND_TREE_V1, validateCommandTree } from '../../../src/operator-contracts/index.ts';
const selection = { componentId: 'api', sourceRuntimeDigest: `sha256:${'a'.repeat(64)}`, targetRuntimeDigest: `sha256:${'b'.repeat(64)}`,
  topologyDigest: `sha256:${'c'.repeat(64)}`, configurationDigest: `sha256:${'d'.repeat(64)}`, allowLocaleConversion: false };
it('accepts exact preparation and publishes managed plan/apply/status commands', () => {
  expect(postgresTransitionSelectionSchema.parse(selection)).toEqual(selection);
  expect(listCommandPaths()).toEqual(expect.arrayContaining(['host postgres transfer prepare', 'host postgres transfer status']));
  expect(validateCommandTree(TREESEED_COMMAND_TREE_V1)).toEqual([]);
  for (const action of ['planned', 'prepared', 'noop']) expect(postgresTransferPreparationResultSchema.parse({ action, selectionDigest: selection.topologyDigest }).action).toBe(action);
});
it.each(['sql', 'password', 'path', 'connectionUri'])('rejects caller %s and requires explicit locale selection', field => {
  expect(postgresTransitionSelectionSchema.safeParse({ ...selection, [field]: 'forbidden' }).success).toBe(false);
  expect(postgresTransitionSelectionSchema.safeParse({ ...selection, allowLocaleConversion: undefined }).success).toBe(false);
});
it('rejects unsafe identifiers, inexact digests and leaked status fields', () => {
  expect(postgresTransitionSelectionSchema.safeParse({ ...selection, componentId: '../api' }).success).toBe(false);
  expect(postgresTransitionSelectionSchema.safeParse({ ...selection, targetRuntimeDigest: 'staging' }).success).toBe(false);
  expect(postgresTransferStatusSchema.parse(null)).toBeNull();
  const state = { schemaVersion: 'treeseed.postgres-transfer-journal/v1', intentDigest: selection.topologyDigest,
    restoreGeneration: 7, restoreDigest: selection.configurationDigest, stage: 'recovery-required' };
  expect(postgresTransferStatusSchema.parse(state)).toEqual(state);
  expect(postgresTransferStatusSchema.safeParse({ ...state, password: 'forbidden' }).success).toBe(false);
});
