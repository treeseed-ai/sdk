# Immutable Agent environment contracts

SDK #488 defines portable `EnvironmentSchemas`, inferred `EnvironmentDefinition`,
`EnvironmentEntrypoint`, `EnvironmentNetworkPolicy` and `EnvironmentDestination`, and
`EnvironmentNetwork.intersect(requested, host, assignment)`. Root and `./portable` exports
share the same definitions; generated `contract.json` includes `environmentDefinition`.
This is a separately versioned `treeseed.agent-environment/v1` contract; the seven global
operations and global projection version remain unchanged.

An environment selects an exact package, Linux/amd64 digest-pinned base image, revision and
explicit setup and verification entrypoints. Each entry binds an inventory-relative file,
SHA-256, positive size, argument array, deadline and output-byte limit. Arguments cannot
contain NUL. Reject traversal, mutable images, mismatched manifest digests and unsupported
architecture. Packaging resolves naming defaults into these explicit entries; runtime must
not search for ambient scripts. An exact-shaped declaration does not prove artifact custody.

Network defaults to offline, with no destinations. Allow-list mode accepts unique exact TCP
destinations with canonical lower-case DNS names or IPv4 addresses and bounded ports; no
wildcards, URLs, credentials, IPv6 or ambiguous IPv4 spelling. `intersect` validates all
three policies and rejects a request absent from either trusted host or assignment policy.
It returns a deterministically sorted copy without mutating inputs. Invalid policy and denied
destinations produce fixed safe errors, never provider diagnostics or input strings.

Agent owns definition associations, setup sequencing, cancellation and verification. Deployment
owns immutable custody and bounded sandbox operations. Setup runs only inside a claimed guest
before a harmless handler. Stable dependencies belong in exact images/archives; no ambient
lifecycle script runs on the host. Live grants and sandbox egress enforcement are mandatory
owner behavior, not properties established by these data validators. Keycloak authority and
real Work/model execution remain outside this SDK slice; the latter stays Task 10.

Implementation follows documentation, built portable acceptance, isolated contract tests,
implementation and complete owner verification. The public Node program verifies defaults,
entrypoint/image rejection, grant intersection, safe errors and actual generated schemas.
All permanent specifications use their proper tests tier. Genuine script-free packed Node and
declaration consumers plus exact-head CI are required before handoff. No services start here;
all issues remain open and candidates target cordis for review.
