import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { digest } from '../src/ledger.mjs';
const evidence = JSON.parse(readFileSync('submission/live-evidence.json', 'utf8'));
const verification = existsSync('submission/live-verification.json')
  ? JSON.parse(readFileSync('submission/live-verification.json', 'utf8'))
  : {};
const boundVerification = verification.manifestHash === digest(evidence);
const local = existsSync('evidence/validation.json')
  ? JSON.parse(readFileSync('evidence/validation.json', 'utf8'))
  : {};
const ui = existsSync('submission/assets/ui-qa.json')
  ? JSON.parse(readFileSync('submission/assets/ui-qa.json', 'utf8'))
  : {};
const injected = existsSync('evidence/ui-live-injected.json')
  ? JSON.parse(readFileSync('evidence/ui-live-injected.json', 'utf8'))
  : {};
const tx = (x) => /^0x[0-9a-fA-F]{64}$/.test(x || '');
const gates = {
  localTests: local.testsFailed === 0 && local.testsPassed > 0,
  build: local.build === 'passed',
  renderedUi: ui.passed === true,
  injectedSigningFlow: injected.passed === true,
  publicRepository: boundVerification && verification.publicRepository?.verified === true,
  identity:
    boundVerification &&
    verification.identity?.verified === true &&
    evidence.identity.agentId !== null &&
    tx(evidence.identity.transaction),
  mainnetPayment:
    boundVerification &&
    verification.payment?.verified === true &&
    tx(evidence.payment.transaction) &&
    !!evidence.payment.authorizationNonce,
  usefulProviderResult:
    boundVerification &&
    verification.payment?.providerResultShapeValid === true &&
    evidence.payment.usefulResult === true,
  independentUser:
    boundVerification &&
    verification.independentUsers?.some(
      (u) => u.onchainChecksPassed === true && u.humanReviewComplete === true,
    ) === true,
  terms: evidence.ownerReviewedTerms === true,
  remoteEligibility: evidence.remoteOnlyEligibilityConfirmed === true,
  registration: evidence.registration.accepted === true,
  finalOwnerApproval: evidence.finalSubmissionApproved === true,
};
const report = {
  checkedAt: new Date().toISOString(),
  clientReviewDate: '2026-10-23',
  localReady: ['localTests', 'build', 'renderedUi', 'injectedSigningFlow'].every((k) => gates[k]),
  submissionReady: Object.values(gates).every(Boolean),
  optional: { hostedDeployment: !!evidence.deploymentUrl },
  gates,
  blockers: Object.entries(gates)
    .filter(([, ok]) => !ok)
    .map(([key]) => key),
  note: 'Identity, payment and public-repo gates require the matching read-only verification report. Participant history checks remain separate from human relationship/first-funding review and organizer eligibility judgment.',
};
writeFileSync('submission/readiness.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
