const $ = (selector) => document.querySelector(selector);
let config,
  wallet,
  review,
  submitting = false;
const submittedKey = 'asr-identity-submitted';
async function api(path, body) {
  const response = await fetch(
    path,
    body
      ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {},
  );
  const data = await response.json();
  if (!response.ok) throw Error(data.error || 'Review failed');
  return data;
}
function invalidate() {
  review = null;
  $('#identity-consent').checked = false;
  $('#identity-register').disabled = true;
  $('#identity-review').hidden = true;
}
function updateButton() {
  $('#identity-register').disabled =
    wallet?.toLowerCase() !== config?.owner?.toLowerCase() ||
    submitting ||
    !review?.canAfford ||
    !$('#identity-consent').checked ||
    Date.now() >= review.expiresAt;
}
async function action(fn) {
  $('#identity-error').textContent = '';
  try {
    await fn();
  } catch (error) {
    $('#identity-error').textContent = error.message;
  }
}
$('#identity-connect').onclick = () =>
  action(async () => {
    invalidate();
    if (!window.ethereum) throw Error('Open this page in a browser with an EVM wallet extension.');
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    wallet = accounts[0];
    if (wallet?.toLowerCase() !== config.owner?.toLowerCase())
      throw Error('Select the approved owner wallet shown above.');
    if (Number(await window.ethereum.request({ method: 'eth_chainId' })) !== 42220)
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0xa4ec' }],
      });
    $('#identity-connect').textContent = 'Owner connected';
  });
$('#identity-prepare').onclick = () =>
  action(async () => {
    invalidate();
    $('#identity-prepare').disabled = true;
    $('#identity-prepare').textContent = 'Checking chain and gas…';
    try {
      const pending = localStorage.getItem(submittedKey + ':' + config.owner);
      if (pending)
        throw Error(
          'A registration was already submitted from this browser: ' +
            pending +
            '. Inspect that transaction before preparing another.',
        );
      review = await api('/api/identity/prepare', { owner: config.owner });
      $('#identity-transaction').textContent = JSON.stringify(review.transaction, null, 2);
      $('#identity-fee').textContent =
        `Current estimated fee: ${review.estimatedFeeCELO} CELO. Gas limit includes 20% headroom; at the queried fee rate that is ${review.bufferedFeeCELO} CELO. Your wallet shows the final fee. Refresh this review after 60 seconds.`;
      $('#identity-balance').textContent =
        `Owner balance: ${review.balanceCELO} CELO. ` +
        (review.canAfford
          ? 'Enough for this gas estimate.'
          : 'Add CELO on Celo mainnet, then review gas again.');
      $('#identity-review').hidden = false;
      updateButton();
    } finally {
      $('#identity-prepare').disabled = false;
      $('#identity-prepare').textContent = 'Review current gas';
    }
  });
$('#identity-consent').onchange = updateButton;
$('#identity-register').onclick = () =>
  action(async () => {
    if (submitting) return;
    if (!review?.canAfford || !$('#identity-consent').checked || Date.now() >= review.expiresAt)
      throw Error('Refresh the gas review and confirm the metadata before registering.');
    if (!window.ethereum) throw Error('Connect your own EVM wallet first.');
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    if (
      accounts[0]?.toLowerCase() !== config.owner.toLowerCase() ||
      Number(await window.ethereum.request({ method: 'eth_chainId' })) !== 42220
    ) {
      invalidate();
      throw Error('Select the approved owner on Celo mainnet, then prepare again.');
    }
    submitting = true;
    updateButton();
    $('#identity-status').textContent = 'Review the registration transaction and network fee in your wallet.';
    try {
      localStorage.setItem(submittedKey + ':' + config.owner, 'wallet-response-unconfirmed');
      const hash = await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [review.transaction],
      });
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash))
        throw Error(
          'Wallet did not return a valid transaction hash. Inspect wallet activity before retrying.',
        );
      localStorage.setItem(submittedKey + ':' + config.owner, hash);
      $('#identity-status').textContent =
        'Transaction submitted: ' +
        hash +
        '. Confirm the mined Registered event before recording an Agent ID.';
      $('#identity-explorer').href = 'https://celoscan.io/tx/' + hash;
      $('#identity-explorer').hidden = false;
      review = null;
    } catch (error) {
      if (error.code === 4001) localStorage.removeItem(submittedKey + ':' + config.owner);
      review = null;
      $('#identity-status').textContent =
        'Registration is unconfirmed. Inspect wallet activity before preparing another transaction.';
      throw error;
    } finally {
      submitting = false;
      updateButton();
    }
  });
if (window.ethereum?.on) {
  const changed = () => {
    wallet = null;
    invalidate();
  };
  window.ethereum.on('accountsChanged', changed);
  window.ethereum.on('chainChanged', changed);
}
action(async () => {
  config = await api('/api/identity');
  $('#identity-owner').textContent = config.owner || 'No approved owner configured';
  $('#identity-registry').textContent = config.registry;
  $('#identity-metadata').textContent = JSON.stringify(config.metadata, null, 2);
  $('#identity-prepare').disabled = !config.owner;
});
