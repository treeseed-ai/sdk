# Changelog

## [0.10.27] - 2026-06-04

### Tests

- build(build): update package metadata (fcc44d3aff4d)
- build(build): update package metadata (2cd749dd9142)

### Dependencies

- Release @treeseed/sdk 0.10.27.

## [0.10.26] - 2026-06-04

### Dependencies

- Release @treeseed/sdk 0.10.26.

## [0.10.25] - 2026-06-04

### Added

- feat(operations): add processEnv to binding operation context (a7ed45ecb42f)
- feat(railway): add sequential deployment and improve timing (002b22420046)
- feat(template-launch-requirements): export TemplateLaunchRequirements (1f075e089611)
- feat(sdk): expose template launch, host binding, and secret sync APIs (3fcd72c9d730)

### Infrastructure

- chore(sdk): bump version and update catalog fixture git refs (ec6789604929)

### Dependencies

- build(build): update package metadata (e20d282425c0)
- chore(sdk): bump version to 0.10.25-dev.staging.20260603T210802Z (d42fe52370ad)
- build(sdk): bump version to 0.10.25-dev.staging.20260603T201852Z (0c3710079aa4)
- Release @treeseed/sdk 0.10.25.

## [0.10.24] - 2026-06-02

### Added

- feat(sdk): add local starter support and projectRoot to deploy config (c696d9130251)
- feat(operations): add timing instrumentation to bootstrap and deployment (024ad64ed27b)

### Tests

- build(build): update package metadata (48f5daf9c8ad)
- build(build): update package metadata (849a81d6f201)

### Dependencies

- Release @treeseed/sdk 0.10.24.

## [0.10.23] - 2026-06-02

### Added

- feat(market): expand hub launch inputs and scope process environment (96657f956531)

### Tests

- refactor(reconcile): refactor Turnstile site key assignment (864ca362722e)
- build(build): update package metadata (1177650f4627)
- build(build): update package metadata (de4b15df982c)
- build(source): update package metadata (9a0325ae9955)
- build(build): update package metadata (5d634bddcb64)
- build(build): avoid Railway volume update after attach (2b7cc07d6473)
- build(source): harden Railway runner volume reconciliation (104e4720b044)

### Dependencies

- build(build): update package metadata (1733824f7873)
- build(build): update package metadata (cf235f066729)
- Release @treeseed/sdk 0.10.23.

## [0.10.22] - 2026-05-28

### Tests

- build(build): wait for delayed Railway service instances before (ab5ddb0ff543)

### Dependencies

- build(build): avoid live queue lookup during destroy dry runs (8aa5ff4da78f)
- build(build): harden provider cleanup api calls for clean destroy (39e83a4b6e74)
- Release @treeseed/sdk 0.10.22.

## [0.10.21] - 2026-05-28

### Tests

- build(build): force fresh deployed-resource verification on staging save (c6f780514551)
- build(build): refresh Railway topology during verification (589279f2d999)

### Dependencies

- Release @treeseed/sdk 0.10.21.

## [0.10.20] - 2026-05-28

### Tests

- build(build): redeploy staging from clean provider state (aa546a23f8f6)
- build(build): allow railway context link by project id (da0dae703fe3)
- build(build): link railway context before cli volume fallback (a71f5e0ac068)
- build(build): fallback railway environment creation when API is opaque (83df3499d01f)

### Dependencies

- Release @treeseed/sdk 0.10.20.

## [0.10.19] - 2026-05-28

### Tests

- build(build): stabilize clean redeploy railway volume verification (6a19f26021be)
- build(build): verify railway runner volumes through cli fallback (406b612a291b)
- build(build): handle already mounted railway volumes during clean (7cbe5aff3c64)
- build(build): attach railway runner volume before verifying mount (0b55fe8c7ce2)
- build(build): wait for railway service instance config to settle (0ebf1e23c5b1)

### Dependencies

- Release @treeseed/sdk 0.10.19.

## [0.10.18] - 2026-05-28

### Tests

- build(build): use railway cli volume path for runner reconcile (6b48d715a2a0)
- build(build): do not create replacement volumes for railway postgres (7bcc829cddcb)
- build(build): reuse railway managed postgres volume after not (7deb937999eb)
- build(build): reuse railway postgres volume after create conflict (80e74737e5f4)
- build(build): wait for new railway service instances before runtime (cfdbac9579aa)

### Dependencies

- Release @treeseed/sdk 0.10.18.

## [0.10.17] - 2026-05-28

### Fixed

- fix: retry transient railway cli volume commands (03bb46676818)

### Tests

- build(build): prove staging destroy save loop from clean providers (a7f03131169d)
- build(build): debug staging save from clean provider state (f5d5b43eb373)
- build(build): debug staging save from clean provider state (8736d636387d)
- build(build): debug staging save from clean provider state (ebd69ab38c50)
- build(build): debug staging save from clean provider state (c795bac631b3)
- build(build): debug staging save from clean provider state (ff10b010414f)
- build(build): debug staging save from clean provider state (652718445c34)
- build(source): debug staging save from clean provider state (c190cfcfbdb2)
- build(build): debug staging save from clean provider state (3ed0e2275a60)
- build(build): debug staging save from clean provider state (d406a099ac60)

### Dependencies

- build(build): retry railway volume attach during clean redeploy (76af4fdad5d7)
- build(build): debug staging save from clean provider state (8c2e0c1e1d85)
- build(build): debug staging save from clean provider state (39bc5bd49864)
- Release @treeseed/sdk 0.10.17.

## [0.10.16] - 2026-05-27

### Dependencies

- Release @treeseed/sdk 0.10.16.

## [0.10.15] - 2026-05-27

### Tests

- build(build): update package metadata (cf674a8ee8fe)

### Dependencies

- Release @treeseed/sdk 0.10.15.

## [0.10.14] - 2026-05-27

### Tests

- build(build): update package metadata (c31f0586cb80)

### Dependencies

- Release @treeseed/sdk 0.10.14.

## [0.10.13] - 2026-05-27

### Changed

- refactor(railway-api): increase timeout and retry defaults (f98aa6148440)

### Tests

- build(source): update package metadata (1292c6a22c2f)
- build(build): update package metadata (10249533eb1d)

### Dependencies

- build(build): update package metadata (3406ce41476a)
- chore(sdk): bump version to 0.10.13-dev.staging.20260524T233127Z (40db8a06ad52)
- Release @treeseed/sdk 0.10.13.

## [0.10.12] - 2026-05-24

### Fixed

- build(build): fix sdk template source cache reuse (43e50b305d15)

### Tests

- build(source): complete dynamic capacity budgeting (32f6360ccce9)

### Dependencies

- build(build): add market postgres baseline adoption columns (d1d9a21c398e)
- build(build): make market postgres baseline adopt existing schema (043c80837dfa)
- build(build): make static hub d1 baseline idempotent (9faf8f4e7b7f)
- Release @treeseed/sdk 0.10.12.

## [0.10.11] - 2026-05-23

### Dependencies

- Release @treeseed/sdk 0.10.11.

## [0.10.10] - 2026-05-23

### Dependencies

- Release @treeseed/sdk 0.10.10.

## [0.10.9] - 2026-05-23

### Infrastructure

- chore(package): bump version and simplify auth seeding (dda07eae8aac)

### Dependencies

- Release @treeseed/sdk 0.10.9.

## [0.10.8] - 2026-05-22

### Added

- feat(operations): update web platform bootstrap systems (3b1c103afc34)
- feat(auth): add user session issuance and web authentication methods (ac7260edf6ab)

### Tests

- test(root-workflows): update expected environment variables (ed0e2edafec8)

### Dependencies

- Release @treeseed/sdk 0.10.8.

## [0.10.7] - 2026-05-22

### Fixed

- fix(build): rehearse repair releases against stable dependencies (f2bffa1fef7e)
- fix(workflow): keep release package lines aligned (d3b8fcc12120)

### Tests

- test(workflow-lifecycle): update railway token storage and auth (388cc452ff27)
- build(build): update package metadata (0339422e4e49)
- build(source): update package metadata (d2c8becdfda9)
- build(tests): update package metadata (e2c617dba02c)

### Dependencies

- Release @treeseed/sdk 0.10.7.

## [0.10.6] - 2026-05-21

### Dependencies

- Release @treeseed/sdk 0.10.6.

## [0.10.5] - 2026-05-21

### Fixed

- fix(release): fail package release when npm publish fails (075ff331c850)

### Dependencies

- Release @treeseed/sdk 0.10.5.

## [0.10.4] - 2026-05-20

### Tests

- ci(build): create github releases for package publishes (b6d38f567223)

### Dependencies

- Release @treeseed/sdk 0.10.4.

## [0.10.3] - 2026-05-20

### Fixed

- fix(publish): tolerate npm scoped package permission 404 (1609228268c0)

### Dependencies

- Release @treeseed/sdk 0.10.3.

## [0.10.2] - 2026-05-20

### Added

- feat(sdk): allow internal packages to use stable git tags (5ea02f3c2aaf)

### Tests

- build(build): release internal packages from stable git tags (551b7d75da4c)

### Dependencies

- Release @treeseed/sdk 0.10.2.

## [0.10.1] - 2026-05-20

### Dependencies

- build(build): make package publish tolerate unprovisioned npm scope (7e8db931eb94)
- Release @treeseed/sdk 0.10.1.

## [0.10.0] - 2026-05-20

### Added

- feat(api): migrate to Hono and complete capacity provider implementation (f100d7afd5eb)

### Dependencies

- Release @treeseed/sdk 0.10.0.

## [0.9.0] - 2026-05-19

### Added

- feat(orchestrator): plan new version if package tag conflicts with HEAD (b5eb79f9d5ee)
- feat(deploy): add API token TTL environment variables (e26c8d2738a7)

### Fixed

- fix(sdk): keep migration tests standalone (ca229cb85f01)

### Tests

- chore(sdk): bump version to 0.8.20-dev.staging.20260519T110614Z (0546d1b55b06)
- refactor(operations): update service start commands and health (df056806e290)
- chore(sdk): bump version to 0.8.20-dev.staging.20260518T044526Z (a9791b17c328)
- chore(sdk): bump version and update test href (2df693e89b37)

### Dependencies

- Release @treeseed/sdk 0.9.0.

## [0.8.19] - 2026-05-16

### Dependencies

- Release @treeseed/sdk 0.8.19.

## [0.8.18] - 2026-05-16

### Dependencies

- Release @treeseed/sdk 0.8.18.

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
