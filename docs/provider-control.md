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

This slice implements registration/status/credential/token transport only. Availability heartbeat,
revocation observation, Agent native composition and isolated Keycloak enrollment remain explicit
Task 3D integration gates. Productive assignment/Work/model operations remain Task 10. The seven
global platform operation IDs are unchanged; provider schemas have their own version and JSON
projection. All issues stay open; artifacts remain private review candidates targeting cordis.
# Review successor

The synchronized owner candidate is SDK `.25`, retaining accepted Agent probe contracts and
the bounded compiler regression. Earlier `.17` and `.21` archives stay immutable; `.25` receives
its own exact source and archive identity. The seven operation IDs and probe projection remain.

