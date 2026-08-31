# SDK workspace guidance

The SDK is an Apache-2.0 repository. It has no contributor-grant checkbox, approved-committer allowlist, or contribution-attestation requirement. Human and agent changes use the same durable pull-request record and the same exact-head verification, review, staging, and release gates.

Agents must act only within their assignment authority, preserve exact repository and commit evidence, and keep GitHub credentials outside execution workspaces. Keep work scoped to this repository. Never add Market or Market API custody or depend on a hosted Market service for local development.

Capacity-provider activity starts at this repository root so read-authorized agents can inspect source, package scripts, tests, and CI configuration. The bound `sdk-library` is the default TreeDX project context. If either the source checkout or exact TreeDX binding is unavailable, report that execution defect instead of asking the user to supply files already owned by the project.

## Branch and deployment boundary

`main` is the only production branch and maps only to the `production` deployment environment. `staging` is the only development-integration branch and maps only to the `staging` deployment environment. Short-lived pull-request branches may validate without deploying, but they must never define another deployment environment. Do not create or use `development`, `preview`, `stable`, or any other GitHub deployment environment; preview deployments are prohibited. Release tags may promote an exact reviewed `staging` commit to `production` without creating another branch or environment. Artifact channel names must never become GitHub deployment environments.

## Project library

Use `trsd library show sdk` and `status` before querying `treeseed-ai/sdk-library`. Read root-level paths with `trsd library read sdk <path> --ref <exact-commit>` and use `query --model agent` for agent definitions and activity profiles. Author only through governed library workspaces and reviews. Never recreate `src/content` or edit `.treeseed/data` directly.
