# Extensible Agent activity profiles

SDK owns the portable activity capability, profile-instance and Agent-definition contracts under
#488. Agent owns their native Cordis providers, parameter validation, orchestration and live
authority. This slice resumes the approved Task 3D architecture; it executes no handler or model.

`ActivitySchemas` declares an open namespaced capability/type with an exact revision, provider,
parameter-schema identity, handler contract and orchestration contract. A profile instance belongs
to an Agent definition and selects a type/revision, handler, environment, parameters and dependency
instances. Planning, estimating, acting, reviewing, reporting and chat are core Agent registrations,
not an exhaustive SDK enum. Accepted external packages can add types without editing a catalogue.

`ActivityContractBinding.resolve(definition, capabilities)` validates structural selection and
returns instance/capability pairs. Reject unknown or ambiguous types, incompatible handler contracts,
revision mismatch, missing dependencies and cycles. Input declaration order does not prescribe
execution order. Parameter schemas and live grants are checked by the selected Agent providers;
metadata admission cannot authorize execution or imply that a package is trusted.

Root and portable exports expose inferred types and safe fixed errors. Generated JSON includes
separately versioned activity contracts while retaining the existing seven operation IDs. Earlier
SDK archives remain immutable; this owner slice receives a new private version and exact archive.

Verify the built public program before implementation, then isolated binding cases and complete
owner checks/build/all test tiers. Install the genuine archive with scripts disabled and check an
independent public-export/declaration consumer. Native manager/worker/guest and productive handlers
remain outside this data-contract slice; real Work/model execution remains Task 10.
