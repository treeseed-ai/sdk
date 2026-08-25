# SDK workspace guidance

The SDK is an Apache-2.0 repository. It has no contributor-grant checkbox, approved-committer allowlist, or contribution-attestation requirement. Human and agent changes use the same durable pull-request record and the same exact-head verification, review, staging, and release gates.

Agents must act only within their assignment authority, preserve exact repository and commit evidence, and keep GitHub credentials outside execution workspaces. Keep work scoped to this repository. Never add Market or Market API custody or depend on a hosted Market service for local development.

## Project library

Use `trsd library show sdk` and `status` before querying `treeseed-ai/sdk-library`. Read root-level paths with `trsd library read sdk <path> --ref <exact-commit>` and use `query --model agent` for agent definitions and activity profiles. Author only through governed library workspaces and reviews. Never recreate `src/content` or edit `.treeseed/data` directly.
