# Portable seed contracts

SDK owns the root and portable `SeedSchemas`, inferred data types, resource-provider contracts,
safe `SeedContractError` and `SeedContractBinding`. This bounded candidate extracts the already
verified seed boundary from the unmerged capacity integration without importing Agent behavior.
The existing seven global platform operations and their operation-contract version remain intact;
seed schemas are separately versioned and included in the generated contract projection.

`treeseed.seed-bundle/v4` declares resource keys/types/schema references, dependencies and exact
capability requirements. `treeseed.seed-plan/v1` adds the installation/project/profile/principal
binding, exact source/package/provider/executable/schema locks, owner preconditions, desired
generations and intended effects. Plans are canonical data identities; resource owners still
verify artifact bytes, actual authority and live preconditions. Parsing JSON never imports a plugin,
executes a validator, installs a package, approves a team or starts a service.

`treeseed.seed-receipt/v1` links exact resource-owner receipts to the request, plan and binding.
Only all expected, individually verified resources permit completed status. Partial, pending,
blocked and recovery-required stay explicit. Verified resource records must match their owner,
desired digest, provider/artifact/schema identities and generation. A lost owner reply needs
idempotent owner read-back; SDK schemas do not supply a cross-owner transaction or rollback.

Requirements/providers/resources must be unique, complete and acyclic. Reject unmatched locks,
different installation/principal/project/profile, duplicate/cyclic resource dependencies, changed
schema or executable identities and false completion. Capability IDs remain open to accepted
external packages; the schema does not freeze a core resource catalogue. Errors contain fixed
codes, never supplied payloads, credentials or provider diagnostics.

API owns seed coordination and the single-writer journal through Deployment custody. Agent owns
capacity/definition/environment resource providers; CLI owns arguments and public owner-client
invocation. This contract candidate does not deliver those runtimes. Work/model execution remains
Task 10. All issues stay open; this is a private cordis review candidate with no merge or release.
