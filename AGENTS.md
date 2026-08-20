# SDK workspace guidance

The SDK is an Apache-2.0 repository. It has no contributor-grant checkbox, approved-committer allowlist, or contribution-attestation requirement. Human and agent changes use the same durable pull-request record and the same exact-head verification, review, staging, and release gates.

Agents must act only within their assignment authority, preserve exact repository and commit evidence, and keep GitHub credentials outside execution workspaces. Keep work scoped to this repository. Never add Market or Market API custody or depend on a hosted Market service for local development.
