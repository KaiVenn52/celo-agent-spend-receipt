# Mainnet review — not spend authorization

No real payment, wallet setup or user signature was made by the builder during this implementation.

## Concrete proposed first call

- Task: a nominated real user's Celo wallet snapshot, with chain ID, native balance and transaction count in one batch.
- Provider: Chainstack via https://gateway.usebuy.ai/chainstack/celo, outside our control.
- Network: Celo mainnet 42220. Asset: USDC, six decimals, 0xcebA9300f2b948710d2653dD7B07f33A8B32118C.
- Quote observed 22 October: 10,000 atomic = **0.010000 USDC**. Provider PayTo: 0x20faAca5F980E29639A0FCC6dcA6988E18ed333B. This historical quote is not permission to spend and will expire.
- Proposed maximum for the first purchase: **0.010000 USDC**, only after a fresh quote at or below that ceiling and explicit owner approval. Do not raise the cap silently or repeat the cheapest call to manufacture demand.
- Funding/bridge costs and ERC-8004 registration gas are separate. No combined launch-cost estimate is confirmed until an owner address and actual registration request are available.

## Before requesting a signature

Supply the existing public payer address and real task. The server checks token balance, exact current quote and request hash, and constructs the fixed original authorization with the official buy SDK. The browser review exposes the full payer, payee, token, amount and Celo network. The server never receives a private key. EOAs only are supported.

Real execution defaults off. After approval, restart with ENABLE_MAINNET_PAYMENTS=1, then the owner clicks Sign & pay in their wallet-enabled browser. A signed request is sent once. Error, timeout or missing output never automatically purchases again.

## Identity registration

Publish reviewed metadata and choose the wallet that should own the agent identity. Run:

```powershell
npm.cmd run identity:review -- --owner=0xPUBLIC_OWNER --uri=https://YOUR_APPROVED_HOST/agent.json
```

Replace both example values with real reviewed inputs; no placeholder transaction should be signed. The script validates registry/chain and prepares unsigned calldata with a read-only gas estimate. It never sends the transaction. Review private/identity-review.json, chain, owner, metadata and gas before asking the user to broadcast from their wallet. Read Agent ID from the mined Registered event, not a simulation return value. The registry is 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432.

## After an approved purchase

Save the real provider response and settlement transaction. The independent verifier requires exact USDC transfer plus this task's authorization nonce in the same successful canonical transaction, after at least three confirmations. Keep service delivery separate from payment status. A transfer does not establish independent-user eligibility.

If the response is lost, preserve UNKNOWN and the full reservation. Find the original transfer from the actual wallet/provider record and use Verify; never sign a second purchase merely to replace a missing result. Redact signatures and bearer capabilities from public artifacts.

Account creation, legal acceptance, public publication/deployment, registration, signatures/funding, user outreach and final submission remain owner-controlled actions. Source and demo materials are prepared for review before any of those actions.

If no hosted metadata URL is ready, the identity review script also accepts --metadata-file=submission/agent-registration.draft.json and creates an inline JSON data URI, as permitted by ERC-8004. Review the complete metadata and gas estimate before signing. This avoids inventing a hosted endpoint or requiring a hosting purchase.
