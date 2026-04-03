/* ========================================================
   Code Update — Frontend App
   Tabs: Home | Deploy | Deployments | Servers | History
   ======================================================== */

// ── Helpers ────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const show = el => el.classList.remove('hidden');
const hide = el => el.classList.add('hidden');
const api = async (url, opts = {}) => {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const text = await r.text();
  try {
    const data = JSON.parse(text);
    if (!r.ok && data.error) throw new Error(data.error);
    return data;
  } catch (e) {
    if (e.message && !e.message.includes('JSON')) throw e;
    throw new Error(`Server error (${r.status}): ${text.slice(0, 200)}`);
  }
};

function fmtBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}
function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function fmtDuration(startIso, endIso) {
  if (!startIso || !endIso) return '';
  const ms = new Date(endIso) - new Date(startIso);
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(1) + 's';
}

// ── Tab Navigation ──────────────────────────────────────────
const tabs = ['home', 'deploy', 'deployments', 'servers', 'history'];
tabs.forEach(tab => {
  $(`nav-${tab}`).addEventListener('click', () => switchTab(tab));
});

function switchTab(tab) {
  tabs.forEach(t => {
    $(`tab-${t}`).classList.toggle('active', t === tab);
    $(`nav-${t}`).classList.toggle('active', t === tab);
  });
  if (tab === 'home') loadHome();
  if (tab === 'deploy') loadDeploySelect();
  if (tab === 'deployments') loadDeployments();
  if (tab === 'servers') loadServers();
  if (tab === 'history') loadHistory();
  // Re-init Lucide icons for any new data-lucide elements in the active tab
  if (window.lucide) lucide.createIcons();
}


$('home-deploy-btn').addEventListener('click', () => switchTab('deploy'));

// ── Modal Helpers ───────────────────────────────────────────
function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }

document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal(overlay.id);
  });
});

// ── Confirm Modal ───────────────────────────────────────────
let _confirmCallback = null;
function confirm(msg, cb) {
  $('confirm-message').textContent = msg;
  _confirmCallback = cb;
  openModal('confirm-modal');
}
$('confirm-ok').addEventListener('click', () => {
  closeModal('confirm-modal');
  if (_confirmCallback) _confirmCallback();
  _confirmCallback = null;
});

// ─────────────────────────────────────────────────────────────
// CHART INSTANCES (stored so we can destroy before re-render)
// ─────────────────────────────────────────────────────────────
let _chartTrend = null;
let _chartRate  = null;
let _chartCfg   = null;

const C_SUCCESS = '#10b981';
const C_FAILED  = '#ef4444';
const C_SUCCESS_BG = 'rgba(16,185,129,0.15)';
const C_FAILED_BG  = 'rgba(239,68,68,0.15)';
const C_PRIMARY = '#6366f1';
const C_PRIMARY_BG = 'rgba(99,102,241,0.2)';

const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 600, easing: 'easeOutQuart' },
  plugins: { legend: { display: false }, tooltip: { cornerRadius: 6 } },
};

// ─────────────────────────────────────────────────────────────
// HOME TAB
// ─────────────────────────────────────────────────────────────
async function loadHome() {
  try {
    const [servers, configs, stats, history] = await Promise.all([
      api('/api/servers'),
      api('/api/deployments'),
      api('/api/history/stats'),
      api('/api/history?limit=200'),
    ]);
    $('stat-servers').textContent  = servers.length;
    $('stat-configs').textContent  = configs.length;
    $('stat-success').textContent  = stats.success ?? 0;
    $('stat-failed').textContent   = stats.failed  ?? 0;

    renderCharts(history, configs);
    renderHistoryList('home-history-list', history.slice(0, 10), { compact: true });
  } catch (e) {
    console.error('loadHome error', e);
  }
}

function renderCharts(history, configs) {
  renderTrendChart(history);
  renderRateChart(history);
  renderConfigsChart(history, configs);
}

/* ── 7-day trend bar chart ───────────────────────────────── */
function renderTrendChart(history) {
  const canvas = $('chart-trend');
  if (_chartTrend) { _chartTrend.destroy(); _chartTrend = null; }

  // Build last-7-days buckets
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  const succ = Object.fromEntries(days.map(d => [d, 0]));
  const fail = Object.fromEntries(days.map(d => [d, 0]));
  history.forEach(r => {
    const day = (r.startedAt || '').slice(0, 10);
    if (succ[day] !== undefined) {
      if (r.status === 'success') succ[day]++;
      else if (r.status === 'failed') fail[day]++;
    }
  });

  const labels = days.map(d => {
    const [, m, day] = d.split('-');
    return `${+m}/${+day}`;
  });

  if (history.length === 0) {
    canvas.parentElement.innerHTML = '<div class="chart-empty">暂无数据</div>';
    return;
  }

  const T = 'rgba(255,255,255,0.15)'; // grid lines on dark bg
  const tickColor = 'rgba(255,255,255,0.55)';

  _chartTrend = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: '成功',
          data: days.map(d => succ[d]),
          backgroundColor: 'rgba(52,211,153,0.65)',
          borderColor: '#34d399',
          borderWidth: 1.5,
          borderRadius: 6,
          barPercentage: 0.6,
        },
        {
          label: '失败',
          data: days.map(d => fail[d]),
          backgroundColor: 'rgba(248,113,113,0.55)',
          borderColor: '#f87171',
          borderWidth: 1.5,
          borderRadius: 6,
          barPercentage: 0.6,
        },
      ],
    },
    options: {
      ...CHART_DEFAULTS,
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 11, family: 'Inter' }, color: tickColor },
        },
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1, font: { size: 11, family: 'Inter' }, color: tickColor },
          grid: { color: T },
        },
      },
      plugins: {
        ...CHART_DEFAULTS.plugins,
        legend: { display: true, position: 'top', labels: { boxWidth: 10, boxHeight: 10, borderRadius: 5, font: { size: 11 }, color: 'rgba(255,255,255,0.75)', usePointStyle: true, pointStyle: 'circle' } },
        tooltip: {
          ...CHART_DEFAULTS.plugins.tooltip,
          callbacks: { title: items => `${items[0].label} 部署记录` },
        },
      },
    },
  });
}

/* ── Success rate donut ───────────────────────────────────── */
function renderRateChart(history) {
  const canvas = $('chart-rate');
  const legend = $('chart-rate-legend');
  if (_chartRate) { _chartRate.destroy(); _chartRate = null; }

  const total = history.filter(r => r.status !== 'running').length;
  const succ  = history.filter(r => r.status === 'success').length;
  const fail  = history.filter(r => r.status === 'failed').length;

  if (total === 0) {
    canvas.parentElement.innerHTML = '<div class="chart-empty">暂无数据</div>';
    legend.innerHTML = '';
    return;
  }

  const pct = Math.round((succ / total) * 100);

  _chartRate = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['成功', '失败'],
      datasets: [{
        data: [succ, fail],
        backgroundColor: ['#34d399', '#f87171'],
        borderColor: ['rgba(255,255,255,0.15)', 'rgba(255,255,255,0.15)'],
        borderWidth: 2,
        hoverOffset: 6,
      }],
    },
    options: {
      ...CHART_DEFAULTS,
      cutout: '72%',
      plugins: {
        ...CHART_DEFAULTS.plugins,
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed} 次` } },
      },
    },
    plugins: [{
      id: 'centerText',
      afterDraw(chart) {
        const { ctx, chartArea: { width, height, left, top } } = chart;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const cx = left + width / 2;
        const cy = top + height / 2;
        ctx.font = `700 ${Math.round(width * 0.16)}px Inter, sans-serif`;
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.fillText(`${pct}%`, cx, cy - 5);
        ctx.font = `400 ${Math.round(width * 0.08)}px Inter, sans-serif`;
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillText('成功率', cx, cy + Math.round(width * 0.12));
        ctx.restore();
      },
    }],
  });

  legend.innerHTML = [
    ['成功', '#34d399', succ],
    ['失败', '#f87171', fail],
  ].map(([label, color, n]) => `
    <div class="chart-legend-item">
      <div class="chart-legend-dot" style="background:${color}"></div>
      <span>${label} ${n} 次</span>
    </div>
  `).join('');
}

/* ── Top configs horizontal bar ─────────────────────────── */
function renderConfigsChart(history, configs) {
  const canvas = $('chart-configs');
  if (_chartCfg) { _chartCfg.destroy(); _chartCfg = null; }

  const recent = history.slice(0, 50);
  const counts = {};
  recent.forEach(r => {
    const name = r.deploymentName || '未知';
    counts[name] = (counts[name] || 0) + 1;
  });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6);

  if (sorted.length === 0) {
    canvas.parentElement.innerHTML = '<div class="chart-empty">暂无数据</div>';
    return;
  }

  const tickColor = 'rgba(255,255,255,0.55)';

  _chartCfg = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: sorted.map(([n]) => n.length > 20 ? n.slice(0, 20) + '…' : n),
      datasets: [{
        data: sorted.map(([, v]) => v),
        backgroundColor: 'rgba(129,140,248,0.55)',
        borderColor: '#818cf8',
        borderWidth: 1.5,
        borderRadius: 6,
        barPercentage: 0.55,
      }],
    },
    options: {
      ...CHART_DEFAULTS,
      indexAxis: 'y',
      scales: {
        x: {
          beginAtZero: true,
          ticks: { stepSize: 1, font: { size: 11, family: 'Inter' }, color: tickColor },
          grid: { color: 'rgba(255,255,255,0.1)' },
        },
        y: {
          grid: { display: false },
          ticks: { font: { size: 11, family: 'Inter' }, color: 'rgba(255,255,255,0.75)' },
        },
      },
    },
  });
}



// ─────────────────────────────────────────────────────────────
// HISTORY TAB
// ─────────────────────────────────────────────────────────────
async function loadHistory() {
  const list = $('history-list');
  list.innerHTML = '<div class="empty-state" style="border:none;padding:2rem">加载中…</div>';
  const data = await api('/api/history?limit=100');
  renderHistoryList('history-list', data, { compact: false });
}

// Small inline SVG helper for use in onclick-safe HTML (no data-lucide needed)
const SVG = {
  server: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>`,
  file:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>`,
  clock:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  timer:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12"/></svg>`,
  key:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>`,
  lock:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
  folder: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
  target: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`,
};

// Escape a string for safe use inside a single-quoted JS string in an onclick attribute
const jsEsc = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

function renderHistoryList(containerId, records, { compact }) {
  const el = $(containerId);
  if (!records || records.length === 0) {
    el.innerHTML = '<div class="empty-state">暂无部署记录</div>';
    return;
  }

  const labelMap = { success: '成功', failed: '失败', running: '运行中', cancelled: '已取消' };
  const inGlass = el.closest('.glass-card') !== null;

  el.innerHTML = records.map(r => {
    const duration = fmtDuration(r.startedAt, r.finishedAt);
    return `
    <div class="history-item${inGlass ? ' history-item-glass' : ''}">
      <div class="history-status-dot ${r.status}"></div>
      <div class="history-body">
        <div class="history-name">${escHtml(r.deploymentName || '未知配置')}</div>
        <div class="history-meta">
          <span>${SVG.server} ${escHtml(r.serverName || '—')}</span>
          <span>${SVG.file} ${escHtml(r.fileName || '—')}</span>
          <span>${SVG.clock} ${fmtTime(r.startedAt)}</span>
          ${duration ? `<span>${SVG.timer} ${duration}</span>` : ''}
        </div>
      </div>
      <span class="history-badge ${r.status}">${labelMap[r.status] || r.status}</span>
      <button class="history-view-btn${inGlass ? ' history-view-btn-glass' : ''}" onclick="showLogModal('${jsEsc(r.id)}','${jsEsc(r.deploymentName || '')}','${jsEsc(r.status)}','${jsEsc(r.startedAt || '')}','${jsEsc(r.finishedAt || '')}')">查看日志</button>
    </div>`;
  }).join('');
}


async function showLogModal(id, name, status, startedAt, finishedAt) {
  $('log-modal-title').textContent = name || '部署日志';
  const duration = fmtDuration(startedAt, finishedAt);
  $('log-modal-meta').textContent =
    `${fmtTime(startedAt)}${duration ? ' · ' + duration : ''} · ${status === 'success' ? '✅ 成功' : status === 'failed' ? '❌ 失败' : '运行中'}`;
  $('log-modal-output').innerHTML = '<span style="color:var(--text-muted)">加载中…</span>';
  openModal('log-modal');

  try {
    const data = await api(`/api/history/${id}/logs`);
    renderLogs($('log-modal-output'), data.logs || []);
  } catch {
    $('log-modal-output').innerHTML = '<span style="color:var(--danger)">加载失败</span>';
  }
}
window.showLogModal = showLogModal;

// Clear history
$('clear-history-btn').addEventListener('click', () => {
  confirm('确定清空所有部署历史记录？此操作不可撤销。', async () => {
    await fetch('/api/history', { method: 'DELETE' });
    loadHistory();
    // Also refresh home if on home
    if ($('tab-home').classList.contains('active')) loadHome();
  });
});

// ─────────────────────────────────────────────────────────────
// SERVERS TAB
// ─────────────────────────────────────────────────────────────
let _servers = [];

async function loadServers() {
  _servers = await api('/api/servers');
  const list = $('servers-list');
  if (!_servers.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon" style="font-size:2rem;margin-bottom:0.5rem">🖥️</div>暂无服务器，点击右上角 ＋ 新增</div>';
    return;
  }
  list.innerHTML = `<div class="list-glass-grid">${_servers.map(s => `
    <div class="list-glass-item">
      <div class="list-glass-icon">${SVG.server}</div>
      <div class="list-item-body">
        <div class="list-item-name">${escHtml(s.name)}</div>
        <div class="list-item-meta">
          <span>${SVG.server} ${escHtml(s.username)}@${escHtml(s.host)}:${s.port}</span>
          <span>${s.privateKey ? SVG.key + ' 密钥认证' : SVG.lock + ' 密码认证'}</span>
          <span>${SVG.clock} ${fmtTime(s.createdAt)}</span>
        </div>
      </div>
      <div class="list-item-actions">
        <button class="btn btn-secondary btn-sm" onclick="editServer('${jsEsc(s.id)}')">编辑</button>
        <button class="btn btn-danger btn-sm" onclick="deleteServer('${jsEsc(s.id)}','${jsEsc(s.name)}')">删除</button>
      </div>
    </div>
  `).join('')}</div>`;
}

$('add-server-btn').addEventListener('click', () => openServerModal());

function openServerModal(s = null) {
  $('server-modal-title').textContent = s ? '编辑服务器' : '新增服务器';
  $('server-id').value = s?.id || '';
  $('server-name').value = s?.name || '';
  $('server-host').value = s?.host || '';
  $('server-port').value = s?.port || 22;
  $('server-username').value = s?.username || '';
  // Editing: fill masked value so PUT sees '••••••••' and keeps old password
  // New: leave empty for user to type
  const pwEl = $('server-password');
  if (s) {
    pwEl.value = s.password || '';  // will be '••••••••' from API
    pwEl.placeholder = '不修改请保留原样';
  } else {
    pwEl.value = '';
    pwEl.placeholder = '输入 SSH 密码';
  }
  $('test-conn-result').textContent = '';
  openModal('server-modal');
}

window.editServer = id => {
  const s = _servers.find(x => x.id === id);
  if (s) openServerModal(s);
};
window.deleteServer = (id, name) => {
  confirm(`确定删除服务器「${name}」？`, async () => {
    await fetch(`/api/servers/${id}`, { method: 'DELETE' });
    loadServers();
  });
};

// Test connection
$('test-conn-btn').addEventListener('click', async () => {
  const btn = $('test-conn-btn');
  const result = $('test-conn-result');
  btn.disabled = true;
  btn.textContent = '⏳ 测试中…';
  result.textContent = '';

  const serverId = $('server-id').value;
  let body;
  if (serverId) {
    body = { serverId };
  } else {
    body = {
      host: $('server-host').value.trim(),
      port: parseInt($('server-port').value) || 22,
      username: $('server-username').value.trim(),
      password: $('server-password').value,
    };
  }

  try {
    const data = await api('/api/servers/test', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (data.ok) {
      result.style.color = 'var(--success)';
      result.textContent = '✅ ' + data.message;
    } else {
      result.style.color = 'var(--danger)';
      result.textContent = '❌ ' + data.error;
    }
  } catch (e) {
    result.style.color = 'var(--danger)';
    result.textContent = '❌ 请求失败';
  }
  btn.disabled = false;
  btn.textContent = '🔌 测试连通性';
});

$('server-form').addEventListener('submit', async e => {
  e.preventDefault();
  const id = $('server-id').value;
  const body = {
    name: $('server-name').value.trim(),
    host: $('server-host').value.trim(),
    port: parseInt($('server-port').value) || 22,
    username: $('server-username').value.trim(),
    password: $('server-password').value,
  };
  if (id) {
    await fetch(`/api/servers/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } else {
    await fetch('/api/servers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  closeModal('server-modal');
  loadServers();
});


// ─────────────────────────────────────────────────────────────
// DEPLOYMENTS TAB
// ─────────────────────────────────────────────────────────────
let _deployments = [];

async function loadDeployments() {
  [_deployments, _servers] = await Promise.all([api('/api/deployments'), api('/api/servers')]);
  const list = $('deployments-list');
  if (!_deployments.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon" style="font-size:2rem;margin-bottom:0.5rem">📦</div>暂无配置，点击右上角 ＋ 新增</div>';
    return;
  }
  const serverMap = Object.fromEntries(_servers.map(s => [s.id, s.name]));
  const deployTypeLabel = { frontend: '前端项目', binary: '二进制文件' };
  const deployTypeCls   = { frontend: 'badge-frontend', binary: 'badge-binary' };
  list.innerHTML = `<div class="list-glass-grid">${_deployments.map(d => `
    <div class="list-glass-item">
      <div class="list-glass-icon">${SVG.folder}</div>
      <div class="list-item-body">
        <div class="list-item-name">${escHtml(d.name)}</div>
        <div class="list-item-meta">
          <span>${SVG.server} ${escHtml(serverMap[d.serverId] || '未知服务器')}</span>
          <span>${SVG.folder} ${escHtml(d.remoteUploadDir)}</span>
          ${d.targetDir ? `<span>${SVG.target} ${escHtml(d.targetDir)}</span>` : ''}
          ${d.backupEnabled ? `<span>${SVG.file} 备份已开启</span>` : ''}
        </div>
      </div>
      <div class="list-item-actions">
        <span class="list-item-badge ${deployTypeCls[d.deployType] || ''}">${deployTypeLabel[d.deployType] || '未知类型'}</span>
        <button class="btn btn-secondary btn-sm" onclick="editDeployment('${jsEsc(d.id)}')">编辑</button>
        <button class="btn btn-danger btn-sm" onclick="deleteDeployment('${jsEsc(d.id)}','${jsEsc(d.name)}')">删除</button>
      </div>
    </div>
  `).join('')}</div>`;
}

$('add-deployment-btn').addEventListener('click', () => openDeploymentModal());

function setDeployType(type) {
  $('dep-deployType').value = type;
  // Toggle active button
  document.querySelectorAll('#dep-type-toggle .type-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === type);
  });
  // Show/hide sections
  const isBinary = type === 'binary';
  $('dep-fields-binary').classList.toggle('hidden', !isBinary);
  $('dep-fields-frontend').classList.toggle('hidden', isBinary);
  // Update backup label
  $('dep-backup-label').textContent = isBinary ? '备份旧二进制文件' : '部署前备份旧目录';
  $('dep-backupDir-wrap').classList.toggle('hidden', isBinary);
  // Update remote dir hint
  $('dep-remoteUploadDir-hint').textContent = isBinary
    ? '二进制文件上传并放置到此目录'
    : '压缩包上传到此目录，解压后移动到目标目录';
}

// Wire type toggle buttons
document.querySelectorAll('#dep-type-toggle .type-btn').forEach(btn => {
  btn.addEventListener('click', () => setDeployType(btn.dataset.type));
});

async function openDeploymentModal(d = null) {
  if (!_servers.length) _servers = await api('/api/servers');
  $('deployment-modal-title').textContent = d ? '编辑部署配置' : '新增部署配置';
  $('dep-id').value = d?.id || '';
  $('dep-name').value = d?.name || '';
  $('dep-remoteUploadDir').value = d?.remoteUploadDir || '';
  $('dep-innerFolder').value = d?.innerFolder || '';
  $('dep-targetDir').value = d?.targetDir || '';
  $('dep-backupEnabled').checked = d?.backupEnabled !== false;
  $('dep-backupDir').value = d?.backupDir || '';
  $('dep-serviceRestart').value = d?.serviceRestart || '';
  $('dep-preCommands').value = d?.preCommands || '';
  $('dep-postCommands').value = d?.postCommands || '';

  // Set deploy type FIRST so sections are visible before restoring field values
  setDeployType(d?.deployType || 'frontend');
  $('dep-binaryName').value = d?.binaryName || '';

  const sel = $('dep-server');
  sel.innerHTML = '<option value="">-- 选择服务器 --</option>' +
    _servers.map(s => `<option value="${s.id}" ${d?.serverId === s.id ? 'selected' : ''}>${escHtml(s.name)}</option>`).join('');
  openModal('deployment-modal');
}


window.editDeployment = id => {
  const d = _deployments.find(x => x.id === id);
  if (d) openDeploymentModal(d);
};
window.deleteDeployment = (id, name) => {
  confirm(`确定删除配置「${name}」？`, async () => {
    await fetch(`/api/deployments/${id}`, { method: 'DELETE' });
    loadDeployments();
  });
};

$('deployment-form').addEventListener('submit', async e => {
  e.preventDefault();
  const id = $('dep-id').value;
  // Read deployType from the active toggle button (most reliable)
  const deployType = document.querySelector('#dep-type-toggle .type-btn.active')?.dataset.type || 'frontend';
  const body = {
    name: $('dep-name').value.trim(),
    serverId: $('dep-server').value,
    remoteUploadDir: $('dep-remoteUploadDir').value.trim(),
    deployType,
    binaryName: $('dep-binaryName').value.trim(),
    innerFolder: $('dep-innerFolder').value.trim(),
    targetDir: $('dep-targetDir').value.trim(),
    backupEnabled: $('dep-backupEnabled').checked,
    backupDir: $('dep-backupDir').value.trim(),
    serviceRestart: $('dep-serviceRestart').value.trim(),
    preCommands: $('dep-preCommands').value,
    postCommands: $('dep-postCommands').value,
  };
  if (id) {
    await fetch(`/api/deployments/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } else {
    await fetch('/api/deployments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  closeModal('deployment-modal');
  loadDeployments();
});


// ─────────────────────────────────────────────────────────────
// DEPLOY TAB
// ─────────────────────────────────────────────────────────────
let _selectedFile = null;

async function loadDeploySelect() {
  if (!_deployments.length) _deployments = await api('/api/deployments');
  if (!_servers.length) _servers = await api('/api/servers');
  const sel = $('deploy-select');
  const cur = sel.value;
  sel.innerHTML = '<option value="">-- 请选择部署配置 --</option>' +
    _deployments.map(d => `<option value="${d.id}" ${d.id === cur ? 'selected' : ''}>${escHtml(d.name)}</option>`).join('');
  updateDeployBtn();
}

$('deploy-select').addEventListener('change', () => {
  const d = _deployments.find(x => x.id === $('deploy-select').value);
  const preview = $('deploy-config-preview');
  if (!d) { hide(preview); updateDeployBtn(); return; }
  const serverMap = Object.fromEntries(_servers.map(s => [s.id, s.name]));
  const isBinary = d.deployType === 'binary';

  // Adjust file input accept type
  fileInput.accept = isBinary ? '*' : '.zip,.tar.gz,.tgz,.tar.bz2,.tar.xz,.tar';
  $('drop-hint') && ($('drop-hint') || document.querySelector('.drop-hint')).setAttribute && (document.querySelector('.drop-hint').textContent = isBinary
    ? '上传编译好的二进制文件，最大 500MB'
    : '支持 .zip、.tar.gz、.tgz 等压缩包，最大 500MB');

  preview.innerHTML = isBinary ? `
    <div><span class="label">类型：</span><span class="val">⚙️ 后端二进制</span></div>
    <div><span class="label">服务器：</span><span class="val">${escHtml(serverMap[d.serverId] || '—')}</span></div>
    <div><span class="label">目录：</span><span class="val">${escHtml(d.remoteUploadDir)}</span></div>
    <div><span class="label">文件名：</span><span class="val">${escHtml(d.binaryName || '—')}</span></div>
    <div><span class="label">最终路径：</span><span class="val">${escHtml(d.remoteUploadDir.replace(/\/$/, '') + '/' + (d.binaryName || '?'))}</span></div>
    <div><span class="label">备份：</span><span class="val">${d.backupEnabled ? '✅ 开启' : '❌ 关闭'}</span></div>
    ${d.serviceRestart ? `<div><span class="label">重启命令：</span><span class="val">${escHtml(d.serviceRestart)}</span></div>` : ''}
  ` : `
    <div><span class="label">类型：</span><span class="val">🌐 前端项目</span></div>
    <div><span class="label">服务器：</span><span class="val">${escHtml(serverMap[d.serverId] || '—')}</span></div>
    <div><span class="label">上传目录：</span><span class="val">${escHtml(d.remoteUploadDir)}</span></div>
    ${d.innerFolder ? `<div><span class="label">包内目录：</span><span class="val">${escHtml(d.innerFolder)}</span></div>` : ''}
    <div><span class="label">目标目录：</span><span class="val">${escHtml(d.targetDir || '—')}</span></div>
    <div><span class="label">备份：</span><span class="val">${d.backupEnabled ? '✅ 开启' : '❌ 关闭'}</span></div>
    ${d.serviceRestart ? `<div><span class="label">重启命令：</span><span class="val">${escHtml(d.serviceRestart)}</span></div>` : ''}
    ${d.preCommands ? `<div><span class="label">前置命令：</span><span class="val">${escHtml(d.preCommands.split('\n').filter(Boolean).length)} 条</span></div>` : ''}
  `;
  show(preview);
  updateDeployBtn();
});


// Drop zone
const dropZone = $('drop-zone');
const fileInput = $('file-input');

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const f = e.dataTransfer.files[0];
  if (f) setFile(f);
});
fileInput.addEventListener('change', () => { if (fileInput.files[0]) setFile(fileInput.files[0]); });

$('file-clear').addEventListener('click', clearFile);

function setFile(f) {
  _selectedFile = f;
  $('file-name').textContent = f.name;
  $('file-size').textContent = fmtBytes(f.size);
  show($('file-selected'));
  hide(dropZone);
  updateDeployBtn();
}
function clearFile() {
  _selectedFile = null;
  fileInput.value = '';
  hide($('file-selected'));
  show(dropZone);
  updateDeployBtn();
}
function updateDeployBtn() {
  const ready = !!$('deploy-select').value && !!_selectedFile;
  $('deploy-btn').disabled = !ready;
}

// Deploy
let _currentTaskId = null;
let _currentEs     = null;
const cancelBtn = $('cancel-deploy-btn');

cancelBtn.addEventListener('click', async () => {
  if (!_currentTaskId) return;
  cancelBtn.disabled = true;
  cancelBtn.textContent = '取消中…';
  try {
    await fetch(`/api/deploy/${_currentTaskId}/cancel`, { method: 'POST' });
  } catch (e) {
    cancelBtn.disabled = false;
    cancelBtn.textContent = '✕ 取消部署';
  }
});

$('deploy-btn').addEventListener('click', async () => {
  const deploymentId = $('deploy-select').value;
  if (!deploymentId || !_selectedFile) return;

  const btn = $('deploy-btn');
  btn.disabled = true;
  btn.querySelector('.btn-text').textContent = '⏳ 部署中…';

  const panel = $('log-panel');
  const logEl = $('log-output');

  const badge = $('deploy-status-badge');
  logEl.innerHTML = '';
  badge.className = 'status-badge status-running';
  badge.textContent = '运行中';
  cancelBtn.style.display = 'inline-flex';
  cancelBtn.disabled = false;
  cancelBtn.textContent = '✕ 取消部署';
  show(panel);
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const fd = new FormData();
  fd.append('deploymentId', deploymentId);
  fd.append('file', _selectedFile);

  let taskId;
  try {
    const res = await fetch('/api/deploy', { method: 'POST', body: fd });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(text.slice(0, 200) || 'Deploy failed'); }
    if (!res.ok) throw new Error(data.error || 'Deploy failed');
    taskId = data.taskId;
    _currentTaskId = taskId;
  } catch (err) {
    appendLog(logEl, { line: `[ERROR] ${err.message}`, time: new Date().toISOString() });
    badge.className = 'status-badge status-failed';
    badge.textContent = '失败';
    btn.disabled = false;
    btn.querySelector('.btn-text').textContent = '🚀 开始部署';
    cancelBtn.style.display = 'none';
    return;
  }

  // SSE stream
  const es = new EventSource(`/api/deploy/${taskId}/logs`);
  _currentEs = es;
  es.onmessage = ev => {
    const entry = JSON.parse(ev.data);
    appendLog(logEl, entry);
  };
  es.addEventListener('done', ev => {
    es.close();
    _currentEs = null;
    _currentTaskId = null;
    const { status } = JSON.parse(ev.data);
    const statusText = { success: '成功', failed: '失败', cancelled: '已取消' };
    badge.className = `status-badge status-${status}`;
    badge.textContent = statusText[status] || status;
    btn.disabled = false;
    btn.querySelector('.btn-text').textContent = '🚀 开始部署';
    cancelBtn.style.display = 'none';
    // Auto-refresh home stats
    if ($('tab-home').classList.contains('active')) loadHome();
  });
  es.onerror = () => { es.close(); _currentEs = null; };
});


function appendLog(container, entry) {
  const line = entry.line || '';
  const cls = line.startsWith('[CMD]') ? 'cmd'
    : line.startsWith('[OUT]') ? 'out'
    : line.startsWith('[ERR]') ? 'err'
    : line.startsWith('[SUCCESS]') ? 'success'
    : line.startsWith('[UPLOAD]') ? 'upload'
    : 'info';
  const span = document.createElement('span');
  span.className = `log-line ${cls}`;
  const ts = new Date(entry.time).toLocaleTimeString('zh-CN');
  span.textContent = `[${ts}] ${line}`;
  container.appendChild(span);
  container.appendChild(document.createTextNode('\n'));
  container.scrollTop = container.scrollHeight;
}

function renderLogs(container, logs) {
  container.innerHTML = '';
  if (!logs.length) {
    container.textContent = '无日志';
    return;
  }
  logs.forEach(entry => appendLog(container, entry));
}

// ─────────────────────────────────────────────────────────────
// XSS escape
// ─────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────
loadHome();

// Render Lucide SVG icons
if (window.lucide) lucide.createIcons();

