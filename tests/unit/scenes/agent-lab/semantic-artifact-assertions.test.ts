import { describe,expect,it } from 'vitest';
import { agentLabArtifactChecks } from '../../../../src/scenes/agent-lab/semantic-artifact-assertions.ts';

const expectation={id:'guide-gap',agentId:'guide-writer',activityType:'planning',model:'note',pathPrefix:'src/content/notes/editorial/',subjectRefs:['core'],relationFields:['relatedObjectives'],requiredClaims:['Reader Journey','Evidence Constraints']};

describe('Agent Lab semantic artifact checks',()=>{
	it('requires exact repository identity, relation, commit, read-back, and semantic claims',()=>{
		const checks=agentLabArtifactChecks({model:'note',contentPath:'src/content/notes/editorial/gap.mdx',commitSha:'a'.repeat(40),subjectId:'core',frontmatter:{relatedObjectives:['core']},content:'## Reader Journey\n\n## Evidence Constraints'},expectation);
		expect(checks).toEqual({model:true,path:true,commit:true,readBack:true,subjects:true,relations:true,claims:true});
	});

	it('rejects a schema-shaped artifact whose content does not satisfy the agent test',()=>{
		const checks=agentLabArtifactChecks({model:'note',contentPath:'src/content/notes/editorial/gap.mdx',commitSha:'a'.repeat(40),subjectId:'core',frontmatter:{relatedObjectives:['core']},content:'Generic note'},expectation);
		expect(checks.claims).toBe(false);
	});
});
