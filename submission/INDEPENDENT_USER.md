# Independent-user evidence checklist

No independent user is claimed yet. Cookie sessions, ephemeral test accounts, dummy quote addresses and builder-created/funded wallets are excluded.

For a real unrelated participant, record consent to use the product and share the necessary public evidence. Keep personal contact data private. The public submission should use a wallet address and minimal permitted description, not identity documents.

Record the person's actual task, current manual workflow, the result they needed, the nominated Celo wallet, and why the external paid service helps. Ask the participant to confirm usefulness after delivery. Do not invent time saved or a willingness-to-pay figure.

The public FAQ qualifies an independent wallet by outside-team control, no initial funding by builder/main funder, and prior Celo activity before the event. Preserve:

- Public wallet and independently observed pre-event transaction, with its actual block timestamp before 6 October 2026.
- First-funding transaction and review of its source. Do not fund a new wallet and call it independent.
- Participant's relationship declaration, consent and evidence of the useful product task.
- Actual service payment/usage transaction and resulting output, associated with the task authorization nonce.

The app's snapshot cannot prove these conditions. Public chain history plus human relationship review are required, and the organizer remains the final judge. New-user onboarding can be disclosed separately without treating it as the independent-user qualifier.

Only add a participant to live-evidence.json after this review. An independentUsers entry should include wallet, consent, relationshipDeclaration, preEventTransaction, firstFundingTransaction, usageTransaction and reviewed. None of these fields should be populated with fixtures.

The read-only checker additionally requires firstFundingReviewed=true, which is a human assertion after examining earliest funding history. It verifies only the selected funding transaction, rejects known builder/main-funder sources, and uses a conservative pre-event cutoff of 6 October 00:00 UTC. Same-day activity needs a separate review against the organizer confirmed start time. Include builderWallets and mainFunderWallets in the manifest before running the check.
