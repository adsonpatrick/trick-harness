# Agent Note: Plurora delivery binds the checkout branch

Status: implemented

English | [中文](2026-09-08-plurora-checkout-delivery-branch.zh.md)

## Problem

An OpenCode workflow supplies a generated objective id while the operator chooses the checkout branch. Deriving a delivery branch from that id causes successful implementation and verification to fail at delivery: nothing creates or checks out the derived branch.

## Decision

The [host](../../../../apps/plurora-harness-host/src/main.ts) reads the project checkout branch through its managed Git subprocess before opening the durable session. It supplies that exact name to the [delivery description](../../../../apps/plurora-harness-host/src/workflow-handlers.ts), independently of objective ids and model responses. The PR base comes from the deployment's protected branch.

Delivery retains its existing check against the branch currently checked out and refuses protected branches and detached HEAD before staging or committing. A branch switch during the host session requires a new host session; the host does not follow the switch or rename branches.

## Alternatives considered

**Rename the workspace to match each objective.** This changes the operator's chosen branch and makes workspace ownership depend on a generated id.

**Read whichever branch is current at delivery time.** This would accept an intervening branch switch and publish work under a branch the host was not started on.

**Make OpenCode choose the delivery ref.** Branch identity belongs to Git in the host's checkout; a model-supplied name does not establish that identity.

## Consequences

Feature branches with operator-chosen names can complete delivery. Host startup requires Git to report the checkout branch; failures leave no durable session. Protected and detached checkouts can still host read-only work, but cannot deliver.

The [keyless host scenario](../../../../apps/plurora-harness-host/tests/delivery-branch.snapshot.ts) runs implementation, verification and delivery with recorded provider results and a simulated GitHub response. Git branch checks, commits and pushes to a temporary local remote are real. It also proves refusal without commit or staging after a branch switch, on a protected branch and on detached HEAD. This scenario provides no live GitHub certification or provider evidence.
