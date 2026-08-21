import { describe, expect, it } from 'vitest';
import * as publicAgentCapacity from '../../../src/capacity/agents/agent-capacity.ts';
import * as operatorContracts from '../../../src/operator-contracts/index.ts';

describe('operator contract public boundary', () => {
	it('publishes human contracts without direct definition authoring or deployment mutations', () => {
		expect(operatorContracts).toHaveProperty('TREESEED_COMMAND_TREE_V1');
		expect(publicAgentCapacity.compileDefaultChatActivityProfile('planner').planningIntent).toBeTruthy();
		expect(publicAgentCapacity).toHaveProperty('deriveAgentRuntimeStatus');
		expect(publicAgentCapacity).toHaveProperty('validateGroupDefinition');
		expect(publicAgentCapacity).toHaveProperty('validateGroupEdgeDefinition');
		expect(publicAgentCapacity).not.toHaveProperty('compileGroupDefinition');
		expect(publicAgentCapacity).not.toHaveProperty('authorAgentDefinitions');
		expect(publicAgentCapacity).not.toHaveProperty('planAgentDeployment');
		expect(publicAgentCapacity).not.toHaveProperty('executeAgentDeployment');
		expect(publicAgentCapacity).not.toHaveProperty('CAPACITY_OPERATOR_CAPABILITIES');
	});
});
