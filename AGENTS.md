# SDK agent contribution policy

Agents may populate or update the managed **Agent contribution attestation** in a pull request only when all of the following are true:

- the agent definition enables `delegated-project-authorization` and requires `contribution_attestation`;
- the active assignment and capacity grant include `contribution_attestation`;
- TreeSeed supplies an active project contribution authorization matching the exact repository, agent, capacity provider, target branch, assignment, PR base SHA, and PR head SHA; and
- the trusted API issues a valid exact-head contribution receipt.

Agents must never check, edit, or claim the **Human contribution affirmation**. They may not create, broaden, renew, revoke, or supersede a project contribution authorization. Missing, stale, mismatched, expired, or revoked authorization fails closed and requires human project-level action rather than per-PR approval.

Keep work scoped to this repository. Never add Market or Market API custody or depend on a hosted Market service for local development.
