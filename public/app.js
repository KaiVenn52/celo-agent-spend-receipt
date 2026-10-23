let receipt = null,
  wallet = null,
  proposal = null,
  capabilities = { paymentsEnabled: false },
  historyTasks = [];
const $ = (s) => document.querySelector(s),
  form = $('#task-form'),
  run = $('#run'),
  error = $('#error'),
  download = $('#export'),
  mode = $('#mode'),
  dialog = $('#payment-dialog');
const money = (value) => (Number(value) / 1000000).toFixed(6),
  short = (value) => (value ? value.slice(0, 6) + '…' + value.slice(-4) : '—');
const el = (tag, text = '', cls) => {
  const n = document.createElement(tag);
  n.textContent = text;
  if (cls) n.className = cls;
  return n;
};
const fromDecimal = (value) => {
  if (!/^\d+(\.\d{1,6})?$/.test(value)) throw Error('Use a positive USDC budget with at most six decimals');
  const [whole, fraction = ''] = value.split('.');
  const n = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
  if (n <= 0n || n > 999999999999n) throw Error('Budget is outside the supported range');
  return n.toString();
};
async function api(path, body) {
  const response = await fetch(
    path,
    body === undefined
      ? {}
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  );
  const data = await response.json();
  if (!response.ok) throw Error(data.error || 'Request failed');
  return data;
}
function setMode() {
  const live = mode.value === 'live';
  $('#mode-note').classList.toggle('live', live);
  $('#mode-note p').textContent = live
    ? 'Real service. Real USDC. Get an unpaid quote first, then review the recipient and amount before any wallet signature.'
    : "You're in the demo workspace. Results and payments are simulated. Switch to Chainstack to get a real quote.";
  run.textContent = live ? 'Get service quote' : 'Run demo';
  $('#scenario').closest('label').hidden = live;
  $('#footer-evidence').textContent = live
    ? 'Quotes are free · signatures authorize real funds'
    : 'Local demo · no funds moved';
}
mode.onchange = () => {
  setMode();
  error.textContent = '';
};
async function connect() {
  if (!window.ethereum)
    throw Error(
      'Open this app in a browser with an EVM wallet extension to connect. Demo and quote preview work without a signature.',
    );
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  if (!accounts?.[0]) throw Error('Wallet did not return an account');
  wallet = accounts[0];
  $('#connect-wallet').textContent = short(wallet);
  return wallet;
}
$('#connect-wallet').onclick = () => connect().catch((e) => (error.textContent = e.message));
window.ethereum?.on?.('accountsChanged', (accounts) => {
  wallet = accounts[0] || null;
  $('#connect-wallet').textContent = wallet ? short(wallet) : 'Connect wallet';
  if (dialog.open) {
    $('#payment-error').textContent = 'Wallet changed. Close this review and get a new quote.';
    $('#sign-payment').disabled = true;
  }
});
function lineList(items) {
  const list = el('dl');
  for (const [label, value, cls] of items) {
    const row = el('div');
    row.append(el('dt', label));
    const dd = el('dd', '', cls);
    if (value instanceof Node) dd.append(value);
    else dd.textContent = value;
    row.append(dd);
    list.append(row);
  }
  return list;
}
async function refreshHistory() {
  try {
    historyTasks = await api('/api/tasks');
    $('#task-count').textContent = historyTasks.length;
    const list = $('#task-list');
    list.replaceChildren();
    if (!historyTasks.length) list.append(el('p', 'Your runs will appear here.', 'no-history'));
    const mobile = $('#mobile-task-select');
    mobile.replaceChildren(el('option', 'New wallet review'));
    mobile.firstChild.value = '';
    for (const t of historyTasks) {
      const option = el(
        'option',
        'Review ' + t.id.slice(0, 6) + ' · ' + (t.mode === 'fixture' ? 'Demo' : 'Mainnet'),
      );
      option.value = t.id;
      option.selected = t.id === receipt?.id;
      mobile.append(option);
      const b = el('button', '', 'task-item' + (receipt?.id === t.id ? ' selected' : ''));
      b.append(
        el('strong', 'Wallet review · ' + t.id.slice(0, 4)),
        el('small', (t.mode === 'fixture' ? 'DEMO' : 'MAINNET') + ' / ' + t.state),
      );
      b.onclick = async () => {
        try {
          render(await api('/api/task?id=' + encodeURIComponent(t.id)));
        } catch (e) {
          error.textContent = e.message;
        }
      };
      list.append(b);
    }
  } catch (e) {
    error.textContent = 'Task history unavailable: ' + e.message;
  }
}
function render(data) {
  receipt = data;
  history.replaceState(null, '', '?task=' + encodeURIComponent(data.id));
  $('#breadcrumb-task').textContent = 'Wallet review · ' + data.id.slice(0, 8);
  const call = data.calls.at(-1);
  const fixture = data.mode === 'fixture';
  const settled = call?.state === 'SETTLED',
    unknown = call?.state === 'UNKNOWN';
  $('#budget-total').textContent = money(data.budget);
  $('#spent').textContent = money(data.spent);
  $('#reserved').textContent = money(data.reserved);
  $('#available').textContent = money(data.available);
  $('#spent-bar').style.width = (100 * data.spent) / data.budget + '%';
  $('#reserved-bar').style.width = (100 * data.reserved) / data.budget + '%';
  $('#result-state').textContent = call
    ? (fixture ? 'Demo · ' : '') + call.state.toLowerCase().replaceAll('_', ' ')
    : 'Not started';
  $('#calls-count').textContent = data.calls.length + ' call' + (data.calls.length === 1 ? '' : 's');
  const rows = $('#call-rows');
  rows.replaceChildren();
  for (const c of data.calls) {
    const row = el('tr'),
      service = el('td');
    service.append(el('strong', 'Chainstack'), el('small', 'Celo JSON-RPC'));
    row.append(service, el('td', 'Wallet snapshot'), el('td', money(c.amount)));
    const state = el('td');
    state.append(
      el(
        'span',
        c.state === 'SETTLED'
          ? fixture
            ? 'Demo settled'
            : 'Verified'
          : c.state === 'UNKNOWN'
            ? 'Needs review'
            : c.state.toLowerCase().replaceAll('_', ' '),
        'state ' + (c.state === 'SETTLED' ? 'good' : 'hold'),
      ),
    );
    row.append(state);
    rows.append(row);
  }
  const result = $('#task-result');
  result.replaceChildren();
  let rpc = call?.result?.rpc || call?.result;
  const valid =
    Array.isArray(rpc) &&
    [1, 2, 3].every((id) =>
      rpc.some(
        (r) => r.id === id && typeof r.result === 'string' && /^0x[0-9a-fA-F]+$/.test(r.result) && !r.error,
      ),
    );
  if (valid) {
    const values = new Map(rpc.map((r) => [r.id, r.result]));
    const snapshot = el('div', '', 'snapshot'),
      head = el('div', '', 'snapshot-heading'),
      icon = el('div', '0x', 'snapshot-avatar'),
      description = el('div');
    const address = call.quote.target || form.address.value;
    description.append(
      el('h3', short(address)),
      el('p', 'Celo mainnet · ' + (fixture ? 'synthetic snapshot' : 'provider response')),
    );
    head.append(icon, description);
    snapshot.append(head);
    let balance;
    try {
      const wei = BigInt(values.get(2));
      balance =
        (wei / 1000000000000000000n).toString() +
        '.' +
        (wei % 1000000000000000000n).toString().padStart(18, '0').slice(0, 4);
    } catch {
      balance = 'Invalid';
    }
    const dl = lineList([
      ['Native balance', balance + ' CELO'],
      ['Transactions sent', BigInt(values.get(3)).toString()],
    ]);
    dl.className = 'snapshot-values';
    snapshot.append(
      dl,
      el(
        'p',
        fixture
          ? 'Synthetic data · no provider called and no payment made.'
          : settled
            ? 'Provider response with independently verified transfer and authorization nonce.'
            : 'Provider response received. Payment verification is still pending.',
        'result-caption',
      ),
    );
    result.append(snapshot);
  } else {
    const box = el('div', '', 'hold-result');
    box.append(
      el(
        'h3',
        unknown
          ? 'Payment needs a closer look'
          : call?.state === 'AWAITING_SIGNATURE'
            ? 'Ready for your review'
            : call?.state === 'CANCELLED'
              ? 'Authorization cancelled'
              : 'Waiting for a result',
      ),
      el(
        'p',
        unknown
          ? 'The call may have settled before its response was lost. Your budget is held. Check the original transaction; the agent will not purchase again.'
          : call?.state === 'AWAITING_SIGNATURE'
            ? 'The unsigned request is fixed to this recipient, token and amount. No payment has been sent.'
            : 'No usable wallet snapshot was returned. Inspect the receipt below for the current state.',
      ),
    );
    if (call?.state === 'AWAITING_SIGNATURE') {
      const cancel = el('button', 'Cancel unsigned authorization', 'outline-button');
      cancel.onclick = async () => {
        try {
          render(await api('/api/live/cancel', { id: data.id }));
        } catch (e) {
          error.textContent = e.message;
        }
      };
      box.append(cancel);
    }
    result.append(box);
  }
  $('#receipt-number').textContent = call ? '#' + data.id.slice(0, 6).toUpperCase() : '—';
  const detail = $('#receipt-detail');
  detail.replaceChildren();
  if (call) {
    detail.append(
      el(
        'p',
        fixture
          ? 'LOCAL DEMO · NO FUNDS MOVED'
          : settled
            ? 'TRANSFER + NONCE VERIFIED'
            : 'MAINNET · NOT VERIFIED',
        'payment-evidence ' + (!fixture && !settled ? 'hold' : ''),
      ),
    );
    let tx = 'None · demo';
    if (!fixture) {
      tx = call.tx || call.evidence?.claimedTx || 'Not available';
      if (/^0x[0-9a-fA-F]{64}$/.test(tx)) {
        const a = el('a', short(tx));
        a.href = 'https://celoscan.io/tx/' + tx;
        a.target = '_blank';
        a.rel = 'noreferrer';
        tx = a;
      }
    }
    detail.append(
      lineList([
        ['Service', 'Chainstack via buy'],
        ['Amount', money(call.amount) + ' USDC', 'mono'],
        ['Network', 'Celo · 42220'],
        ['Pay to', fixture ? 'Simulated recipient' : short(call.quote.payTo), 'mono'],
        ['Transaction', tx],
        [
          'Evidence',
          fixture ? 'Fixture only' : settled ? 'RPC transfer + nonce' : 'Provider claim / pending',
        ],
      ]),
    );
    if (!fixture && unknown) {
      const reconcile = el('form');
      reconcile.id = 'reconcile-form';
      const hash = el('input');
      hash.placeholder = 'Original tx hash';
      hash.setAttribute('aria-label', 'Original transaction hash');
      hash.value = call.evidence?.claimedTx || '';
      const check = el('button', 'Verify');
      check.type = 'submit';
      reconcile.append(hash, check);
      reconcile.onsubmit = async (e) => {
        e.preventDefault();
        check.disabled = true;
        try {
          render(await api('/api/live/reconcile', { id: data.id, tx: hash.value || undefined }));
        } catch (e) {
          error.textContent = e.message;
        } finally {
          check.disabled = false;
        }
      };
      detail.append(reconcile);
    }
  }
  $('#raw-receipt').textContent = JSON.stringify(data, null, 2);
  download.disabled = false;
  $('#task-actions').hidden = !fixture;
  $('#footer-evidence').textContent = fixture
    ? 'Local demo · no funds moved'
    : settled
      ? 'Mainnet transfer verified · provider result separate'
      : 'Mainnet task · unresolved evidence';
  refreshHistory();
}
async function submit(taskId) {
  error.textContent = '';
  run.disabled = true;
  form.setAttribute('aria-busy', 'true');
  run.textContent = mode.value === 'live' ? 'Fetching quote…' : 'Checking task…';
  try {
    const budget = fromDecimal(form.budget.value);
    if (mode.value === 'fixture') {
      render(
        await api('/api/demo', {
          address: form.address.value,
          budget,
          scenario: form.scenario.value,
          taskId,
        }),
      );
    } else {
      const payer = wallet || form.address.value;
      proposal = await api('/api/live/quote', { address: form.address.value, budget, payer });
      const q = proposal.quote;
      $('#payment-review').replaceChildren(
        lineList([
          ['Service', 'Chainstack · wallet snapshot'],
          ['Network', 'Celo mainnet · 42220'],
          ['Price', money(q.amount) + ' USDC'],
          ['Payer', q.payer],
          ['Pay to', q.payTo],
          ['Token', q.asset],
        ]),
      );
      $('#payment-error').textContent = capabilities.paymentsEnabled
        ? ''
        : 'This deployment is in review mode. Real signing is disabled by the owner; the quote above is live.';
      $('#sign-payment').disabled = !capabilities.paymentsEnabled;
      dialog.showModal();
    }
  } catch (e) {
    error.textContent = e.message;
  } finally {
    run.disabled = false;
    form.removeAttribute('aria-busy');
    setMode();
  }
}
form.onsubmit = (e) => {
  e.preventDefault();
  submit();
};
$('#replay').onclick = () => {
  if (receipt?.mode === 'fixture') {
    mode.value = 'fixture';
    form.budget.value = money(receipt.budget);
    form.address.value = receipt.calls[0]?.quote.target || form.address.value;
    submit(receipt.id);
  }
};
$('#mobile-task-select').onchange = async (e) => {
  if (!e.target.value) {
    location.href = '/';
    return;
  }
  try {
    render(await api('/api/task?id=' + encodeURIComponent(e.target.value)));
  } catch (e) {
    error.textContent = e.message;
  }
};
$('#new-task').onclick = () => {
  receipt = null;
  history.replaceState(null, '', '/');
  location.reload();
};
$('#sign-payment').onclick = async () => {
  const sign = $('#sign-payment');
  sign.disabled = true;
  $('#payment-error').textContent = 'Preparing exact authorization…';
  try {
    if (!wallet) await connect();
    if (wallet.toLowerCase() !== proposal.quote.payer.toLowerCase())
      throw Error('Connected wallet differs from quoted payer. Close this review and get a new quote.');
    const chain = await window.ethereum.request({ method: 'eth_chainId' });
    if (BigInt(chain) !== 42220n) throw Error('Switch your wallet to Celo mainnet before signing.');
    const prepared = await api('/api/live/prepare', { id: proposal.id });
    render(prepared.task);
    const typed = prepared.typedData;
    typed.types.EIP712Domain = [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ];
    $('#payment-error').textContent = 'Review the exact USDC amount and recipient in your wallet.';
    const signature = await window.ethereum.request({
      method: 'eth_signTypedData_v4',
      params: [wallet, JSON.stringify(typed)],
    });
    $('#payment-error').textContent = 'Sending once. Do not close this window or purchase again.';
    const task = await api('/api/live/pay', { id: proposal.id, signature });
    dialog.close();
    render(task);
    const tx = task.calls.at(-1)?.evidence?.claimedTx;
    if (tx) {
      try {
        render(await api('/api/live/reconcile', { id: task.id, tx }));
      } catch (e) {
        error.textContent = 'Payment is held for verification: ' + e.message;
      }
    }
  } catch (e) {
    $('#payment-error').textContent = e.message;
    sign.disabled = false;
  }
};
let lastFocus = null;
dialog.addEventListener('close', () => {
  lastFocus?.focus();
});
dialog.addEventListener('cancel', () => {
  lastFocus = run;
});
$('#export').onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' }));
  const a = el('a');
  a.href = url;
  a.download = (receipt.mode === 'fixture' ? 'fixture-' : 'mainnet-') + 'spend-receipt.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
api('/api/health')
  .then((data) => (capabilities = data))
  .catch((e) => (error.textContent = e.message));
const saved = new URLSearchParams(location.search).get('task');
if (saved)
  api('/api/task?id=' + encodeURIComponent(saved))
    .then((data) => {
      form.address.value = data.calls[0]?.quote.target || form.address.value;
      form.budget.value = money(data.budget);
      mode.value = data.mode;
      setMode();
      render(data);
    })
    .catch((e) => (error.textContent = 'Could not restore task: ' + e.message));
else refreshHistory();
setMode();
