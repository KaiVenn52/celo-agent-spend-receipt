# Release readiness — 24 October 2026

**Local implementation and publication review package prepared. Competition submission is blocked on real external evidence and owner-controlled actions.**

Target: Agents on Open Rails, Build with buy. Official deadline: 9 November 2026, 09:00 GMT / 17:00 Malaysia time.

| Evidence                              | Status                       | What it establishes                                                                                                                                                |
| ------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| v0.2 local product                    | Implemented                  | Task workspace, atomic budget, request deduplication, unsigned authorization cancellation, one-send recovery, receipt export and session isolation.                |
| Official buy SDK                      | Integrated                   | Pinned @celo/buy-core 0.8.3 generates fixed EIP-3009 payloads; no CLI re-quote at signing.                                                                         |
| Automated unit/integration tests      | See evidence/validation.json | Local SDK, crypto, database, HTTP and mocked-RPC checks.                                                                                                           |
| Rendered UI                           | Passed                       | 1440/1280 desktop, 768 tablet, 375 mobile; success, replay, export, reload, refusal, uncertain hold and real unsigned quote. See assets/ui-qa.json.                |
| Injected browser signing              | Passed                       | EOA connection -> SDK typed data -> real test signature -> one injected send -> injected reconciliation. Not mainnet settlement.                                   |
| Real external quote                   | Observed 22 October          | Exact Chainstack request produced Celo USDC 402 quote for 10,000 atomic units (0.01 USDC). Historical quote expires; requote before approval.                      |
| Mainnet public RPC                    | Observed                     | Forno returned chain ID 42220. Not a paid Chainstack result.                                                                                                       |
| Build                                 | Prepared                     | Runnable Node source/static package, pinned lockfile, CI workflow and nonroot Docker recipe. Docker unavailable locally; container itself untested.                |
| Real provider delivery and settlement | Missing                      | Owner-approved funded EOA, fresh quote, actual wallet signature and real useful output required.                                                                   |
| ERC-8004 Agent ID                     | Missing                      | Unsigned calldata preparation implemented; owner/approved metadata/gas/registration signature not supplied.                                                          |
| Independent user                      | Missing                      | No wallet history, consent or real-user task supplied; no self-created wallets counted.                                                                            |
| Public repository                     | Published and checked       | https://github.com/KaiVenn52/celo-agent-spend-receipt; anonymously readable.                                                                                                          |
| Hosted service                        | Optional / form-dependent    | No universal hosting requirement found in reviewed Build with buy FAQ; confirm the actual submission form. A public repo and reproducible local demo are prepared. |
| Eligibility / terms                   | Partially resolved           | Platform terms require age 16+; event-specific remote/Malaysia/payout conditions remain unconfirmed. No terms accepted.                                            |
| Registration / final submission       | Not performed                | User retains account, terms and final submission confirmation.                                                                                                     |

## Exact next gates

1. Owner supplies the intended public payer/agent-owner address and a real unrelated user's actual task. Never request private keys.
2. Owner reviews and approves publication of the prepared source and demo package. If a hosted demo is chosen, deploy one persistent SQLite service behind HTTPS and verify session isolation on the final origin.
3. Review current portal terms and register the project only after user approval. Preserve the Build with buy attribution exemption; provide actual payer/provider PayTo.
4. Simulate and review ERC-8004 registration from the intended owner, then obtain a user-controlled signature. Read Agent ID from the mined Registered event.
5. Obtain a fresh quote for the real task; proposed first call is at most 0.01 USDC if the current quote permits. Enable the payment route only after approval. The user signs the exact authorization in their own wallet.
6. Preserve actual provider output, transfer, authorization nonce and independent-user evidence; rerun readiness and let the owner review final submission fields.

There is no substitute for the missing real-user or mainnet evidence. Local test keys, dummy quote addresses, anonymous sessions and fixture payments are excluded from qualification counts.

A public hosted service is not treated as a universal competition requirement without an explicit event rule. ERC-8004 also supports inline JSON metadata, so identity registration need not depend on purchasing hosting. The optional metadata-file route prepares that payload without broadcasting.

The 23 October verification update adds read-only identity-event, payment-artifact and participant-history checking. Run npm.cmd run evidence:verify before npm.cmd run readiness. Both commands preserve missing evidence as blockers and never sign or broadcast.

The 24 October release check passed all 59 local tests, rebuilt the runnable package and repeated the rendered UI checks against the local server. Fresh screenshots and the real unsigned quote review are in assets/. Review scripts now derive their date in Asia/Kuala_Lumpur rather than using a fixed date. Historical evidence retains its original timestamps.
