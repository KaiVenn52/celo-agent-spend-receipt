# Agent Spend Receipt

## Short pitch

An agent can buy a useful Celo data check without turning a failed HTTP request into a second payment. Agent Spend Receipt fixes the budget, binds the wallet authorization to the approved provider, and produces a receipt that separates payment evidence from service delivery.

## Problem and user

Celo application operators delegating work to agents need to know which external service was called, what it cost, and what happened when a response timed out. A successful token transfer does not prove a useful result; an HTTP failure does not prove no money moved. The current flow is a wallet snapshot for an application-support task. Independent demand and the participant's actual workflow are still being validated; no users or savings are claimed in advance.

## What we built

A focused task workspace with an immutable USDC budget, session-scoped task history, a readable wallet result, an external-service ledger, and an exportable receipt. The official buy SDK constructs a fixed EIP-3009 payload after the free quote and balance check. The owner signs in their EOA wallet. SQLite allows one paid send and retains ambiguous outcomes for reconciliation. The verifier checks the exact transfer and the task's authorization nonce on Celo mainnet, with canonical-block confirmation.

The planner is deterministic. No LLM or inference-model claim is made. The product integrates one independent service: Chainstack Celo RPC via buy. A free RPC can return the same basic reads; our differentiator is controlled procurement, evidence and recovery, not exclusive data access. We do not spam paid calls to manufacture demand.

## Track and Celo integration

Build with buy. Pinned @celo/buy-core 0.8.3, Celo mainnet 42220, USDC, x402 v1, and a prepared ERC-8004 registration workflow. The track-specific FAQ waives attribution tags; payer and actual provider PayTo will be included with payment proof. Identity registration and independent-user evidence are mandatory remaining gates.

## Evidence disclosure

Completed: local product, unit/integration tests, actual signature math against injected transports, responsive browser QA, a fully injected browser signing loop, real unsigned service quote and public Celo chain read.

Not yet evidenced: a real paid provider result, actual mainnet settlement, registered Agent ID, verified independent participant, public project repository/deployment, accepted registration or final submission. These fields must be filled from real artifacts in live-evidence.json before this draft can be submitted as a qualifying project. The submission gate intentionally remains false while they are missing.

## Links and proof to fill after approval

Repository, hosted demo, demo recording, ERC-8004 Agent ID/registration transaction, actual payer, provider PayTo, service settlement transaction, task authorization nonce, provider output and independent-user evidence. No placeholder explorer links or invented URLs are supplied.
