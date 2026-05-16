# Changelog

## [0.8.17] - 2026-05-16

### Dependencies

- Release @treeseed/sdk 0.8.17.

## [0.8.16] - 2026-05-15

### Tests

- build(build): update package metadata (f156e8556c88)

### Dependencies

- Release @treeseed/sdk 0.8.16.

## [0.8.15] - 2026-05-15

### Added

- feat(market-client): add local market profile and legacy auth fallback (5be789571d8b)

### Dependencies

- Release @treeseed/sdk 0.8.15.

## [0.8.14] - 2026-05-15

### Added

- feat(seeds): add capacity provider registration (85553d02de0e)
- feat(sdk): add runner and approval request functionality (facd88dc4800)

### Tests

- build(source): update package metadata (39209358c3bc)

### Dependencies

- Release @treeseed/sdk 0.8.14.

## [0.8.13] - 2026-05-14

### Tests

- build(build): update package metadata (1163a3e9ba32)

### Dependencies

- Release @treeseed/sdk 0.8.13.

## [0.8.12] - 2026-05-14

### Added

- feat(capacity): introduce provider-neutral capacity scheduling contracts (59a439e44715)

### Dependencies

- Release @treeseed/sdk 0.8.12.

## [0.8.11] - 2026-05-13

### Added

- feat(sdk): add declarative context query contracts and agent operation (d8945d393f5d)

### Tests

- chore(operations): increase default commit message provider timeout (e43ade7956b1)

### Dependencies

- Release @treeseed/sdk 0.8.11.

## [0.8.10] - 2026-05-13

### Tests

- refactor(platform): update default docs home path to /books/ (092cf475f875)

### Dependencies

- Release @treeseed/sdk 0.8.10.

## [0.8.9] - 2026-05-12

### Tests

- build(source): update package metadata (a491c836ad69)
- build(build): update package metadata (d99c52d39dfe)

### Dependencies

- build(build): update package metadata (7dfddfe7b921)
- build(sdk): bump version to 0.8.9-dev.staging.20260511T220922Z (50daf0b68a76)
- build(build): update package metadata (7ac17bd94dd2)
- Release @treeseed/sdk 0.8.9.

## [0.8.8] - 2026-05-11

### Tests

- build(source): update package metadata (8ab6cc42b96a)

### Dependencies

- build(build): update package metadata (0cfef6511038)
- Release @treeseed/sdk 0.8.8.

## [0.8.7] - 2026-05-11

### Added

- feat(config-runtime): filter environment validation by workflow plane (5d631771e256)

### Fixed

- chore(sdk): bump version and fix environment validation tests (8edd1c80ec79)

### Tests

- build(build): update package metadata (15d7b061232b)
- build(build): update package metadata (775003e01159)
- build(tests): update package metadata (1e94e0a63ab3)

### Dependencies

- Release @treeseed/sdk 0.8.7.

## [0.8.6] - 2026-05-11

### Tests

- build(build): update package metadata (4cf148f37962)
- chore(sdk): bump version and update .gitignore (9085292344c4)

### Dependencies

- Release @treeseed/sdk 0.8.6.

## [0.8.5] - 2026-05-11

### Tests

- chore(sdk): bump version and add test timeout (71a9e3ce64b3)

### Dependencies

- build(sdk): bump version and update deployment workflow (702834c25e4f)
- build(build): update package metadata (78d721e5cd05)
- Release @treeseed/sdk 0.8.5.

## [0.8.4] - 2026-05-11

### Added

- feat(workflow): mark 'save' journals as stale if repository heads have (66e5376e44b1)
- feat(sdk): add retry mechanism to HTTP probes and D1 discovery (0c0077b51bf6)
- feat(managed-dependencies): improve npm tool binary resolution (61c82460c76e)
- feat(railway-deploy): implement direct Railway CLI config writing for CI (938a84cce78f)
- feat(railway-deploy): implement Railway CLI link command environment (21672375c123)
- feat(railway): allow including ignored files via environment variable (d4bf8f2dd18d)
- feat(railway): add --no-gitignore flag to deployment plan (11f99030742e)
- feat(railway-deploy): omit project and environment selectors (749ffa5ae56f)
- feat(railway): support RAILWAY_TOKEN fallback for API token resolution (9ca29194775c)
- feat(railway): support railway project tokens for deployments (61b41f301d26)
- feat(operations): add railway link step to deployRailwayService (ebfc658adf28)
- feat(railway): update log attachment logic to support CI and booleans (c64d6c166e00)
- feat(orchestrator): add partial failure details to wave gate errors (b38c45dd04d5)

### Fixed

- fix(railway-deploy): enable Railway log attachment in CI environments (4267edbe25db)
- fix(railway-deploy): disable automatic Railway deploy log attachment (689eecdbb579)

### Infrastructure

- refactor(operations): sanitize environment variables in service runners (0f6e32e6c4ab)

### Tests

- chore(sdk): add retries to GitHub API pagination helpers (0195925ef189)
- build(build): update package metadata (8c168aba45e9)
- build(build): update package metadata (3fed6013db9b)
- build(build): update package metadata (56f8661dfa4e)
- build(build): update package metadata (2fa3273cde72)
- refactor(railway): improve Railway CLI deployment context management (d7d35d452c1a)
- refactor(railway): simplify argument selection in deployment plans (f69709362986)
- refactor(railway): remove automatic CI log attachment and API-based (248c8e048aec)
- build(build): update package metadata (95251c189771)
- chore(sdk): bump version and update root workflow tests (66e9034e90c7)
- build(build): update package metadata (89e8579a040c)
- build(build): update package metadata (f7a30fa3571a)
- build(build): update package metadata (7bed751432a1)
- chore(sdk): bump version to 0.8.4-dev.staging.20260510T131633Z (e37bf6d58620)
- build(build): update package metadata (9f66271e657e)
- refactor(railway-deploy): prioritize service name and use plan directory (3a03c6d5559c)
- build(build): update package metadata (43aa170185d9)
- refactor(railway): remove buildRailwayProjectLinkArgs and the project (99a1425b7c22)
- refactor(railway-deploy): replace property deletion with undefined (e25ea20b4d41)
- refactor(railway-deploy): remove redundant RAILWAY_TOKEN in environment (614d8fe5b844)
- 17 additional changes omitted from this summary.

### Dependencies

- build(build): update package metadata (e53e95c96aae)
- build(build): update package metadata (af9be019ab9e)
- build(build): update package metadata (acb22b8b018e)
- build(build): update package metadata (806e8e96d53b)
- Release @treeseed/sdk 0.8.4.

## [0.8.3] - 2026-05-10

### Added

- feat(workflow): add support for archiving stale resumable release runs (f51fe1340630)
- feat(workflow): ensure workflow workspace links during release (88285965c676)

### Dependencies

- Release @treeseed/sdk 0.8.3.

## [0.8.2] - 2026-05-10

### Tests

- build(source): update package metadata (045cb0686615)

### Dependencies

- Release @treeseed/sdk 0.8.2.

## [0.8.1] - 2026-05-09

### Dependencies

- Release @treeseed/sdk 0.8.1.

## [0.8.0] - 2026-05-09

### Added

- feat(build-warning-policy): expand warning detection and support ANSI (55c4c2e46915)

### Dependencies

- Release @treeseed/sdk 0.8.0.

## [0.7.0] - 2026-05-09

### Tests

- build(source): update package metadata (c62dbf5dc4aa)

### Dependencies

- Release @treeseed/sdk 0.7.0.

## [0.6.51] - 2026-05-09

### Dependencies

- build(build): update package metadata (abc30d0b6181)
- Release @treeseed/sdk 0.6.51.

## [0.6.50] - 2026-05-08

### Dependencies

- Release @treeseed/sdk 0.6.50.

## [0.6.49] - 2026-05-08

### Infrastructure

- chore(sdk): bump version and increase railway deploy settle timeout (762718efe711)

### Dependencies

- Release @treeseed/sdk 0.6.49.

## [0.6.48] - 2026-05-08

### Infrastructure

- chore(sdk): update railway deployment check implementation (df0be38fc3a4)

### Dependencies

- Release @treeseed/sdk 0.6.48.

## [0.6.47] - 2026-05-08

### Dependencies

- build(build): update package metadata (3dacd011bd30)
- Release @treeseed/sdk 0.6.47.

## [0.6.46] - 2026-05-08

### Dependencies

- build(build): update package metadata (bced9aead014)
- Release @treeseed/sdk 0.6.46.

## [0.6.45] - 2026-05-08

### Added

- feat(operations): implement Railway deployment settlement checks (3f899721b019)

### Dependencies

- Release @treeseed/sdk 0.6.45.

## [0.6.44] - 2026-05-08

### Added

- feat(sdk): add verification for Railway managed resources (ae70afb14c8d)

### Dependencies

- Release @treeseed/sdk 0.6.44.

## [0.6.43] - 2026-05-08

### Added

- feat(railway-deploy): upsert TREESEED_SKIP_PACKAGE_PREPARE variable (0f73eb649117)

### Dependencies

- Release @treeseed/sdk 0.6.43.

## [0.6.42] - 2026-05-08

### Added

- feat(operations): add support for Railway cron schedules (b6dbca0c7593)

### Dependencies

- Release @treeseed/sdk 0.6.42.

## [0.6.41] - 2026-05-08

### Infrastructure

- chore(sdk): bump version to 0.6.41-dev.staging.20260508T083549Z (f957c1b83d47)

### Dependencies

- Release @treeseed/sdk 0.6.41.

## [0.6.40] - 2026-05-08

### Added

- feat(operations): add Railway volume management capabilities (11dbbef98b58)
- feat(sdk): add capacity management features (c083ccdab6d9)

### Tests

- build(tests): update package metadata (fd6651f0ae79)
- build(build): update package metadata (ffe7b32141c1)
- build(source): update package metadata (b2bcdcae673f)
- build(build): update package metadata (b4501454d88d)

### Dependencies

- build(build): update package metadata (92877f3243ce)
- Release @treeseed/sdk 0.6.40.

## [0.6.39] - 2026-05-07

### Added

- feat(operations): support tag-based deployment policies for GitHub (ca46311aaa6d)

### Dependencies

- Release @treeseed/sdk 0.6.39.

## [0.6.38] - 2026-05-07

### Added

- feat(operations): implement automated release history and changelog (d539ab603b01)

### Dependencies

- Release @treeseed/sdk 0.6.38.
