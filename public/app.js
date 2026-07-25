// ─────────────────────────────────────────────────────────────────────────────
// CORRIENTES WEB (interno) — homologa las pantallas de la app móvil para uso
// del founder desde el propio VPS, mientras no tiene celular disponible.
// Consume la MISMA API que la app — sin cambios de backend.
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = 'http://localhost:4082/api';
const MANUAL_URL = 'http://localhost:4082/downloads/manual-corrientes.html';
const TERMS_URL  = 'http://localhost:4082/downloads/terminos-condiciones.html';
const RULES_URL  = 'http://localhost:4082/downloads/reglas-reordenamiento.html';

// Contenido de curso por nivel — prueba: solo nivel 1 tiene material real por ahora.
const COURSE_CONTENT_URL = {
  1: 'http://localhost:4082/downloads/curso-nivel-1.html',
};

// ── Almacenamiento de tokens (localStorage — esto es un panel de escritorio,
// no hace falta Keychain) ────────────────────────────────────────────────────
const tokenStore = {
  getAccess:  () => localStorage.getItem('cor_access'),
  getRefresh: () => localStorage.getItem('cor_refresh'),
  set: (a, r) => { localStorage.setItem('cor_access', a); localStorage.setItem('cor_refresh', r); },
  clear: () => { localStorage.removeItem('cor_access'); localStorage.removeItem('cor_refresh'); },
};

let currentUser = null;
let unreadCount = 0;
let currentBanner = null;
let bannerDismissedId = null;

// ── Banner dinámico (mantenimiento/avisos) — mismo endpoint que la app móvil.
// Se revisa cada 60s para que los cambios se vean sin recargar la página.
const BANNER_STYLE = {
  info:        { bg: 'var(--info-light)',    border: 'var(--info)' },
  warning:     { bg: 'var(--warning-light)', border: 'var(--warning)' },
  maintenance: { bg: 'var(--error-light)',   border: 'var(--error)' },
};
async function refreshBanner() {
  try { currentBanner = await apiJson('/app-info/banner'); } catch { currentBanner = null; }
  renderBannerSlot();
}
function renderBannerSlot() {
  const slot = document.getElementById('banner-slot');
  if (!slot) return;
  if (!currentBanner || !currentBanner.enabled || !currentBanner.message || currentBanner.id === bannerDismissedId) {
    slot.innerHTML = '';
    return;
  }
  const s = BANNER_STYLE[currentBanner.type] ?? BANNER_STYLE.info;
  slot.innerHTML = `
    <div style="display:flex; align-items:flex-start; gap:8px; padding:10px 16px; background:${s.bg}; border-bottom:1px solid ${s.border};">
      <span>${currentBanner.type === 'maintenance' ? '🛠️' : currentBanner.type === 'warning' ? '⚠️' : 'ℹ️'}</span>
      <span style="flex:1; font-size:13px;">${esc(currentBanner.message)}</span>
      <span style="cursor:pointer; color:var(--gray300); font-weight:700;" id="bannerCloseBtn">✕</span>
    </div>
  `;
  document.getElementById('bannerCloseBtn').onclick = () => { bannerDismissedId = currentBanner.id; renderBannerSlot(); };
}

// ── Cliente API ───────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const token = tokenStore.getAccess();
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (opts.body instanceof FormData) delete headers['Content-Type'];

  let res = await fetch(API_BASE + path, { ...opts, headers });

  if (res.status === 401 && tokenStore.getRefresh() && !opts._retry) {
    const refreshed = await tryRefresh();
    if (refreshed) return api(path, { ...opts, _retry: true });
  }
  return res;
}

async function apiJson(path, opts = {}) {
  const res = await api(path, opts);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw { status: res.status, message: data?.message || 'Error de red', data };
  return data;
}

// Renderiza un comprobante (imagen o PDF) desde una respuesta de fetch cruda.
// Antes esto siempre se metía en un <img>, que no puede mostrar PDFs — quedaba
// como ícono roto sin ningún mensaje, aunque la descarga hubiera funcionado bien.
async function renderEvidenceResponse(container, res) {
  if (!res.ok) {
    let msg = 'No se pudo cargar el comprobante';
    try { msg = (await res.json())?.message || msg; } catch {}
    container.innerHTML = `<div class="alert error">${esc(msg)}</div>`;
    return;
  }
  const contentType = res.headers.get('content-type') || '';
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  if (contentType.startsWith('image/')) {
    container.innerHTML = `<img src="${url}" style="width:100%; max-height:320px; object-fit:contain; border-radius:10px; margin-top:8px;" />`;
  } else if (contentType === 'application/pdf') {
    container.innerHTML = `
      <embed src="${url}" type="application/pdf" style="width:100%; height:420px; border-radius:10px; margin-top:8px; border:1px solid var(--gray100);" />
      <a href="${url}" target="_blank" rel="noopener" style="display:inline-block; margin-top:6px; font-size:13px;">↗ Abrir PDF en una pestaña nueva</a>
    `;
  } else {
    container.innerHTML = `<a href="${url}" target="_blank" rel="noopener" class="btn small secondary" style="margin-top:8px;">⬇️ Descargar comprobante</a>`;
  }
}

async function tryRefresh() {
  try {
    const res = await fetch(API_BASE + '/auth/refresh', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokenStore.getRefresh() }),
    });
    if (!res.ok) throw new Error('refresh failed');
    const data = await res.json();
    tokenStore.set(data.accessToken, data.refreshToken);
    return true;
  } catch {
    tokenStore.clear();
    return false;
  }
}

// ── Formatters ────────────────────────────────────────────────────────────
const fmtUSD = n => `$${Number(n ?? 0).toFixed(2)} USD`;
const fmtDate = d => d ? new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtDateTime = d => d ? new Date(d).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const fmtDays = n => n === null || n === undefined ? '—' : n <= 0 ? 'vencido' : `${n} día${n === 1 ? '' : 's'}`;

const PAYMENT_BADGE = { pending: ['Pendiente', 'gray'], evidence_uploaded: ['⏳ Revisión', 'yellow'], confirmed: ['✓ Pagado', 'green'], rejected: ['✗ Rechazado', 'red'] };
const LIST_STATUS_BADGE = { active: ['Activa', 'blue'], completed: ['✓ Completada', 'green'], pending_confirmation: ['⏳ Confirmando', 'yellow'] };

function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }

// ── Router ────────────────────────────────────────────────────────────────
const ROUTES = [
  { path: 'dashboard',    label: 'Inicio',         emoji: '🏠', render: renderDashboard },
  { path: 'mylist',       label: 'Mi Lista',       emoji: '📋', render: renderMyList },
  { path: 'payments',     label: 'Pagos',          emoji: '💳', render: renderPayments },
  { path: 'academy',      label: 'Academia',       emoji: '📚', render: renderAcademy },
  { path: 'invitations',  label: 'Invitaciones',   emoji: '🔗', render: renderInvitations },
  { path: 'history',      label: 'Historial',      emoji: '📜', render: renderHistory },
  { path: 'notifications',label: 'Notificaciones', emoji: '🔔', render: renderNotifications },
  { path: 'more',         label: 'Más',            emoji: '☰', render: renderMore },
];

function currentRoute() { return (location.hash.replace('#/', '') || 'dashboard').split('?')[0]; }

async function navigate() {
  if (!currentUser) { renderLogin(); return; }
  renderShell();
  const route = ROUTES.find(r => r.path === currentRoute()) || ROUTES[0];
  document.querySelectorAll('#sidenav a').forEach(a => a.classList.toggle('active', a.dataset.path === route.path));
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading">Cargando…</div>';
  try {
    await route.render(content);
  } catch (err) {
    content.innerHTML = `<div class="alert error">Error: ${esc(err.message || 'algo salió mal')}</div>`;
  }
  refreshUnreadBadge();
}

window.addEventListener('hashchange', navigate);

// ── Shell (topbar + sidenav) ──────────────────────────────────────────────
function renderShell() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div id="banner-slot"></div>
    <div id="topbar">
      <div class="logo">C</div>
      <div class="brand">Corrientes</div>
      <span class="badge-local">uso interno · localhost</span>
      <div class="spacer"></div>
      <span class="user-chip">${esc(currentUser.fullName)} ${currentUser.role === 'admin' ? '· <b>admin</b>' : ''}</span>
      <button class="btn ghost small" id="logoutBtn">Salir</button>
    </div>
    <div id="layout">
      <nav id="sidenav">
        ${ROUTES.map(r => `
          <a href="#/${r.path}" data-path="${r.path}">
            <span class="emoji">${r.emoji}</span> ${r.label}
            ${r.path === 'notifications' ? `<span class="dot" id="navUnreadDot" style="display:none">0</span>` : ''}
          </a>
        `).join('')}
      </nav>
      <div id="content"></div>
    </div>
  `;
  document.getElementById('logoutBtn').onclick = logout;
  renderBannerSlot();
}

async function refreshUnreadBadge() {
  try {
    const { count } = await apiJson('/notifications/unread-count');
    unreadCount = count;
    const dot = document.getElementById('navUnreadDot');
    if (dot) { dot.style.display = count > 0 ? 'flex' : 'none'; dot.textContent = count > 9 ? '9+' : count; }
  } catch { /* silencioso */ }
}

// ── Login ─────────────────────────────────────────────────────────────────
function renderLogin() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div id="banner-slot"></div>
    <div id="login-screen">
      <div class="box card">
        <div class="logo-big">C</div>
        <h1 class="page-title" style="text-align:center">Corrientes</h1>
        <p class="page-sub" style="text-align:center">Panel web interno — solo accesible desde este VPS</p>
        <div id="loginError"></div>
        <label class="field-label">Email</label>
        <input id="loginEmail" type="email" placeholder="tu@email.com" />
        <label class="field-label">Contraseña</label>
        <input id="loginPassword" type="password" placeholder="••••••••" />
        <button class="btn" id="loginBtn" style="width:100%">Ingresar</button>
      </div>
    </div>
  `;
  document.getElementById('loginBtn').onclick = doLogin;
  document.getElementById('loginPassword').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  renderBannerSlot();
}

async function doLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errBox = document.getElementById('loginError');
  errBox.innerHTML = '';
  try {
    const data = await apiJson('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    tokenStore.set(data.accessToken, data.refreshToken);
    currentUser = data.user;
    location.hash = '#/dashboard';
    navigate();
  } catch (err) {
    errBox.innerHTML = `<div class="alert error">${esc(err.message || 'Credenciales incorrectas')}</div>`;
  }
}

async function logout() {
  try { await apiJson('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken: tokenStore.getRefresh() }) }); } catch {}
  tokenStore.clear();
  currentUser = null;
  location.hash = '';
  renderLogin();
}

// ── Dashboard ─────────────────────────────────────────────────────────────
const LEVEL_AMOUNTS = { 1: 25, 2: 50, 3: 100, 4: 200, 5: 400, 6: 800, 7: 1600 };

async function renderDashboard(content) {
  let myList = null;
  try { myList = await apiJson('/lists/my'); } catch {}
  const members = myList?.members ?? [];
  const me = members.find(m => m.isCurrentUser);
  const isLeader = me?.position === 1;

  content.innerHTML = `
    <h1 class="page-title">Hola, ${esc(currentUser.fullName.split(' ')[0])} 👋</h1>
    <p class="page-sub">Nivel ${currentUser.currentLevel} · ${currentUser.recycleTickets} tickets</p>

    <div class="stats-grid">
      <div class="card stat-card"><div class="stat-emoji">💰</div><div class="stat-value">${fmtUSD(currentUser.totalEarnedUsd)}</div><div class="stat-label">Ganancias</div></div>
      <div class="card stat-card"><div class="stat-emoji">🏆</div><div class="stat-value">Nivel ${currentUser.currentLevel}</div><div class="stat-label">$${LEVEL_AMOUNTS[currentUser.currentLevel] ?? '—'} por pago</div></div>
      <div class="card stat-card"><div class="stat-emoji">📍</div><div class="stat-value">${me ? 'Pos. ' + me.position : 'Sin lista'}</div><div class="stat-label">${isLeader ? 'Eres el líder ⭐' : 'Tu posición'}</div></div>
      <div class="card stat-card"><div class="stat-emoji">🎟️</div><div class="stat-value">${currentUser.recycleTickets}</div><div class="stat-label">Tickets</div></div>
    </div>

    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <strong>Mi Lista Actual</strong>
        <a href="#/mylist" class="btn small secondary">Ver todo →</a>
      </div>
      ${members.length === 0 ? `<div class="empty">Sin lista activa</div>` : members.map(m => `
        <div class="member-row ${m.isCurrentUser ? 'me' : ''}">
          <div class="pos-num ${m.position === 1 ? 'leader' : ''}">${m.position === 1 ? '★' : m.position}</div>
          ${m.isEmpty ? `<span style="color:var(--gray200); font-style:italic;">Vacío</span>` :
            `<div class="member-info"><span class="member-alias">${esc(m.alias)}</span> ${m.isCurrentUser ? '<span class="badge green">TÚ</span>' : ''}</div>
             <span class="badge ${PAYMENT_BADGE[m.paymentStatus]?.[1] ?? 'gray'}">${PAYMENT_BADGE[m.paymentStatus]?.[0] ?? m.paymentStatus}</span>`}
        </div>
      `).join('')}
    </div>
  `;
}

// ── Mi Lista ──────────────────────────────────────────────────────────────
async function renderMyList(content) {
  let myList = null;
  try { myList = await apiJson('/lists/my'); } catch {}

  if (!myList) {
    content.innerHTML = `
      <h1 class="page-title">Mi Lista</h1>
      <div class="card empty">
        <span class="emoji">📋</span>
        <p>Sin lista activa</p>
        <button class="btn" id="joinBtn">🔄 Unirme a una lista de nivel 1</button>
      </div>`;
    document.getElementById('joinBtn').onclick = async () => {
      try { await apiJson('/lists/join', { method: 'POST', body: JSON.stringify({ level: 1 }) }); navigate(); }
      catch (err) { alert(err.message); }
    };
    return;
  }

  const members = myList.members;
  const me = members.find(m => m.isCurrentUser);
  const isLeader = me?.position === 1;
  const allPaid = members.every(m => m.isEmpty || m.paymentStatus === 'confirmed');

  let pendingTxs = [];
  if (isLeader) { try { pendingTxs = await apiJson(`/transactions/pending/${myList.id}`); } catch {} }

  let paymentInfo = null;
  if (me && me.position >= 4 && me.paymentStatus === 'pending') {
    try { paymentInfo = await apiJson(`/transactions/payment-info/${myList.id}`); } catch {}
  }

  let activeDisputes = [];
  let myOpenDispute = null;
  try { activeDisputes = await apiJson(`/disputes/list/${myList.id}/active`); } catch {}
  try { myOpenDispute = await apiJson(`/disputes/list/${myList.id}/mine`); } catch {}

  const rejectionHistoryHtml = (history) => !history?.length ? '' : `
    <div style="font-size:12px; color:var(--gray300); margin:6px 0;">
      <b>Historial de rechazos (${history.length}):</b>
      ${history.map((h, i) => `<div>#${i + 1} — ${esc(h.reason || 'sin motivo')} <span style="color:var(--gray200);">(${fmtDateTime(h.createdAt)})</span></div>`).join('')}
    </div>
  `;

  content.innerHTML = `
    <h1 class="page-title">Mi Lista</h1>
    <p class="page-sub">Nivel ${myList.level} · ${fmtUSD(myList.amountPerPayment)} por posición · ${myList.courseName}</p>

    ${(isLeader || (me && me.position >= 4)) ? `
      <button class="btn secondary" id="chatEntryBtn" style="width:100%; margin-bottom:14px;">
        ${isLeader ? '💬 Mensajes de mi lista' : '💬 Chatear con el líder'}
      </button>
    ` : ''}

    ${myOpenDispute ? `
      <div class="card" style="border-color:var(--gray300);">
        <div class="section-label">📋 Tu disputa (en revisión)</div>
        <p style="font-size:13px; color:var(--gray400); margin:0 0 6px;">
          Abriste una disputa por tu pago rechazado — esto es solo informativo, no podés votar tu propio caso.
        </p>
        <p style="font-size:12px; color:var(--primary); font-weight:700; margin:0 0 6px;">
          ${myOpenDispute.status === 'voting' ? `${myOpenDispute.votesCast}/${myOpenDispute.quorumRequired} votos hasta ahora` : 'Escalada al admin — sin votantes suficientes en tu lista'}
        </p>
        ${rejectionHistoryHtml(myOpenDispute.rejectionHistory)}
        <button class="btn small secondary chat-dispute-btn" data-id="${myOpenDispute.id}" style="margin-top:8px;">💬 Chat de la disputa</button>
      </div>
    ` : ''}

    ${activeDisputes.map(d => `
      <div class="card accent">
        <div class="section-label">⚖️ Disputa de pago en tu lista</div>
        <p style="font-size:13px; color:var(--gray400); margin:0 0 8px;">
          ${d.triggerReason === 'rejection'
            ? 'Un pago fue rechazado 2 veces seguidas y el pagador lo disputó. Revisá el comprobante y votá si te parece válido.'
            : 'El líder no confirmó ni rechazó este pago en 24 horas y el pagador lo disputó. Revisá el comprobante y votá si te parece válido.'}
        </p>
        <p style="font-size:12px; color:var(--primary); font-weight:700; margin:0 0 10px;">
          ${d.votesCast}/${d.quorumRequired} votos necesarios · vence dentro de 48h desde que se abrió
        </p>
        <p style="font-size:12.5px; margin:0 0 8px;">
          Cuenta Airtm registrada del líder: <code>${esc(d.leaderAirtmAccount || '—')}</code>
          — comparala con la que aparece dentro del comprobante.
        </p>
        ${rejectionHistoryHtml(d.rejectionHistory)}
        <a href="#" class="mylist-dispute-evidence-link" data-id="${d.id}" style="font-size:13px;">▶ Ver comprobante</a>
        <div class="mylist-dispute-evidence-box" data-for="${d.id}"></div>
        ${d.myVote ? `
          <div class="alert success" style="margin-top:10px;">✓ Ya votaste: ${d.myVote === 'confirm' ? 'confirmar el pago' : 'mantener el rechazo'}</div>
        ` : `
          <div style="display:flex; gap:8px; margin-top:10px;">
            <button class="btn small mylist-vote-btn" data-id="${d.id}" data-vote="confirm" style="flex:1;">✅ Confirmar pago</button>
            <button class="btn small danger mylist-vote-btn" data-id="${d.id}" data-vote="reject" style="flex:1;">❌ Mantener rechazo</button>
          </div>
        `}
        <div class="mylist-vote-msg" data-for="${d.id}"></div>
        <button class="btn small secondary chat-dispute-btn" data-id="${d.id}" style="margin-top:8px;">💬 Chat de la disputa</button>
      </div>
    `).join('')}

    ${members.map(m => `
      <div class="member-row ${m.isCurrentUser ? 'me' : ''}">
        <div class="pos-num ${m.position === 1 ? 'leader' : ''}">${m.position === 1 ? '★' : m.position}</div>
        ${m.isEmpty ? `<span style="color:var(--gray200); font-style:italic; flex:1;">Vacío</span>` : `
          <div class="member-info">
            <span class="member-alias">${esc(m.alias)}</span> ${m.isCurrentUser ? '<span class="badge green">TÚ</span>' : ''}
            <div style="font-size:11px; color:var(--gray300);">${m.invitationStatus === 'cumplió' ? '✓ Invitación cumplida' : m.invitationStatus === 'penalizado' ? '✗ Penalizado' : '○ Invitación pendiente'}</div>
          </div>
          <span class="badge ${PAYMENT_BADGE[m.paymentStatus]?.[1] ?? 'gray'}">${PAYMENT_BADGE[m.paymentStatus]?.[0] ?? m.paymentStatus}</span>
        `}
      </div>
    `).join('')}

    ${paymentInfo ? `
      <div class="card accent">
        <div class="section-label">💳 Datos de tu pago</div>
        <table>
          <tr><td>Cuenta Airtm</td><td><b>${esc(paymentInfo.leaderAirtmAccount)}</b></td></tr>
          <tr><td>Monto</td><td><b style="color:var(--primary)">${fmtUSD(paymentInfo.amountUsd)}</b></td></tr>
          <tr><td>Referencia</td><td><code>${esc(paymentInfo.referenceCode)}</code></td></tr>
        </table>
        <div class="section-label">Subir comprobante</div>
        <label class="field-label">ID de transacción Airtm</label>
        <input id="airtmTxId" placeholder="ID de la transacción" />
        <label class="field-label">Archivo (imagen o PDF, máx 5MB)</label>
        <input id="evidenceFile" type="file" accept="image/*,.pdf" />
        <button class="btn" id="uploadBtn">Subir evidencia</button>
        <div id="uploadMsg"></div>
      </div>
    ` : ''}

    ${me && me.position >= 4 && me.invitationStatus !== 'cumplió' && currentUser.recycleTickets > 0 ? `
      <div class="card" style="background:var(--accent-light);">
        <div class="section-label" style="color:var(--accent);">🎟️ Tenés ${currentUser.recycleTickets} ticket${currentUser.recycleTickets === 1 ? '' : 's'} de reciclaje</div>
        <p style="font-size:13px; color:var(--gray400); margin:0 0 10px;">
          Usalo para asegurar que cumpliste el requisito de invitación en esta lista, sin importar si invitaste a alguien todavía.
        </p>
        <button class="btn secondary small" id="useTicketBtn">Usar 1 ticket acá</button>
        <div id="ticketMsg"></div>
      </div>
    ` : ''}

    ${isLeader && pendingTxs.length > 0 ? `
      <div class="card">
        <div class="section-label">📎 Evidencias por revisar (${pendingTxs.length})</div>
        ${pendingTxs.map(tx => `
          <div style="border-top:1px solid var(--gray100); padding-top:10px; margin-top:10px;">
            <div style="font-size:12px; color:var(--gray300);">ID Airtm: ${esc(tx.airtmTransactionId)} · ${fmtUSD(tx.amountUsd)}</div>
            <div class="evidence-box" data-tx="${tx.id}">Cargando comprobante…</div>
            <div style="display:flex; gap:8px; margin-top:8px;">
              <button class="btn small" onclick="confirmTx('${tx.id}')">✓ Confirmar</button>
              <button class="btn small danger" onclick="rejectTx('${tx.id}')">✗ Rechazar</button>
            </div>
          </div>
        `).join('')}
      </div>
    ` : ''}

    ${isLeader && myList.status === 'active' ? `
      <div class="card">
        ${allPaid
          ? `<button class="btn" id="completeBtn" style="width:100%">🎉 Completar lista y subir de nivel</button>`
          : `<p style="text-align:center; color:var(--gray300); margin:0;">Faltan ${members.filter(m => !m.isEmpty && m.paymentStatus !== 'confirmed').length} pago(s) por confirmar</p>`}
      </div>
    ` : ''}
  `;

  if (paymentInfo) {
    document.getElementById('uploadBtn').onclick = () => uploadEvidence(myList.id);
  }
  const useTicketBtn = document.getElementById('useTicketBtn');
  if (useTicketBtn) {
    useTicketBtn.onclick = async () => {
      const msg = document.getElementById('ticketMsg');
      try {
        const res = await apiJson(`/lists/${myList.id}/use-recycle-ticket`, { method: 'POST' });
        currentUser = await apiJson('/auth/me'); // refresca el conteo de tickets
        msg.innerHTML = `<div class="alert success">${esc(res.message)}</div>`;
        setTimeout(navigate, 1200);
      } catch (err) {
        msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
      }
    };
  }
  if (isLeader && myList.status === 'active' && allPaid) {
    document.getElementById('completeBtn').onclick = async () => {
      try { await apiJson(`/lists/${myList.id}/complete`, { method: 'POST' }); navigate(); }
      catch (err) { alert(err.message); }
    };
  }
  document.querySelectorAll('.mylist-dispute-evidence-link').forEach(link => {
    link.onclick = async (e) => {
      e.preventDefault();
      const id = link.dataset.id;
      const box = document.querySelector(`.mylist-dispute-evidence-box[data-for="${id}"]`);
      if (box.innerHTML) { box.innerHTML = ''; link.textContent = '▶ Ver comprobante'; return; }
      try {
        const res = await api(`/disputes/${id}/evidence`);
        await renderEvidenceResponse(box, res);
        link.textContent = '▼ Ocultar comprobante';
      } catch { box.innerHTML = `<div class="alert error">No se pudo cargar el comprobante</div>`; }
    };
  });
  document.querySelectorAll('.mylist-vote-btn').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      const msg = document.querySelector(`.mylist-vote-msg[data-for="${id}"]`);
      try {
        await apiJson(`/disputes/${id}/vote`, { method: 'POST', body: JSON.stringify({ vote: btn.dataset.vote }) });
        msg.innerHTML = `<div class="alert success">Voto registrado — gracias por participar.</div>`;
        setTimeout(navigate, 1200);
      } catch (err) { msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`; }
    };
  });
  // Entradas del chat
  const chatEntryBtn = document.getElementById('chatEntryBtn');
  if (chatEntryBtn) {
    chatEntryBtn.onclick = () => isLeader
      ? openLeaderInbox(myList.id)
      : openChatDm({ listId: myList.id, title: 'Chat con el líder' });
  }
  document.querySelectorAll('.chat-dispute-btn').forEach(btn => {
    btn.onclick = () => openChatDispute(btn.dataset.id);
  });

  // Cargar comprobantes autenticados (imagen o PDF; blob, no se puede poner el token en <img src>)
  document.querySelectorAll('.evidence-box').forEach(async box => {
    try {
      const res = await api(`/transactions/${box.dataset.tx}/evidence`);
      await renderEvidenceResponse(box, res);
    } catch { box.innerHTML = `<div class="alert error">No se pudo cargar el comprobante</div>`; }
  });
}

async function uploadEvidence(listId) {
  const fileInput = document.getElementById('evidenceFile');
  const txId = document.getElementById('airtmTxId').value.trim();
  const msg = document.getElementById('uploadMsg');
  if (!fileInput.files[0] || !txId) { msg.innerHTML = `<div class="alert error">Completá el ID y elegí un archivo</div>`; return; }
  const fd = new FormData();
  fd.append('listId', listId);
  fd.append('airtmTransactionId', txId);
  fd.append('file', fileInput.files[0]);
  try {
    await apiJson('/transactions/upload-evidence', { method: 'POST', body: fd });
    msg.innerHTML = `<div class="alert success">Evidencia subida — esperá la confirmación del líder</div>`;
    setTimeout(navigate, 1200);
  } catch (err) { msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`; }
}

window.confirmTx = async (id) => {
  try { await apiJson(`/transactions/${id}/confirm`, { method: 'POST', body: JSON.stringify({}) }); navigate(); }
  catch (err) { alert(err.message); }
};
window.rejectTx = async (id) => {
  const reason = prompt('Motivo del rechazo:');
  if (!reason) return;
  try { await apiJson(`/transactions/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }); navigate(); }
  catch (err) { alert(err.message); }
};

// ── Chat (coordinación de pagos + disputa) ─────────────────────────────────
// Mismos endpoints que la app móvil. Enfoque REST + polling (refresca el hilo
// cada 6s mientras el modal está abierto).
const chatApi = {
  sendLeaderDm: (listId, body, toUserId) =>
    apiJson(`/chat/lists/${listId}/leader-dm/messages`, { method: 'POST', body: JSON.stringify(toUserId ? { body, toUserId } : { body }) }),
  getConversations: (listId) => apiJson(`/chat/lists/${listId}/leader-dm/conversations`),
  getThread: (listId, otherUserId) => apiJson(`/chat/lists/${listId}/leader-dm/thread/${otherUserId}`),
  sendDispute: (disputeId, body) => apiJson(`/chat/disputes/${disputeId}/messages`, { method: 'POST', body: JSON.stringify({ body }) }),
  getDisputeThread: (disputeId) => apiJson(`/chat/disputes/${disputeId}/messages`),
};

function chatOverlay(title, subtitle) {
  const ov = document.createElement('div');
  ov.className = 'chat-overlay';
  ov.innerHTML = `
    <div class="chat-modal">
      <div class="chat-head">
        <div><div class="chat-title">${esc(title)}</div><div class="chat-sub">${esc(subtitle || '')}</div></div>
        <span class="chat-close">✕</span>
      </div>
      <div class="chat-messages"><div class="loading">Cargando…</div></div>
      <div class="chat-input-bar">
        <textarea class="chat-input" placeholder="Escribe un mensaje…" maxlength="1000"></textarea>
        <button class="btn chat-send" title="Enviar">➤</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  return ov;
}

// Modal de conversación genérico (sirve para leader_dm y disputa).
function openConversationModal({ title, subtitle, fetchThread, sendMessage }) {
  const ov = chatOverlay(title, subtitle);
  const msgsEl = ov.querySelector('.chat-messages');
  const input = ov.querySelector('.chat-input');
  const sendBtn = ov.querySelector('.chat-send');
  let closed = false;

  const renderMsgs = (msgs) => {
    if (!msgs.length) { msgsEl.innerHTML = `<div class="chat-empty">Sin mensajes aún. Escribí para empezar.</div>`; return; }
    const atBottom = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 80;
    msgsEl.innerHTML = msgs.map(m => `
      <div class="chat-row ${m.isMine ? 'mine' : 'other'}">
        <div class="chat-bubble ${m.isMine ? 'mine' : 'other'}">
          ${m.isMine ? '' : `<div class="chat-sender">${esc(m.senderLabel)}</div>`}
          <div class="chat-body">${esc(m.body)}</div>
          <div class="chat-time">${fmtDateTime(m.createdAt)}</div>
        </div>
      </div>`).join('');
    if (atBottom) msgsEl.scrollTop = msgsEl.scrollHeight;
  };

  const load = async () => {
    try { const msgs = await fetchThread(); if (!closed) renderMsgs(msgs); }
    catch (err) { if (!closed) msgsEl.innerHTML = `<div class="alert error">${esc(err.message || 'No se pudo cargar')}</div>`; }
  };

  const doSend = async () => {
    const body = input.value.trim();
    if (!body) return;
    sendBtn.disabled = true;
    try { await sendMessage(body); input.value = ''; await load(); msgsEl.scrollTop = msgsEl.scrollHeight; }
    catch (err) { alert(err.message || 'No se pudo enviar'); }
    finally { sendBtn.disabled = false; }
  };
  sendBtn.onclick = doSend;
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); } });

  const timer = setInterval(load, 6000);
  const close = () => { closed = true; clearInterval(timer); ov.remove(); refreshUnreadBadge(); };
  ov.querySelector('.chat-close').onclick = close;
  ov.addEventListener('click', e => { if (e.target === ov) close(); });

  load();
}

// Chat 1-a-1 con el líder. Si no viene otherUserId (caso pagador), lo resuelve
// vía la bandeja (el backend devuelve al líder aunque no haya mensajes aún).
async function openChatDm({ listId, otherUserId, title }) {
  if (!otherUserId) {
    try { const convs = await chatApi.getConversations(listId); otherUserId = convs[0]?.otherUserId; } catch {}
    if (!otherUserId) { alert('No se pudo abrir el chat con el líder.'); return; }
  }
  openConversationModal({
    title: title || 'Chat con el líder',
    subtitle: 'Coordinación de pago',
    fetchThread: () => chatApi.getThread(listId, otherUserId),
    sendMessage: (body) => chatApi.sendLeaderDm(listId, body, otherUserId),
  });
}

function openChatDispute(disputeId) {
  openConversationModal({
    title: 'Chat de la disputa',
    subtitle: 'Todos los miembros de la lista',
    fetchThread: () => chatApi.getDisputeThread(disputeId),
    sendMessage: (body) => chatApi.sendDispute(disputeId, body),
  });
}

// Bandeja del líder: una conversación por pagador (pos 4-7).
function openLeaderInbox(listId) {
  const ov = chatOverlay('Mensajes de mi lista', 'Coordinación de pagos');
  const msgsEl = ov.querySelector('.chat-messages');
  ov.querySelector('.chat-input-bar').style.display = 'none';

  const timer = setInterval(load, 8000);
  const close = () => { clearInterval(timer); ov.remove(); refreshUnreadBadge(); };
  ov.querySelector('.chat-close').onclick = close;
  ov.addEventListener('click', e => { if (e.target === ov) close(); });

  async function load() {
    try {
      const convs = await chatApi.getConversations(listId);
      if (!convs.length) { msgsEl.innerHTML = `<div class="chat-empty">Todavía no hay conversaciones con tus pagadores.</div>`; return; }
      msgsEl.innerHTML = convs.map(c => `
        <div class="chat-conv" data-other="${c.otherUserId}" data-label="${esc(c.otherLabel)}">
          <div class="chat-conv-avatar">${esc((c.otherLabel || '').replace('USR-', '').slice(0, 3))}</div>
          <div class="chat-conv-body">
            <div class="chat-conv-label">${esc(c.otherLabel)}</div>
            <div class="chat-conv-last">${esc(c.lastMessage || 'Sin mensajes aún')}</div>
          </div>
          ${c.unreadCount > 0 ? `<span class="chat-conv-badge">${c.unreadCount > 9 ? '9+' : c.unreadCount}</span>` : ''}
        </div>`).join('');
      msgsEl.querySelectorAll('.chat-conv').forEach(el => {
        el.onclick = () => { close(); openChatDm({ listId, otherUserId: el.dataset.other, title: el.dataset.label }); };
      });
    } catch (err) { msgsEl.innerHTML = `<div class="alert error">${esc(err.message || 'Error')}</div>`; }
  }
  load();
}

// ── Pagos (mis transacciones) ─────────────────────────────────────────────
async function renderPayments(content) {
  const [txs, myList] = await Promise.all([
    apiJson('/transactions/my'),
    apiJson('/lists/my').catch(() => null),
  ]);
  let eligibility = null;
  if (myList) { try { eligibility = await apiJson(`/disputes/eligibility/${myList.id}`); } catch {} }
  const latestActionableTx = txs.find(t => t.status === 'rejected' || t.status === 'evidence_uploaded');

  content.innerHTML = `
    <h1 class="page-title">Pagos</h1>
    <p class="page-sub">${txs.length} transacción${txs.length === 1 ? '' : 'es'}</p>
    ${txs.length === 0 ? `<div class="card empty"><span class="emoji">💳</span><p>Sin transacciones aún</p></div>` : `
      <div class="card">
        <table>
          <thead><tr><th>Fecha</th><th>Nivel</th><th>Monto</th><th>Estado</th><th>Ref. Airtm</th></tr></thead>
          <tbody>
            ${txs.map(tx => `
              <tr>
                <td>${fmtDateTime(tx.createdAt)}</td>
                <td>N${tx.level}</td>
                <td>${fmtUSD(tx.amountUsd)}</td>
                <td><span class="badge ${PAYMENT_BADGE[tx.status]?.[1] ?? 'gray'}">${PAYMENT_BADGE[tx.status]?.[0] ?? tx.status}</span></td>
                <td><code>${esc(tx.airtmTransactionId || '—')}</code></td>
              </tr>
              ${tx.status === 'rejected' && tx.rejectionReason ? `<tr><td colspan="5" style="color:var(--error); font-size:12px;">Motivo: ${esc(tx.rejectionReason)}</td></tr>` : ''}
              ${eligibility?.canDispute && eligibility.transactionId === tx.id ? `
                <tr><td colspan="5">
                  <button class="btn small secondary" id="disputeBtn" style="margin-top:4px;">
                    ${tx.status === 'rejected' ? '⚖️ Disputar rechazo' : '⚖️ Disputar (líder sin responder)'}
                  </button>
                  <div id="disputeMsg"></div>
                </td></tr>
              ` : ''}
              ${eligibility?.disputeLimitReached && latestActionableTx?.id === tx.id ? `
                <tr><td colspan="5" style="color:var(--gray300); font-size:12px;">
                  Ya usaste tu única disputa disponible para esta posición.
                </td></tr>
              ` : ''}
            `).join('')}
          </tbody>
        </table>
      </div>
    `}
  `;

  const disputeBtn = document.getElementById('disputeBtn');
  if (disputeBtn) {
    disputeBtn.onclick = async () => {
      const msg = document.getElementById('disputeMsg');
      try {
        const dispute = await apiJson('/disputes', { method: 'POST', body: JSON.stringify({ transactionId: eligibility.transactionId }) });
        msg.innerHTML = dispute.status === 'voting'
          ? `<div class="alert success">⚖️ Disputa abierta — los demás integrantes de tu lista fueron notificados, tenés respuesta dentro de 48h.</div>`
          : `<div class="alert success">🚨 Tu lista no tiene suficientes integrantes para votar — un admin va a revisar tu caso directamente.</div>`;
        setTimeout(navigate, 1800);
      } catch (err) {
        msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
      }
    };
  }
}

// ── Academia ──────────────────────────────────────────────────────────────
async function renderAcademy(content) {
  const courses = await apiJson('/courses/my-academy');
  content.innerHTML = `
    <h1 class="page-title">Mi Academia</h1>
    <p class="page-sub">${courses.length} curso${courses.length === 1 ? '' : 's'} desbloqueado${courses.length === 1 ? '' : 's'}</p>
    ${courses.length === 0 ? `<div class="card empty"><span class="emoji">📚</span><p>Confirmá tu primer pago para desbloquear el curso del nivel 1</p></div>` :
      courses.map(c => `
        <div class="card ${c.isCompleted ? 'accent' : ''}">
          <div style="display:flex; gap:12px; align-items:flex-start;">
            <div class="pos-num leader" style="width:40px;height:40px;border-radius:12px;background:var(--primary);color:white;">N${c.level}</div>
            <div style="flex:1;">
              <div style="font-weight:700;">${esc(c.title)}</div>
              <div style="font-size:12px; color:var(--gray300);">Desbloqueado ${fmtDate(c.grantedAt)}</div>
            </div>
            ${c.isCompleted ? '<span style="font-size:20px; color:var(--primary);">✓</span>' : ''}
          </div>
          <div style="display:flex; align-items:center; gap:8px; margin:10px 0;">
            <div style="flex:1; height:6px; background:var(--gray100); border-radius:3px; overflow:hidden;">
              <div style="height:100%; width:${c.progressPercentage}%; background:var(--primary);"></div>
            </div>
            <span style="font-size:12px; font-weight:700; color:var(--primary);">${c.progressPercentage}%</span>
          </div>
          ${!c.isCompleted ? `
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              ${[25, 50, 75, 100].filter(p => p > c.progressPercentage).map(p => `<button class="btn small secondary" onclick="bumpProgress('${c.courseId}', ${p})">→ ${p}%</button>`).join('')}
            </div>
          ` : `<div style="font-size:13px; color:var(--success);">🎉 Completado el ${fmtDate(c.completedAt)}</div>`}
          ${COURSE_CONTENT_URL[c.level] ? `
            <a href="${COURSE_CONTENT_URL[c.level]}" target="_blank" rel="noopener" class="btn small secondary" style="display:inline-block; margin-top:10px; text-decoration:none;">📖 Ver contenido del curso</a>
          ` : `<div style="font-size:12px; color:var(--gray300); margin-top:10px; font-style:italic;">Contenido en preparación</div>`}
        </div>
      `).join('')}
  `;
}
window.bumpProgress = async (id, pct) => {
  try { await apiJson(`/courses/${id}/progress`, { method: 'POST', body: JSON.stringify({ percentage: pct }) }); navigate(); }
  catch (err) { alert(err.message); }
};

// ── Invitaciones ──────────────────────────────────────────────────────────
async function renderInvitations(content) {
  const [link, stats, mine] = await Promise.all([
    apiJson('/invitations/link'), apiJson('/invitations/stats'), apiJson('/invitations/my'),
  ]);
  content.innerHTML = `
    <h1 class="page-title">Mis Invitaciones</h1>
    <div class="card">
      <div class="section-label">Tu código de invitación</div>
      <div class="link-row">
        <input readonly value="${esc(link.referralCode)}" />
        <input readonly value="${esc(link.link)}" />
      </div>
    </div>
    <div class="stats-grid" style="grid-template-columns:repeat(3,1fr);">
      <div class="card stat-card"><div class="stat-emoji">👥</div><div class="stat-value">${stats.totalInvited}</div><div class="stat-label">Invitados</div></div>
      <div class="card stat-card"><div class="stat-emoji">✅</div><div class="stat-value">${stats.registered}</div><div class="stat-label">Registrados</div></div>
      <div class="card stat-card"><div class="stat-emoji">🟢</div><div class="stat-value">${stats.active}</div><div class="stat-label">Activos</div></div>
    </div>
    ${stats.currentList ? `
      <div class="card ${stats.currentList.hasMetRequirement ? 'accent' : ''}">
        <div style="font-weight:700;">${stats.currentList.hasMetRequirement ? '✅ Requisito de invitación cumplido' : '⏰ Pendiente: invita 1 persona'}</div>
        <div style="font-size:13px; color:var(--gray300);">${stats.currentList.hasMetRequirement ? 'Ya tenés al menos 1 invitado con pago confirmado' : `Te quedan ${fmtDays(stats.currentList.daysRemaining)}`}</div>
      </div>
    ` : ''}
    <div class="card">
      <div class="section-label">Historial de invitados (${mine.length})</div>
      ${mine.length === 0 ? '<div class="empty">Aún no invitaste a nadie</div>' : `
        <table>
          <thead><tr><th>Alias</th><th>Estado</th><th>Nivel</th><th>Registrado</th></tr></thead>
          <tbody>${mine.map(i => `<tr><td>${esc(i.invitedAlias)}</td><td>${esc(i.status)}</td><td>N${i.level}</td><td>${fmtDate(i.registeredAt)}</td></tr>`).join('')}</tbody>
        </table>
      `}
    </div>
  `;
}

// ── Historial de listas ───────────────────────────────────────────────────
async function renderHistory(content) {
  const entries = await apiJson('/lists/history');
  content.innerHTML = `
    <h1 class="page-title">Historial de listas</h1>
    ${entries.length === 0 ? `<div class="card empty"><span class="emoji">📜</span><p>Sin historial aún</p></div>` :
      entries.map(e => `
        <div class="card">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div><b>N${e.level}</b> — ${esc(e.courseName)}</div>
            <span class="badge ${LIST_STATUS_BADGE[e.status]?.[1] ?? 'gray'}">${LIST_STATUS_BADGE[e.status]?.[0] ?? e.status}</span>
          </div>
          <div style="font-size:12px; color:var(--gray300); margin-top:6px;">
            Iniciada ${fmtDate(e.joinedAt)} · Posición ${e.position === 1 ? '★ Líder' : '#' + e.position} · ${fmtUSD(e.amountPerPayment)}/posición
          </div>
        </div>
      `).join('')}
  `;
}

// ── Notificaciones ────────────────────────────────────────────────────────
async function renderNotifications(content) {
  const notifs = await apiJson('/notifications');
  content.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <h1 class="page-title">Notificaciones</h1>
      ${notifs.some(n => !n.isRead) ? `<button class="btn small secondary" id="markAllBtn">Leer todo</button>` : ''}
    </div>
    ${notifs.length === 0 ? `<div class="card empty"><span class="emoji">🔔</span><p>Sin notificaciones</p></div>` :
      notifs.map(n => `
        <div class="card" style="${!n.isRead ? 'border-color:rgba(0,200,150,0.4); background:var(--primary-light);' : ''} cursor:pointer;" onclick="markRead('${n.id}')">
          <div style="display:flex; justify-content:space-between;">
            <b>${esc(n.title)}</b>
            <span style="font-size:11px; color:var(--gray300);">${fmtDateTime(n.createdAt)}</span>
          </div>
          <div style="font-size:13px; color:var(--gray400); margin-top:4px;">${esc(n.message)}</div>
        </div>
      `).join('')}
  `;
  if (notifs.some(n => !n.isRead)) {
    document.getElementById('markAllBtn').onclick = async () => { await apiJson('/notifications/read-all', { method: 'POST' }); navigate(); };
  }
}
window.markRead = async (id) => {
  try { await apiJson(`/notifications/${id}/read`, { method: 'POST' }); navigate(); } catch {}
};

// ── Más (perfil, admin, links) ────────────────────────────────────────────
async function renderMore(content) {
  let adminData = null;
  let escalatedDisputes = [];
  if (currentUser.role === 'admin') {
    try { adminData = await apiJson('/admin/dashboard'); } catch {}
    try { escalatedDisputes = await apiJson('/admin/disputes?status=escalated_admin'); } catch {}
  }

  content.innerHTML = `
    <h1 class="page-title">Más</h1>
    <div class="card">
      <div style="font-weight:700; font-size:16px;">${esc(currentUser.fullName)}</div>
      <div style="color:var(--gray300); font-size:13px;">${esc(currentUser.email)}</div>
      <span class="badge purple">Nivel ${currentUser.currentLevel}</span> ${currentUser.role === 'admin' ? '<span class="badge purple">Admin</span>' : ''}
    </div>

    <div class="card">
      <div class="section-label">Recuperación de cuenta</div>
      <button class="btn secondary small" id="regenBtn">🔑 Regenerar código de recuperación</button>
      <div id="regenResult"></div>
    </div>

    <div class="card">
      <div class="section-label">Documentación</div>
      <a class="btn ghost small" href="${MANUAL_URL}" target="_blank">📖 Manual de usuario</a>
      &nbsp;
      <a class="btn ghost small" href="${TERMS_URL}" target="_blank">📜 Términos y condiciones</a>
      &nbsp;
      <a class="btn ghost small" href="${RULES_URL}" target="_blank">🔀 Cómo funciona el negocio</a>
    </div>

    ${adminData ? `
      <div class="card accent">
        <div class="section-label">Panel Admin — métricas globales</div>
        <div class="stats-grid" style="grid-template-columns:repeat(3,1fr);">
          <div class="stat-card"><div class="stat-value">${adminData.users.total}</div><div class="stat-label">Usuarios</div></div>
          <div class="stat-card"><div class="stat-value">${adminData.lists.active}</div><div class="stat-label">Listas activas</div></div>
          <div class="stat-card"><div class="stat-value">${fmtUSD(adminData.payments.totalUsd)}</div><div class="stat-label">Total procesado</div></div>
        </div>
        <div class="stats-grid" style="grid-template-columns:repeat(2,1fr); margin-top:8px;">
          <div class="stat-card"><div class="stat-value">${adminData.disputes.inVoting}</div><div class="stat-label">Disputas en votación</div></div>
          <div class="stat-card"><div class="stat-value">${adminData.disputes.needsAdmin}</div><div class="stat-label">Requieren tu revisión</div></div>
        </div>
      </div>
    ` : ''}

    ${escalatedDisputes.length > 0 ? `
      <div class="card" style="border-color:var(--error);">
        <div class="section-label" style="color:var(--error);">🚨 Disputas que requieren tu revisión (${escalatedDisputes.length})</div>
        ${escalatedDisputes.map(d => `
          <div style="border-top:1px solid var(--gray100); padding:10px 0;">
            <div style="font-size:13px; margin-bottom:6px;">
              Disputa <code>${d.id.slice(0, 8)}</code> · abierta ${fmtDateTime(d.openedAt)}
              ${d.eligibleVotersCount < 3 ? ' · <span style="color:var(--gray300);">sin votantes suficientes</span>' : ' · venció el plazo de votación'}
            </div>
            <div style="font-size:12.5px; margin-bottom:6px;">
              <b>Motivo:</b> ${d.triggerReason === 'no_response'
                ? 'el líder no confirmó ni rechazó en 24 horas'
                : '2 rechazos seguidos del líder'}
            </div>
            <table style="font-size:13px; margin-bottom:8px;">
              <tr><td>Pagador</td><td><b>${esc(d.payerName || '—')}</b></td></tr>
              <tr><td>Líder</td><td><b>${esc(d.leaderName || '—')}</b></td></tr>
              <tr><td>Monto</td><td><b>${d.amountUsd != null ? fmtUSD(d.amountUsd) : '—'}</b></td></tr>
              <tr><td>ID Airtm ingresado por el pagador</td><td><code>${esc(d.airtmTransactionId || '—')}</code></td></tr>
              <tr><td>Cuenta Airtm <u>registrada</u> del líder</td><td><code>${esc(d.leaderAirtmAccount || '—')}</code></td></tr>
            </table>
            <div class="callout" style="background:var(--warning-light,#FFFBEB); border-left:3px solid var(--warning,#F59E0B); padding:8px 12px; font-size:12.5px; margin-bottom:8px;">
              Comparar la cuenta de arriba con la que aparece <b>dentro</b> del comprobante — deben coincidir.
            </div>
            ${d.rejectionHistory?.length ? `
              <div style="font-size:12px; color:var(--gray300); margin-bottom:8px;">
                <b>Historial de rechazos del líder (${d.rejectionHistory.length}):</b>
                ${d.rejectionHistory.map((h, i) => `<div>#${i + 1} — ${esc(h.reason || 'sin motivo')} <span style="color:var(--gray200);">(${fmtDateTime(h.createdAt)})</span></div>`).join('')}
              </div>
            ` : ''}
            <a href="#" class="dispute-evidence-link" data-id="${d.id}" style="font-size:13px;">▶ Ver comprobante</a>
            <div class="dispute-evidence-box" data-for="${d.id}"></div>
            <textarea class="dispute-note" data-id="${d.id}" placeholder="Nota (opcional)" style="width:100%; margin-top:8px; min-height:50px;"></textarea>
            <div style="display:flex; gap:8px; margin-top:6px;">
              <button class="btn small dispute-resolve-btn" data-id="${d.id}" data-resolution="confirmed" style="flex:1;">✅ Confirmar pago</button>
              <button class="btn small danger dispute-resolve-btn" data-id="${d.id}" data-resolution="rejected" style="flex:1;">❌ Mantener rechazo</button>
            </div>
            <div class="dispute-resolve-msg" data-for="${d.id}"></div>
          </div>
        `).join('')}
      </div>
    ` : ''}

    <button class="btn danger" id="logoutBtn2">Cerrar sesión</button>
  `;
  document.getElementById('logoutBtn2').onclick = logout;
  document.getElementById('regenBtn').onclick = async () => {
    try {
      const r = await apiJson('/auth/recovery-code/regenerate', { method: 'POST' });
      document.getElementById('regenResult').innerHTML = `<div class="alert success">Nuevo código: <code>${esc(r.recoveryCode)}</code> — guardalo, no se vuelve a mostrar.</div>`;
    } catch (err) { document.getElementById('regenResult').innerHTML = `<div class="alert error">${esc(err.message)}</div>`; }
  };

  document.querySelectorAll('.dispute-evidence-link').forEach(link => {
    link.onclick = async (e) => {
      e.preventDefault();
      const id = link.dataset.id;
      const box = document.querySelector(`.dispute-evidence-box[data-for="${id}"]`);
      if (box.innerHTML) { box.innerHTML = ''; link.textContent = '▶ Ver comprobante'; return; }
      try {
        const res = await api(`/disputes/${id}/evidence`);
        await renderEvidenceResponse(box, res);
        link.textContent = '▼ Ocultar comprobante';
      } catch { box.innerHTML = `<div class="alert error">No se pudo cargar el comprobante</div>`; }
    };
  });
  document.querySelectorAll('.dispute-resolve-btn').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      const resolution = btn.dataset.resolution;
      const note = document.querySelector(`.dispute-note[data-id="${id}"]`)?.value || undefined;
      const msg = document.querySelector(`.dispute-resolve-msg[data-for="${id}"]`);
      try {
        await apiJson(`/admin/disputes/${id}/resolve`, { method: 'POST', body: JSON.stringify({ resolution, note }) });
        msg.innerHTML = `<div class="alert success">Disputa resuelta.</div>`;
        setTimeout(navigate, 1200);
      } catch (err) { msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`; }
    };
  });
}

// ── Init ──────────────────────────────────────────────────────────────────
async function init() {
  const token = tokenStore.getAccess();
  if (token) {
    try { currentUser = await apiJson('/auth/me'); } catch { tokenStore.clear(); }
  }
  navigate();
  refreshBanner();
  setInterval(refreshBanner, 60_000);
}
init();
