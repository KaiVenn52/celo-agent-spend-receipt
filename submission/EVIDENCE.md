# Import and independently check live evidence

The publication package deliberately contains no real registration, payment or participant claim. `live-evidence.json` is an empty manifest. Test-only transactions and ephemeral signatures are not imported into it.

After an owner-approved real purchase, use **Export receipt** in that same browser session and save the JSON under this project's ignored `private/` directory. Set `payment.receiptFile` to its project-relative path. Fill the actual payer, provider PayTo, transaction hash and authorization nonce from the receipt, not from the fixture demo. `payment.usefulResult` is a separate human review after delivery; it is not inferred from payment success.

Fill the actual registered Agent ID, owner, approved agentURI and registration transaction. The onchain URI must match the project metadata reviewed before signing. The checker verifies a successful `Registered` event from Celo's official registry, its canonical block and confirmations, and the identity's current `ownerOf`. It rejects look-alike events from another contract and changed ownership.

For an independent participant, record consent and the reviewed relationship, earliest funding history, pre-event activity transaction and product-usage payment. The checker verifies selected public transactions and excludes known builder/funder wallets. It cannot prove that the selected funding transaction was the first or that two people are unrelated; those remain explicit human review and organizer decisions. The conservative automated pre-event cutoff is 6 October 00:00 UTC, not a claim about the precise kick-off hour.

After publication approval, set the actual public GitHub URL. The check reads GitHub without credentials and confirms the repository is public, active and accessible.

```powershell
npm.cmd run evidence:verify
npm.cmd run readiness
```

The first command is read-only. It sends no wallet request, signature, payment, registration or GitHub mutation. It writes `live-verification.json` with RPC observations or exact missing-evidence reasons. The second command requires that report to match the current manifest hash. Editing any manifest fields requires another read-only check; setting a JSON `verified` flag does not pass the identity/payment/repository gates.

Source links for the checker:

- Celo ERC-8004 documentation: https://docs.celo.org/build/agents/8004
- Celo x402 documentation: https://docs.celo.org/build/agents/x402
- Circle EIP-3009 implementation: https://github.com/circlefin/stablecoin-evm/blob/master/contracts/v2/EIP3009.sol

Limitations: observations trust the configured HTTPS RPC and public GitHub API. This is not a consensus light client, a legal eligibility determination or proof of useful service delivery. Do not publish private receipts or personal data without reviewing them. Add only the minimal permitted public proof to the submission; raw signatures must never be published.
