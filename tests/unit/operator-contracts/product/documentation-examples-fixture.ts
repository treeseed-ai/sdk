export const documentationExamples = () => `# Decision governed workday intent

The SDK serializes high-level intent. The API alone computes intentDigest and preflightDigest and owns persistence, including persisted capacityPlanId provenance.
Caller-authored executionPlanId, capacityPlanId, executionInputId and demandSetId are rejected before transport; these are not SDK request fields.

\`\`\`sh
trsd workdays plan --decision Z,a --decision A
trsd workdays schedules start --decision Z --decision a,A
\`\`\`

Input and normalized outbound selection:
\`\`\`ts
const input = { decisionIds: [' Z ', 'a', ' A'] };
const outbound = { decisionIds: ['A', 'Z', 'a'] };
const planning = { schemaVersion: 'treeseed.workday-intent/v1', planningOnly: true, projects: ['sdk'] };
const acting = { schemaVersion: 'treeseed.workday-intent/v1', planningOnly: false, projects: ['sdk'] };
\`\`\`

These caller-authored examples are invalid and must be rejected:
\`\`\`ts
const invalid = [
 { executionPlanId: 'caller-derived' }, { capacityPlanId: 'caller-derived' },
 { executionInputId: 'caller-derived' }, { demandSetId: 'caller-derived' }
];
\`\`\`
`;
