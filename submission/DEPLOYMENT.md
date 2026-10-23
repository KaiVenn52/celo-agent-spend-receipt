# Deployment review

This folder contains a deployable Node 24 service, not an already-hosted deployment. Docker is not installed in the build environment, so the container recipe has not been built here. The service itself is exercised directly under Node.

## Start locally

```powershell
npm.cmd ci --ignore-scripts
npm.cmd test
npm.cmd run build
npm.cmd start
```

The default listener is loopback on port 4318. Quotes and unsigned payment reviews work. Real execution is disabled.

## Hosted service requirements

Use a single Node process with persistent SQLite storage behind an HTTPS reverse proxy. Set `PUBLIC_ORIGIN` to the exact HTTPS origin, `SESSION_SECRET` to a securely generated secret of at least 32 characters, `DATA_DIR` to a persistent writable volume, and `PORT` to the service port. The server refuses hosted startup without HTTPS and a secret. The proxy must preserve the original Host. Do not run multiple replicas against separate databases: duplicate prevention depends on one shared ledger.

Anonymous browser sessions use signed HttpOnly, SameSite=Strict cookies, Secure on HTTPS. Task reads, lists, replays and live proposals are scoped to that session. There is no account recovery: losing the cookie loses UI access to that session's records, while original onchain transfers remain public. This is a hackathon deployment design, not enterprise authentication.

The container runs as the Node user. Runtime data is `/app/data`. Build with `docker build -t agent-spend-receipt .` after Docker is available. Add a persistent volume and the variables above; use a TLS host's normal deployment workflow. No hosting account, legal terms, paid plan or public deployment was created during this build.

## Mainnet enablement

Leave `ENABLE_MAINNET_PAYMENTS` unset until the owner reviews the exact task and funding arrangement. Setting it to `1` enables the wallet-driven submission route; it does not create a wallet, fund one, or sign anything. Every purchase requires an EOA wallet signature in the user's browser. No signing key enters the server.

The current adapter supports Celo mainnet USDC and the fixed Chainstack buy route only, using `@celo/buy-core@0.8.3`. It pins the original requirement and constructs the exact authorization with the official SDK. An unrelated free re-quote cannot change its recipient, asset, network, amount or EIP-712 domain. Signed requests are compare-and-set in SQLite before one network send. Payment status remains unresolved until transfer and task nonce are independently observed on Celo.

## Release checks before publication

- Recheck the lockfile, test report and responsive screenshots.
- Run a useful approved mainnet purchase and record its actual output, payer, provider PayTo, authorization nonce and transaction hash.
- Register ERC-8004 identity from the intended agent owner wallet, preserving ownership and event evidence.
- Review full participation terms after user login and validate a real independent user. Do not treat anonymous browser sessions as independent-user evidence.
- Test cross-session isolation on the final HTTPS origin and preserve SQLite backup/restart recovery.

The local code and fixture/injected tests are not proof that these mainnet or hosted checks passed.
