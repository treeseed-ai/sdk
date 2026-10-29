# Existing provider availability contracts

SDK owns the same-repository successor of legacy capacity-provider/client.ts,
contracts/governance.ts and capability-ontology.ts. Add portable ProviderAvailabilitySchemas
and inferred types through the existing provider-control-contracts public subpath and root
contract exports. Agent owns connection lifecycle, signing, secret custody, availability policy
and native Cordis composition. API retains live membership/ontology approval; Identity retains
Keycloak. Parsing data never creates authority or verifies an Ed25519 signature.

## Wire inventory

Preserve these existing endpoints for the subsequent client slice: POST
/v1/provider/availability-sessions, PUT /v1/provider/availability-sessions/{sessionId}, and POST
/v1/provider/availability-sessions/{sessionId}/close, using the existing provider Bearer token.
This first slice adds no network requests or manager heartbeat loop.

ProviderAvailabilitySchemas exposes offer, create, refresh and session schemas and an independent
project() version treeseed.provider-availability/v1. The main generated ContractProjection also
contains providerCapabilityOffer, providerAvailabilityCreate, providerAvailabilityRefresh and
providerAvailabilitySession. Preserve its existing contract version and seven platform IDs.

- offer preserves treeseed.capability-offer/v2: offerId, exact capability references, features,
  configurationSupport, permissionClasses, contextModes, input/output contracts, interactionModes,
  signed conformance receipts, contextCapacity, limits, commercial values, region, trust and
  offerDigest. Capability/reference/artifact hashes are sha256:<64 lowercase hex>. Signatures and
  qualification are data here; API must independently check digest, signer and live ontology.
- create preserves adapters and lanes; optional ttlSeconds is an integer30..300 (server default90,
  left omitted), environment, availableFrom/availableUntil, status:open, capabilities, capacity,
  runnerPressure, constraints and metadata. Do not introduce executionProviders, offers at root,
  productive assignment fields or a new registration protocol.
- refresh carries the complete create snapshot plus positive expectedSequence. No default,
  truncation, implicit retry or conflict-driven replacement of a session is introduced.
- session binds id, membershipId, teamId, providerId, open/draining/closed/expired status, positive
  sequence, snapshot, openedAt/refreshedAt/expiresAt and optional nullable closedAt. Snapshot retains
  the same sequence, windows, pressure, concurrency counters, activeAssignmentIds, adapters,
  lanes, capabilities and optional constraints.

Adapters retain id, adapter implementation name, exact runtimeBuild, nonempty complete offers,
microvm/process/worker isolation, available/degraded/unavailable status, capabilities, laneIds,
maxConcurrentWorkers, activeWorkers, nativeLimits and optional observations/accountingObservation.
Optional accounting observation fields are wire data only; no productive accounting engine is
implemented. Agent's Kata policy independently requires microvm, exact physical readiness and
live authority before advertising executable capacity.

The existing public API requires exactly three purpose lanes: communication, platform and
workday. Lane IDs are selectable; preserve request scheduling fields and response observation
counters. This is compatibility with that protocol, not a limit on activity-profile types,
container plugins, execution adapters or seed resource providers. Require unique IDs/purposes,
all lane references resolved and every declared lane referenced. Adapter and provider-global
offer IDs must be unique; capability/artifact references cannot contain duplicate identities.

Use closed envelopes and bounded strings/collections. Extension dictionaries intentionally
carry JSON data for native limits, observations, constraints, metadata and declared offer limits;
they are not executable implementations. Numeric counters are finite safe nonnegative integers;
active/reserved counts cannot exceed the associated declared maximum. JSON projections preserve
structural contracts; executable refinements enforce graphs, uniqueness, counters and windows.
Preserve signed canonical offer fields without inserting defaults or silently stripping data.
Session snapshot.sequence must equal session.sequence; windows must be ordered. Complete identities
and revisions are preserved byte-for-byte; callers still bind them to live expected authority.

## Verification and ordered delivery

Commit this reference/CHANGELOG before a built Node public program demonstrating canonical
request/refresh/session data, extensible adapter identities, exported inferred contracts and
generated projections. Then add real JSON projection/bundle boundaries and isolated semantic
negative cases before implementation. All permanent registrations live in the four test tiers;
shared fixture declarations remain registration-free. Existing regression cases remain intact;
this additive schema slice does not invent a historical defect.

Keep ten files: this reference, CHANGELOG, package identity, one schema module, root projection,
existing provider-contract export, acceptance, integration, unit and support. No dependencies,
readability baselines/exceptions, network client, Cordis root or service activation is added to
this portable-data slice. Check/build/all applicable tiers and genuine script-disabled archive
consumption precede review. Follow with the separately bounded public TLS client and Agent
heartbeat/revocation integration. All issues stay open; real Work/model execution is Task10.
