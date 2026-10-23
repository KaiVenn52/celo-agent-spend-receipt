import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { createPublicClient, http } from 'viem';
import { digest } from '../src/ledger.mjs';
import { chainVerifier } from '../src/providers.mjs';
import {
  verifyIdentityEvidence,
  verifyPaymentArtifact,
  verifyIndependentUserEvidence,
} from '../src/evidence.mjs';
const manifest = JSON.parse(readFileSync('submission/live-evidence.json', 'utf8'));
const rpc = process.env.CELO_RPC_URL || 'https://forno.celo.org';
const client = createPublicClient({ transport: http(rpc, { timeout: 15000, retryCount: 0 }) });
const report = {
  checkedAt: new Date().toISOString(),
  manifestHash: digest(manifest),
  network: 'Celo mainnet 42220',
  identity: { verified: false },
  payment: { verified: false },
  publicRepository: { verified: false },
  independentUsers: [],
  signaturesCreated: 0,
  broadcasts: 0,
};
const safeError = (e) =>
  e.safe ? e.message : 'RPC or public-service verification failed; inspect provider configuration privately';
try {
  report.identity = await verifyIdentityEvidence(client, manifest.identity);
} catch (e) {
  report.identity.error = safeError(e);
}
try {
  if (!manifest.payment.receiptFile)
    throw Object.assign(
      Error('Save the actual exported receipt under this project and set payment.receiptFile'),
      { safe: true },
    );
  const path = resolve(manifest.payment.receiptFile),
    within = relative(process.cwd(), path);
  if (within.startsWith('..') || isAbsolute(within) || !within.endsWith('.json'))
    throw Object.assign(Error('Receipt must be a JSON artifact inside this project'), { safe: true });
  const artifact = JSON.parse(readFileSync(path, 'utf8'));
  report.payment = await verifyPaymentArtifact(manifest.payment, artifact, chainVerifier(rpc));
} catch (e) {
  report.payment.error = safeError(e);
}
for (const user of manifest.independentUsers || []) {
  try {
    if (!report.payment.verified)
      throw Object.assign(Error('Verify the real product payment before participant usage'), { safe: true });
    const builders = [
      manifest.identity.owner,
      ...(manifest.builderWallets || []),
      ...(manifest.mainFunderWallets || []),
    ].filter(Boolean);
    report.independentUsers.push(
      await verifyIndependentUserEvidence(client, user, manifest.payment, builders),
    );
  } catch (e) {
    report.independentUsers.push({
      wallet: user.wallet,
      onchainChecksPassed: false,
      humanReviewComplete: false,
      error: safeError(e),
    });
  }
}
try {
  const match = manifest.publicRepo?.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/);
  if (!match) throw Object.assign(Error('No reviewed public repository URL supplied'), { safe: true });
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}`,
    { headers: { accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) },
  );
  const repo = await response.json();
  if (!response.ok || repo.private !== false || repo.archived || repo.disabled)
    throw Object.assign(Error('Repository is not publicly readable and active'), { safe: true });
  report.publicRepository = {
    verified: true,
    url: repo.html_url,
    defaultBranch: repo.default_branch,
    checkedWithoutCredentials: true,
  };
} catch (e) {
  report.publicRepository.error = safeError(e);
}
writeFileSync('submission/live-verification.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
