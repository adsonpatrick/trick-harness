# Minimal fixture profile

A second project profile whose only job is to be evidence. A core that holds this profile alongside Plurora, with no shared module and no edits, is a core with no single-project assumption baked into it.

This profile is test-only. It is never registered by a production runtime, and it enables no integration, so it needs no project credentials to be useful.

## Keep it boring

The temptation with a fixture is to grow it until it looks realistic. Resist it. This profile proves that the contract is satisfiable by something that is not Plurora; the more it comes to resemble Plurora, the less it proves. Its tests assert that it stays minimal — one routing rule, no fallbacks, no integrations — so growth fails loudly rather than eroding the evidence quietly.

The one thing it may not differ on is `independencePolicy`. If a profile could relax the review floor for high-risk work, "reusable" would have quietly come to mean "weakenable". [tests/trick-harness/dual-profile.spec.ts](../../../tests/trick-harness/dual-profile.spec.ts) asserts both profiles agree there and disagree everywhere else.
