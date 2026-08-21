import { describe, expect, it } from 'vitest';
import * as publicAgentCapacity from '../../../src/capacity/agents/agent-capacity.ts';
import * as operatorContracts from '../../../src/operator-contracts/index.ts';
import * as controlPlaneClient from '../../../src/entrypoints/clients/control-plane-client.ts';

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

	it('publishes only the catalog-bound control-plane client',()=>{
		expect(controlPlaneClient).toHaveProperty('ControlPlaneClient');
		expect(controlPlaneClient).toHaveProperty('resolveControlPlaneServer');
		expect(controlPlaneClient).toHaveProperty('resolveControlPlaneServerSession');
		expect(controlPlaneClient).not.toHaveProperty('MarketClient');
		expect(controlPlaneClient.ControlPlaneClient.prototype).toHaveProperty('callOperation');
	});
});
