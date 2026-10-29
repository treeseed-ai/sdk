# Existing provider control-plane protocol

SDK owns the public wire contract and client at `@treeseed-cordis/sdk/provider-control` and its
portable schemas at `@treeseed-cordis/sdk/provider-control-contracts`. This is the same-repository
successor to legacy `src/capacity-provider/client.ts` and `contracts/governance.ts`. Agent owns
signing, enrollment orchestration, secret custody and the selectable team-connection provider;
Identity retains Keycloak human approval. SDK does not create an authority or approve membership.

| Client operation | Existing endpoint | Authentication |
| --- | --- | --- |
| register | POST /v1/provider-registrations | Treeseed-Registration key; signed submission; explicit Idempotency-Key |
| registration | GET /v1/provider-registrations/{requestId} | x-treeseed-provider-proof containing base64url JSON proof; no bearer |
| exchangeCredential | POST /v1/provider-registrations/{requestId}/credential | signed proof body; explicit Idempotency-Key; no bearer |
| issueAccessToken | POST /v1/provider/access-tokens | Treeseed-Credential; signed proof and credential ID; explicit Idempotency-Key |
| createAvailabilitySession | POST /v1/provider/availability-sessions | Bearer provider access token; complete typed snapshot |
| refreshAvailabilitySession | PUT /v1/provider/availability-sessions/{sessionId} | Bearer token; complete snapshot and exact expectedSequence |
| closeAvailabilitySession | POST /v1/provider/availability-sessions/{sessionId}/close | Bearer token; empty JSON body |

The client preserves response membership/team/provider/credential identities, revisions, states
and scopes. A registration is pending until the existing team authority approves it; no response
field or local plugin selection can synthesize approval. The caller binds every proof to the
existing Ed25519 payload: provider fingerprint/identity version, method/path, canonical body
SHA-256, audience, issue/expiry and unique proof ID. The client validates the wire shape but does
not claim that an opaque signature is valid. Signing and server verification are separate seams.
Optional token validity preserves the existing server's whole-second range of 60 through
604800 seconds (seven days); omission preserves its 900-second default. The default is not a
maximum. These values come from the same-repository legacy API's access-token-validity contract.

Use an absolute HTTPS origin with no credentials, path, query or fragment. Redirects fail rather
than forwarding credentials. Requests use the default real Fetch transport through a typed
`ProviderControlTransport` seam; an alternative must satisfy the same contract tests. Deadlines,
abort and response-size limits remain enforced. Strict UTF-8 JSON rejects duplicate keys and
unexpected response fields. Success uses the existing `{data, meta?, links?}` envelope. Non-success,
transport and decoding failures expose fixed safe error codes/status only, never remote problem
details, proofs, credentials, tokens or provider exception text.

The availability client extends those same default Fetch/deadline/strict JSON/error boundaries:

- createAvailabilitySession(token, principal, input, signal) accepts a closed principal containing
  membershipId, teamId and providerId plus ProviderAvailabilityCreate. Return only an open sequence1
  session bound to that exact principal and the submitted adapter/runtime/offer/lane selection.
- refreshAvailabilitySession(token, prior, input, signal) accepts the complete prior session and
  ProviderAvailabilityRefresh. Require an open prior and input.expectedSequence===prior.sequence
  before transport; returned session has the same id/principal, sequence+1 and open status. Bind its
  exact submitted selection. Do not silently recreate a session after conflict or rejection.
- closeAvailabilitySession(token, prior, signal) accepts an open/draining/already closed prior.
  Return only that same id/principal and sequence with closed status and a closure timestamp. The
  existing close endpoint has no atomic expected-sequence argument: read-back detects mismatches
  but cannot promise no server effect on a raced close. Agent owns serialization, grant fencing,
  uncertain-outcome recovery and result custody; this transport adds no fictitious precondition.

Validate/snapshot input before the first asynchronous boundary. Conformance provider identities
must match the selected principal. Returned adapter IDs, implementation/runtime identities, offer
bytes, lane memberships, native limits and declared limits match the submitted snapshot; compare
semantic sets without depending on enumeration order. Lane IDs/purposes and their declared
priority/reservation/maximum/capability fields also match, while server observation fields remain
observations. Creating a second session can replace an earlier server session; callers must not
infer idempotency or exactly-once effects from this API. Never automatically retry these requests.

Missing/malformed input fails with INVALID_PROVIDER_REQUEST before any network action. Malformed
responses retain INVALID_PROVIDER_RESPONSE; well-formed foreign identities, stale sequences,
wrong states or changed selection fail PROVIDER_IDENTITY_MISMATCH. Existing cancellation, HTTP
status and response bounds remain unchanged; never expose bearer tokens, input, remote details or
raw exceptions. No credential storage or renewal is added. Agent remains responsible for token
expiry, live scopes/revocation and immutable readiness/grant intersection. Data-schema parsing
does not verify conformance signatures or establish membership approval.

Default-construction acceptance must spawn the built program against an isolated real TLS
contract server, exercising POST→PUT→POST, exact bearer/body/path identity, returned lifecycle,
safe denial and disposal. Native signed enrollment and Keycloak authority remain separate tests;
fixture signatures are opaque data, never real authority. Cover changed team/provider/membership,
session/sequence/state/selection, malformed input, cancellation, redirects, bounded responses,
lost replies, no retries and caller mutation through the same public client contract. Existing
enrollment/credential/token assertions and timeouts remain intact. Keep this slice within ten files
and new/changed executable methods within twenty formatted body lines, with no new baselines.

Availability scheduling, revocation observation, Agent native composition and isolated Keycloak enrollment remain explicit
Task 3D integration gates. Productive assignment/Work/model operations remain Task 10. The seven
global platform operation IDs are unchanged; provider schemas have their own version and JSON
projection. All issues stay open; artifacts remain private review candidates targeting cordis.
# Review successor

The synchronized owner candidate is SDK `.25`, retaining accepted Agent probe contracts and
the bounded compiler regression. Earlier `.17` and `.21` archives stay immutable; `.25` receives
its own exact source and archive identity. The seven operation IDs and probe projection remain.
