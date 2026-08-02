// Admin Panel - Melhora App Live
// URL base: mesma origem do servidor (túnel/domínio único garante API + painel juntos)
const ADMIN_ROUTE = window.__ADMIN_ROUTE || window.location.pathname.replace(/\/$/, '');
const ADMIN_API = (window.__VITE_API_URL || window.location.origin) + ADMIN_ROUTE + '/api';

async function api(path, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json', ...opts.headers },
      credentials: 'include',
      ...opts,
      signal: ctrl.signal
    });
    clearTimeout(timer);
    // Validação estrita: só aceita JSON (nunca HTML/texto puro)
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const text = await res.text();
      throw new Error('API retornou ' + contentType + ' em ' + res.url + ': ' + text.substring(0, 100));
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro');
    return data;
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === 'AbortError') throw new Error('Servidor demorou para responder (timeout)');
    throw err;
  }
}

async function adminLogin() {
  const username = document.getElementById('loginUser').value;
  const password = document.getElementById('loginPass').value;
  document.getElementById('loginError').textContent = '';
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    if (data.user && (data.user.role === 'admin' || data.user.role === 'moderator')) {
      document.getElementById('loginScreen').classList.add('hidden');
      document.getElementById('adminPanel').classList.remove('hidden');
      applyRoleUI(data.user.role);
      loadDashboard();
    } else {
      document.getElementById('loginError').textContent = '❌ Acesso negado - sem permissão administrativa';
    }
  } catch (e) {
    document.getElementById('loginError').textContent = '❌ ' + e.message;
  }
}

function adminLogout() {
  fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('adminPanel').classList.add('hidden');
}

function showTab(tab) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.admin-nav .nav-btn').forEach(el => el.classList.remove('active'));
  document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.remove('hidden');
  document.querySelector(`.admin-nav .nav-btn[onclick*="'${tab}'"]`)?.classList.add('active');
  
  if (tab === 'dashboard') loadDashboard();
  if (tab === 'users') loadUsers(1);
  if (tab === 'tickets') loadTickets();
  if (tab === 'lives') loadLives();
  if (tab === 'families') loadFamilies();
  if (tab === 'security') loadSecurity();
  if (tab === 'content') loadPosts();
  if (tab === 'appeals') loadAppeals();
  if (tab === 'reports') loadReports();
  if (tab === 'chatReports') loadChatReports();
  if (tab === 'withdrawals') loadWithdrawals();
  if (tab === 'economy') loadEconomy();
  if (tab === 'agencies') loadAgencies();
  if (tab === 'alerts') loadAlerts();
  if (tab === 'vibeguard') loadVibeGuard();
}

// Esconde ferramentas só-de-admin para moderadores
function applyRoleUI(role) {
  const isAdmin = role === 'admin';
  document.querySelectorAll('.admin-only').forEach(el => {
    if (isAdmin) el.classList.remove('hidden');
    else el.classList.add('hidden');
  });
}
applyRoleUI(window.__ADMIN_ROLE || 'admin');

// ============================================================
// DENÚNCIAS + HISTÓRICO DE MODERAÇÃO
// ============================================================
async function loadReports(status) {
  try {
    const [rep, log] = await Promise.all([
      api(ADMIN_API + '/reports' + (status ? '?status=' + status : '')),
      api(ADMIN_API + '/moderation-logs')
    ]);
    const reports = rep.reports || [];
    const counts = rep.counts || {};
    const dupAlert = reports.some(r => Number(r.duplicate_count) >= 3)
      ? '<div style="background:#ff6b6b22;border:1px solid #ff6b6b55;color:#ff9d9d;padding:10px 14px;border-radius:10px;margin-bottom:12px;font-size:13px">⚠️ Existem alvos com múltiplas denúncias pendentes — verifique campanhas de denúncia em massa antes de punir.</div>'
      : '';
    const filter = `
      <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
        <button class="btn-sm${!status || status === 'pending' ? ' btn-success' : ''}" onclick="loadReports('pending')">🕒 Pendentes (${counts.pending || 0})</button>
        <button class="btn-sm" onclick="loadReports('accepted')">✅ Confirmadas (${counts.accepted || 0})</button>
        <button class="btn-sm" onclick="loadReports('rejected')">✕ Rejeitadas (${counts.rejected || 0})</button>
        <button class="btn-sm" onclick="loadReports('all')">🗂️ Todas</button>
      </div>`;
    document.getElementById('reportsContainer').innerHTML = dupAlert + filter + (reports.length
      ? `<div style="overflow-x:auto"><table>
          <tr><th>Denunciante</th><th>Denunciado</th><th>Motivo</th><th>Detalhes / Prova</th><th>Status</th><th>Data</th><th>Ações</th></tr>
          ${reports.map(r => `<tr>
            <td>${escapeHtml(r.reporter_username || '?')}</td>
            <td>${escapeHtml(r.reported_username || '—')}</td>
            <td style="max-width:200px;word-break:break-word">${escapeHtml(String(r.report_reason || '').substring(0, 80))}${Number(r.duplicate_count) >= 2 ? ' <span style="color:#ff6b6b;font-weight:700">(x' + r.duplicate_count + ')</span>' : ''}</td>
            <td style="max-width:260px;word-break:break-word">
              ${escapeHtml(String(r.description || '').substring(0, 120))}
              ${r.evidence_url ? `<br><a href="${escapeHtml(r.evidence_url)}" target="_blank" rel="noopener" style="color:#9db8ff;font-size:12px">🔗 ver prova</a>` : ''}
            </td>
            <td>${escapeHtml(r.status)}</td>
            <td style="white-space:nowrap;font-size:12px">${escapeHtml(String(r.created_at || '').slice(0, 16))}</td>
            <td style="white-space:nowrap">
              <button class="btn-sm btn-success" onclick="reviewReport('${r.id}','accept')">✓</button>
              <button class="btn-sm btn-warning" onclick="reviewReport('${r.id}','reject')">✕</button>
              <button class="btn-sm" onclick="reviewReport('${r.id}','analyzing')">🔍</button>
            </td>
          </tr>`).join('')}
        </table></div>`
      : '<p style="color:#6b6b80;padding:20px">Nenhuma denúncia</p>');
    loadModerationLogs(log);
  } catch (e) {
    document.getElementById('reportsContainer').innerHTML = '<p style="color:#ff4757;padding:20px">Erro: ' + escapeHtml(e.message) + '</p>';
  }
}

async function reviewReport(id, action) {
  const notes = prompt(action === 'accept' ? 'Motivo da confirmação (opcional):' : 'Observação (opcional):');
  try {
    const data = await api(ADMIN_API + '/reports/' + id + '/review', {
      method: 'POST',
      body: JSON.stringify({ action, notes: notes || '' })
    });
    alert('✅ ' + (data.message || 'Denúncia atualizada'));
    loadReports();
  } catch (e) { alert('❌ ' + e.message); }
}

function loadModerationLogs(log) {
  try {
    const logs = (log && log.logs) || [];
    document.getElementById('moderationLogsContainer').innerHTML = logs.length
      ? `<table>
          <tr><th>Ação</th><th>Usuário</th><th>Motivo</th><th>Por</th><th>Data</th></tr>
          ${logs.map(m => `<tr>
            <td>${escapeHtml(m.action_type)}</td>
            <td>${escapeHtml(m.target_username || m.target_user_id ? String(m.target_username || m.target_user_id).substring(0, 16) : '—')}</td>
            <td style="max-width:260px;word-break:break-word">${escapeHtml(String(m.reason || '').substring(0, 120))}</td>
            <td>${escapeHtml(m.moderator_username || m.moderated_by || 'sistema')}</td>
            <td>${escapeHtml(m.created_at || '')}</td>
          </tr>`).join('')}
        </table>`
      : '<p style="color:#6b6b80;padding:20px">Nenhuma ação registrada</p>';
  } catch (e) {
    document.getElementById('moderationLogsContainer').innerHTML = '<p style="color:#ff4757;padding:20px">Erro: ' + escapeHtml(e.message) + '</p>';
  }
}

// ============================================================
// MODERAÇÃO DE CONTEÚDO
// ============================================================
async function loadPosts() {
  const status = document.getElementById('postFilter')?.value || 'review';
  try {
    const data = await api(ADMIN_API + '/posts?status=' + status);
    const posts = data.posts || [];
    document.getElementById('postsContainer').innerHTML = posts.length
      ? `<table>
          <tr><th>Autor</th><th>Texto</th><th>Status</th><th>Ações</th></tr>
          ${posts.map(p => `<tr>
            <td>${p.display_name || p.username || '?'}</td>
            <td style="max-width:320px;word-break:break-word">${escapeHtml(String(p.text || '').substring(0, 80))}${p.media_url ? ' 📎' : ''}</td>
            <td>${p.status}</td>
            <td>
              ${p.status !== 'approved' ? `<button class="btn-sm btn-success" onclick="reviewPost('${p.id}','approve')">✓ Aprovar</button>` : ''}
              ${p.status !== 'blocked' ? `<button class="btn-sm btn-danger" onclick="reviewPost('${p.id}','block')">✕ Bloquear</button>` : ''}
            </td>
          </tr>`).join('')}
        </table>`
      : '<p style="color:#6b6b80;padding:20px">Nenhuma publicação com esse status</p>';
  } catch (e) {
    document.getElementById('postsContainer').innerHTML = '<p style="color:#ff4757;padding:20px">Erro: ' + escapeHtml(e.message) + '</p>';
  }
}

async function reviewPost(id, action) {
  const reason = action === 'block' ? (prompt('Motivo do bloqueio:') || 'Violação das regras da plataforma') : '';
  try {
    await api(ADMIN_API + '/posts/' + id + '/review', { method: 'POST', body: JSON.stringify({ action, reason }) });
    alert(action === 'approve' ? '✅ Publicação aprovada' : '🚫 Publicação bloqueada');
    loadPosts();
  } catch (e) { alert('❌ ' + e.message); }
}

// ============================================================
// RECURSOS DE BANIMENTO
// ============================================================
async function loadAppeals() {
  try {
    const data = await api(ADMIN_API + '/appeals');
    const appeals = data.appeals || [];
    document.getElementById('appealsContainer').innerHTML = appeals.length
      ? `<table>
          <tr><th>Usuário</th><th>Motivo do recurso</th><th>Status</th><th>Ações</th></tr>
          ${appeals.map(a => `<tr>
            <td>${a.display_name || a.username || '?'} <small style="color:#6b6b80">@${a.username}</small></td>
            <td style="max-width:320px;word-break:break-word">${escapeHtml(String(a.reason || '').substring(0, 120))}</td>
            <td>${a.status}</td>
            <td>
              ${a.status === 'pendente' ? `<button class="btn-sm btn-success" onclick="reviewAppeal('${a.id}','approve')">✓ Aceitar</button>
              <button class="btn-sm btn-danger" onclick="reviewAppeal('${a.id}','reject')">✕ Negar</button>` : `<small style="color:#6b6b80">${escapeHtml(a.admin_response || '')}</small>`}
            </td>
          </tr>`).join('')}
        </table>`
      : '<p style="color:#6b6b80;padding:20px">Nenhum recurso</p>';
  } catch (e) {
    document.getElementById('appealsContainer').innerHTML = '<p style="color:#ff4757;padding:20px">Erro: ' + escapeHtml(e.message) + '</p>';
  }
}

async function reviewAppeal(id, action) {
  const response = prompt(action === 'approve' ? 'Resposta ao usuário (opcional):' : 'Motivo da negação:');
  try {
    await api(ADMIN_API + '/appeals/' + id + '/review', { method: 'POST', body: JSON.stringify({ action, response: response || '' }) });
    alert(action === 'approve' ? '✅ Recurso aceito — conta reativada' : '❌ Recurso negado');
    loadAppeals();
  } catch (e) { alert('❌ ' + e.message); }
}

// ============================================================
// DENÚNCIAS DE CONVERSA
// ============================================================
async function loadChatReports() {
  try {
    const data = await api(ADMIN_API + '/chat-reports');
    const reports = data.reports || [];
    document.getElementById('chatReportsContainer').innerHTML = reports.length
      ? `<table>
          <tr><th>Denunciante</th><th>Conversa</th><th>Motivo</th><th>Status</th><th>Ações</th></tr>
          ${reports.map(r => `<tr>
            <td>${r.reporter_username || '?'}</td>
            <td>${String(r.chat_id).substring(0, 8)}…</td>
            <td style="max-width:300px;word-break:break-word">${escapeHtml(String(r.reason || '').substring(0, 100))}</td>
            <td>${r.status}</td>
            <td>
              <button class="btn-sm btn-success" onclick="reviewChatReport('${r.id}','analisado')">✓ Analisado</button>
              <button class="btn-sm btn-warning" onclick="reviewChatReport('${r.id}','rejeitado')">✕ Rejeitar</button>
            </td>
          </tr>`).join('')}
        </table>`
      : '<p style="color:#6b6b80;padding:20px">Nenhuma denúncia de conversa</p>';
  } catch (e) {
    document.getElementById('chatReportsContainer').innerHTML = '<p style="color:#ff4757;padding:20px">Erro: ' + escapeHtml(e.message) + '</p>';
  }
}

async function reviewChatReport(id, status) {
  const response = prompt('Observação (opcional):');
  try {
    await api(ADMIN_API + '/chat-reports/' + id + '/review', { method: 'POST', body: JSON.stringify({ status, response: response || '' }) });
    loadChatReports();
  } catch (e) { alert('❌ ' + e.message); }
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function loadDashboard() {
  try {
    const data = await api(ADMIN_API + '/dashboard');
    const stats = data.stats;
    const labels = {
      totalUsers: 'Usuários', activeUsers: 'Usuários ativos', activeLives: 'Lives ao vivo', totalFamilies: 'Famílias',
      openTickets: 'Tickets abertos', totalLives: 'Lives totais', bannedUsers: 'Banidos', pendingPosts: 'Posts p/ revisão',
      pendingReports: 'Denúncias', pendingAppeals: 'Recursos', pendingChatReports: 'Denúncias chat', pendingWithdrawals: 'Saques PIX',
      agencies: 'Agências', creators: 'Criadores', totalViews: 'Views', todayLogins: 'Logins hoje', openAlerts: 'Alertas'
    };
    document.getElementById('statsContainer').innerHTML = Object.entries(stats).map(([k, v]) =>
      `<div class="stat-card"><div class="num">${v}</div><div class="label">${labels[k] || k.replace(/([A-Z])/g, ' $1')}</div></div>`
    ).join('');
    document.getElementById('pendingTickets').innerHTML = buildTicketTable(data.pendingTickets);
    document.getElementById('recentLives').innerHTML = buildLiveTable(data.recentLives);
    const recentPosts = document.getElementById('recentPosts');
    if (recentPosts) {
      recentPosts.innerHTML = (data.recentPosts || []).length ? (data.recentPosts || []).map(p =>
        `<tr><td>${p.username || '?'}</td><td>${(p.text || '').slice(0, 40)}</td><td>${p.status}</td><td>${p.created_at || ''}</td></tr>`
      ).join('') : '<tr><td colspan="4">Nenhuma publicação</td></tr>';
    }
    const alertsBox = document.getElementById('dashAlerts');
    if (alertsBox) {
      alertsBox.innerHTML = (data.alerts || []).length ? (data.alerts || []).map(a =>
        `<div style="padding:8px;border-bottom:1px solid var(--border);font-size:13px">🔔 ${escapeHtml(a.message)} <small style="color:#888">(${a.created_at})</small></div>`
      ).join('') : '<p style="color:#6b6b80;padding:10px">Sem alertas recentes</p>';
    }
  } catch (e) {
    document.getElementById('statsContainer').innerHTML = '<p style="color:#ff4757;padding:20px">Erro ao carregar dashboard: ' + escapeHtml(e.message) + '</p>';
  }
}

async function loadUsers(page) {
  const search = document.getElementById('userSearch')?.value || '';
  try {
    const data = await api(ADMIN_API + '/users?page=' + page + '&limit=20&search=' + encodeURIComponent(search));
    document.getElementById('usersContainer').innerHTML = buildUserTable(data.users);
    const pages = data.pagination?.totalPages || 1;
    document.getElementById('usersPagination').innerHTML = Array.from({length: Math.min(pages, 10)}, (_, i) =>
      `<button class="btn-sm" onclick="loadUsers(${i+1})" style="${i+1===page?'background:var(--primary);color:#fff;border-color:var(--primary)':'border:1px solid var(--border);background:var(--bg3)'}">${i+1}</button>`
    ).join('');
  } catch (e) {
    document.getElementById('usersContainer').innerHTML = '<p style="color:#ff4757;padding:20px">Erro: ' + e.message + '</p>';
  }
}

async function loadTickets() {
  try {
    const data = await api(ADMIN_API + '/tickets');
    document.getElementById('ticketsContainer').innerHTML = (data.tickets || []).length ? (data.tickets || []).map(t => `
      <div class="ticket-card" style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between">
          <strong>${t.subject}</strong>
          <span style="color:${t.status === 'resolvido' ? '#10b981' : t.status === 'em_andamento' ? '#f59e0b' : '#6C5CEV'};font-size:12px">${t.status || 'aberto'}</span>
        </div>
        <div style="font-size:12px;color:#888;margin:4px 0">${t.username} - ${t.created_at || ''}</div>
        <p style="font-size:13px;margin:4px 0">${t.description}</p>
        ${t.response ? `<div style="background:var(--bg3);padding:8px;border-radius:6px;margin-top:8px;font-size:13px"><strong>Resposta:</strong> ${t.response}</div>` : ''}
        <div style="margin-top:8px">
          <button class="btn-sm btn-success" onclick="respondTicket('${t.id}')">Responder</button>
        </div>
      </div>
    `).join('') : '<p style="color:#6b6b80;padding:20px">Nenhum ticket encontrado</p>';
  } catch (e) {
    document.getElementById('ticketsContainer').innerHTML = '<p style="color:#ff4757;padding:20px">Erro: ' + e.message + '</p>';
  }
}

async function respondTicket(id) {
  const response = prompt('Resposta do admin:');
  if (!response) return;
  try {
    await api(ADMIN_API + '/tickets/' + id + '/respond', {
      method: 'POST',
      body: JSON.stringify({ response, status: 'resolvido' })
    });
    alert('✅ Ticket respondido!');
    loadTickets();
  } catch (e) { alert('❌ ' + e.message); }
}

async function loadLives() {
  try {
    const data = await api(ADMIN_API + '/lives');
    document.getElementById('livesContainerMain').innerHTML = buildLiveTable(data.lives);
  } catch (e) {
    document.getElementById('livesContainerMain').innerHTML = '<p style="color:#ff4757">Erro</p>';
  }
}

async function loadFamilies() {
  try {
    const data = await api(ADMIN_API + '/families');
    document.getElementById('familiesContainer').innerHTML = buildFamilyTable(data.families);
  } catch (e) {
    document.getElementById('familiesContainer').innerHTML = '<p style="color:#ff4757">Erro</p>';
  }
}

async function loadChildBans() {
  try {
    const data = await api(ADMIN_API + '/security/child-bans');
    const list = data.denuncias || [];
    document.getElementById('childBansContainer').innerHTML = list.length ? `
      <div style="font-size:12px;color:#ff4757;margin-bottom:8px;font-weight:700">${list.length} denúncia(s) grave(s) em análise</div>
      <table>
        <tr><th>Autor</th><th>Vítima</th><th>Conteúdo</th><th>Prova</th><th>IP / Dispositivo</th><th>Data</th><th>Status</th></tr>
        ${list.map(d => `<tr style="background:rgba(255,71,87,.06)">
          <td>${escapeHtml(d.autor || '-')}</td><td>${escapeHtml(d.vitima || '-')}</td>
          <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis">${escapeHtml(d.texto || '-')}</td>
          <td>${d.prova ? `<a href="${escapeHtml(d.prova)}" target="_blank" style="color:#ff6b6b">📎 ver</a>` : '-'}</td>
          <td style="font-size:11px">${escapeHtml(d.ip || '-')}<br><small>${d.device_fp ? d.device_fp.slice(0,16) : ''}</small></td>
          <td>${String(d.created_at || '').slice(0,16)}</td>
          <td style="color:#ff4757;font-weight:700">🔴 ${escapeHtml(d.status || 'enviado_para_analise')}</td>
        </tr>
        <tr><td colspan="7" style="padding:2px 6px 8px;font-size:11px;color:#8b8ba8">
          ${d.mensagens && d.mensagens.length ? '📩 últimas mensagens: ' + d.mensagens.slice(0,3).map(m => escapeHtml(String(m.text || m.type || '')).slice(0,60)).join(' | ') : ''}
        </td></tr>`).join('')}
      </table>
    ` : '<p style="color:#2ed573;padding:12px">✅ Nenhuma denúncia grave em aberto</p>';
  } catch (e) {
    document.getElementById('childBansContainer').innerHTML = '<p style="color:#ff4757">Erro: ' + escapeHtml(e.message) + '</p>';
  }
}
async function exportChildProofs() {
  try {
    const res = await fetch(ADMIN_API + '/security/child-bans/export', { credentials: 'include' });
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) throw new Error('API retornou ' + ct);
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'vibestream-provas-seguranca-infantil.json';
    a.click();
    URL.revokeObjectURL(a.href);
    alert('✅ Provas exportadas (' + (data.denuncias || []).length + ' registros)');
  } catch (e) { alert('❌ ' + e.message); }
}

async function loadSecurity() {
  try { loadChildBans(); } catch (e) {}
  try {
    const data = await api(ADMIN_API + '/security-logs?limit=50');
    document.getElementById('securityLogs').innerHTML = (data.logs || []).length ? `
      <table>
        <tr><th>Ação</th><th>IP</th><th>Data</th></tr>
        ${(data.logs || []).map(l => `<tr><td>${l.action}</td><td>${l.ip_address || '-'}</td><td>${l.created_at}</td></tr>`).join('')}
      </table>
    ` : '<p style="color:#6b6b80;padding:20px">Nenhum log encontrado</p>';
  } catch (e) {
    document.getElementById('securityLogs').innerHTML = '<p style="color:#ff4757">Erro</p>';
  }
}

function buildUserTable(users) {
  if (!users || !users.length) return '<p style="color:#6b6b80;padding:20px">Nenhum usuário encontrado</p>';
  return `<table>
    <tr><th>Usuário</th><th>Email</th><th>Status</th><th>Ações</th></tr>
    ${users.map(u => `<tr>
      <td>${u.username || '?'} ${u.is_verified ? '✅' : ''} ${u.role === 'admin' ? '🛡️' : ''}</td>
      <td>${u.email || '-'}</td>
      <td>${u.status || 'active'}</td>
      <td>
        <button class="btn-sm btn-danger" onclick="banUser('${u.id}')">Banir</button>
        <button class="btn-sm btn-danger" onclick="banPoliticalPhoto('${u.id}')" title="Banir + remover foto política + deixar como usuário">🚫 Foto</button>
        <button class="btn-sm btn-warning" onclick="muteUser('${u.id}')">Mutar</button>
        <button class="btn-sm btn-success" onclick="verifyUser('${u.id}')">✓</button>
      </td>
    </tr>`).join('')}
  </table>`;
}

function buildTicketTable(tickets) {
  if (!tickets || !tickets.length) return '<p style="color:#6b6b80;padding:20px">Nenhum ticket pendente</p>';
  return `<table>
    <tr><th>Usuário</th><th>Assunto</th><th>Status</th></tr>
    ${tickets.map(t => `<tr><td>${t.username}</td><td>${t.subject}</td><td>${t.status}</td></tr>`).join('')}
  </table>`;
}

function buildLiveTable(lives) {
  if (!lives || !lives.length) return '<p style="color:#6b6b80;padding:20px">Nenhuma live</p>';
  return `<table>
    <tr><th>Usuário</th><th>Título</th><th>Status</th><th>Ação</th></tr>
    ${lives.map(l => `<tr><td>${l.username || l.display_name || '?'}</td><td>${l.title || 'Sem título'}</td><td>${l.status}</td>
      <td>${l.status === 'live' ? '<button class="btn-sm btn-danger" onclick="endLive(\'' + l.id + '\')">Encerrar</button>' : '-'}</td>
    </tr>`).join('')}
  </table>`;
}

function buildFamilyTable(families) {
  if (!families || !families.length) return '<p style="color:#6b6b80;padding:20px">Nenhuma família</p>';
  return `<table>
    <tr><th>Nome</th><th>Dono</th><th>Membros</th><th>Ação</th></tr>
    ${families.map(f => `<tr><td>${f.name}</td><td>${f.owner_name || '-'}</td><td>${f.members_count}</td>
      <td><button class="btn-sm btn-danger" onclick="deleteFamily('${f.id}')">Excluir</button></td>
    </tr>`).join('')}
  </table>`;
}

async function banUser(id) {
  const reason = prompt('Motivo do ban:');
  if (!reason) return;
  try {
    await api(ADMIN_API + '/users/' + id + '/ban', { method: 'POST', body: JSON.stringify({ reason, banType: 'permanente' }) });
    alert('✅ Usuário banido');
    loadUsers(1);
  } catch (e) { alert('❌ ' + e.message); }
}

async function banPoliticalPhoto(id) {
  if (!confirm('Banir permanentemente, remover a foto e deixar a conta como usuário comum?')) return;
  try {
    await api(ADMIN_API + '/users/' + id + '/ban-political-photo', { method: 'POST', body: JSON.stringify({}) });
    alert('✅ Usuário banido, foto removida e conta deixada como usuário');
    loadUsers(1);
  } catch (e) { alert('❌ ' + e.message); }
}

async function muteUser(id) {
  const reason = prompt('Motivo da mutação:');
  if (!reason) return;
  try {
    await api(ADMIN_API + '/users/' + id + '/mute', { method: 'POST', body: JSON.stringify({ reason }) });
    alert('✅ Usuário mutado');
  } catch (e) { alert('❌ ' + e.message); }
}

async function verifyUser(id) {
  try {
    await api(ADMIN_API + '/users/' + id + '/verify', { method: 'POST' });
    loadUsers(1);
  } catch (e) { alert('❌ ' + e.message); }
}

async function endLive(id) {
  try {
    await api(ADMIN_API + '/lives/' + id + '/end', { method: 'POST' });
    loadLives();
  } catch (e) { alert('❌ ' + e.message); }
}

async function deleteFamily(id) {
  if (!confirm('Excluir família?')) return;
  try {
    await api(ADMIN_API + '/families/' + id, { method: 'DELETE' });
    loadFamilies();
  } catch (e) { alert('❌ ' + e.message); }
}

// Check if already logged in
checkLogin();
async function checkLogin() {
  try {
    const data = await api('/api/auth/me');
    if (data.user && (data.user.role === 'admin' || data.user.role === 'moderator')) {
      document.getElementById('loginScreen').classList.add('hidden');
      document.getElementById('adminPanel').classList.remove('hidden');
      applyRoleUI(data.user.role);
      loadDashboard();
    }
  } catch (e) { /* not logged in */ }
}

// ============================================================
// SAQUE PIX (Admin)
// ============================================================
async function loadWithdrawals() {
  try {
    const data = await api(ADMIN_API + '/withdrawals');
    document.getElementById('withdrawalsContainer').innerHTML = (data.withdrawals || []).length ? `
      <table>
        <tr><th>Usuário</th><th>Valor</th><th>Chave PIX</th><th>Tipo</th><th>Status</th><th>Ações</th></tr>
        ${(data.withdrawals || []).map(w => `<tr>
          <td>${w.username || '?'}</td>
          <td>R$ ${Number(w.amount || 0).toFixed(2)}</td>
          <td>${escapeHtml(w.pix_key || '')}</td>
          <td>${w.pix_type || 'cpf'}</td>
          <td>${w.status}</td>
          <td>${w.status === 'pendente' ? `<button class="btn-sm btn-success" onclick="reviewWithdrawal('${w.id}','approve')">✓ Aprovar</button> <button class="btn-sm btn-danger" onclick="reviewWithdrawal('${w.id}','reject')">✕ Rejeitar</button>` : (w.admin_response || '-')}</td>
        </tr>`).join('')}
      </table>
    ` : '<p style="color:#6b6b80;padding:20px">Nenhuma solicitação de saque</p>';
  } catch (e) {
    document.getElementById('withdrawalsContainer').innerHTML = '<p style="color:#ff4757;padding:20px">Erro: ' + escapeHtml(e.message) + '</p>';
  }
}
async function reviewWithdrawal(id, action) {
  const response = action === 'reject' ? (prompt('Motivo da rejeição:') || '') : (prompt('Observação (opcional):') || '');
  try {
    await api(ADMIN_API + '/withdrawals/' + id + '/review', { method: 'POST', body: JSON.stringify({ action, response }) });
    alert(action === 'approve' ? '✅ Saque aprovado' : '❌ Saque rejeitado (saldo estornado)');
    loadWithdrawals();
  } catch (e) { alert('❌ ' + e.message); }
}

// ============================================================
// ECONOMIA (Admin): presentes, pedidos de recarga, transações, VIP
// ============================================================
async function loadEconomy() {
  const el = document.getElementById('economyContainer');
  el.innerHTML = '<p style="color:#6b6b80;padding:20px">Carregando economia...</p>';
  try {
    const data = await api(ADMIN_API + '/economy-transactions');
    const giftsData = await api(ADMIN_API + '/gifts');
    const ordersData = await api(ADMIN_API + '/recharge-orders');
    const vipData = await api(ADMIN_API + '/vip-users');
    const gifts = giftsData.gifts || [];
    const orders = ordersData.orders || [];
    const txs = data.transactions || [];
    const giftTxs = data.gifts || [];
    const vipUsers = vipData.users || [];

    el.innerHTML = `
      <h3 style="margin:10px 0 6px">🎁 Presentes</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px" id="giftList">
        ${gifts.map(g => `
          <div style="border:1px solid #2a2a44;border-radius:10px;padding:10px;background:#1a1a2e;min-width:140px">
            <div style="font-size:26px">${g.image_url ? escapeHtml(g.image_url) : '🎁'}</div>
            <div><b>${escapeHtml(g.name)}</b></div>
            <div style="color:#ffd700;font-size:12px">${g.price_coins} moedas</div>
            <div style="color:#a0a0b8;font-size:12px">${g.price_diamonds ? g.price_diamonds + ' diamantes' : '—'}</div>
            <div style="font-size:12px;color:${g.is_active ? '#2ed573' : '#ff4757'}">${g.is_active ? 'Ativo' : 'Desativado'}</div>
            <button class="btn-sm" onclick="toggleGift('${g.id}')">${g.is_active ? 'Desativar' : 'Ativar'}</button>
          </div>`).join('')}
      </div>
      <details style="margin:8px 0;border:1px solid #2a2a44;border-radius:8px;padding:8px">
        <summary style="cursor:pointer;color:#6C5CE7">➕ Criar novo presente</summary>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
          <input id="giftName" placeholder="Nome" style="padding:8px;border-radius:8px;border:1px solid #2a2a44;background:#12122a;color:#fff">
          <input id="giftCoins" placeholder="Preço (moedas)" type="number" min="1" style="padding:8px;border-radius:8px;border:1px solid #2a2a44;background:#12122a;color:#fff">
          <input id="giftDiamonds" placeholder="Preço (diamantes)" type="number" min="0" style="padding:8px;border-radius:8px;border:1px solid #2a2a44;background:#12122a;color:#fff">
          <select id="giftCat" style="padding:8px;border-radius:8px;border:1px solid #2a2a44;background:#12122a;color:#fff">
            <option value="normal">Normal</option><option value="animado">Animado</option>
            <option value="vip">VIP</option><option value="premium">Premium</option><option value="lendario">Lendário</option>
          </select>
          <button class="btn-sm" style="background:#6C5CE7" onclick="createGift()">Salvar presente</button>
        </div>
      </details>

      <h3 style="margin:14px 0 6px">💳 Pedidos de Recarga (PIX)</h3>
      ${orders.length ? `
        <table>
          <tr><th>Usuário</th><th>Pacote</th><th>Valor</th><th>Moedas</th><th>Status</th><th>Data</th><th>Ação</th></tr>
          ${orders.map(o => `<tr>
            <td>${escapeHtml(o.username || o.user_id)}</td><td>${escapeHtml(o.package_name || '-')}</td>
            <td>R$ ${Number(o.amount || 0).toFixed(2)}</td><td>${(o.coins || 0) + (o.bonus || 0)}</td>
            <td style="color:${o.status === 'pendente' ? '#ffd700' : '#2ed573'}">${o.status}</td>
            <td>${o.created_at}</td>
            <td>${o.status === 'pendente' ? `<button class="btn-sm" style="background:#2ed573" onclick="confirmOrder('${o.id}')">Confirmar</button>` : '<span style="color:#6b6b80">—</span>'}</td>
          </tr>`).join('')}
        </table>
      ` : '<p style="color:#6b6b80;padding:10px">Nenhum pedido de recarga</p>'}

      <h3 style="margin:14px 0 6px">👑 Usuários VIP</h3>
      ${vipUsers.length ? `
        <table>
          <tr><th>Usuário</th><th>Plano</th><th>Válido até</th><th>Moedas</th></tr>
          ${vipUsers.map(u => `<tr>
            <td>${escapeHtml(u.display_name || u.username)}</td><td>${escapeHtml(u.vip_tier || '-')}</td>
            <td>${u.vip_until || '-'}</td><td>${u.coins || 0}</td>
          </tr>`).join('')}
        </table>
      ` : '<p style="color:#6b6b80;padding:10px">Nenhum usuário VIP</p>'}

      <h3 style="margin:14px 0 6px">🧾 Movimentações da Carteira</h3>
      ${txs.length ? `
        <table>
          <tr><th>Usuário</th><th>Tipo</th><th>Valor</th><th>Descrição</th><th>Status</th><th>Data</th></tr>
          ${txs.map(t => `<tr>
            <td>${escapeHtml(t.username || t.user_id)}</td><td>${escapeHtml(t.type || '-')}</td>
            <td>${Number(t.amount || 0)}</td><td>${escapeHtml(t.description || '-')}</td>
            <td>${t.status || '-'}</td><td>${t.created_at || '-'}</td>
          </tr>`).join('')}
        </table>
      ` : '<p style="color:#6b6b80;padding:10px">Nenhuma transação</p>'}

      <h3 style="margin:14px 0 6px">🎁 Presentes Enviados</h3>
      ${giftTxs.length ? `
        <table>
          <tr><th>Presente</th><th>De</th><th>Para</th><th>Moedas</th><th>Data</th></tr>
          ${giftTxs.map(gt => `<tr>
            <td>${escapeHtml(gt.gift_name || '-')}</td><td>${escapeHtml(gt.sender_name || '-')}</td>
            <td>${escapeHtml(gt.receiver_name || '-')}</td><td>${gt.coins || 0}</td><td>${gt.created_at || '-'}</td>
          </tr>`).join('')}
        </table>
      ` : '<p style="color:#6b6b80;padding:10px">Nenhum presente enviado</p>'}
    `;
  } catch (e) {
    el.innerHTML = '<p style="color:#ff4757;padding:20px">Erro: ' + escapeHtml(e.message) + '</p>';
  }
}
async function toggleGift(id) {
  try {
    await api(ADMIN_API + '/gifts/' + id + '/toggle', { method: 'POST' });
    loadEconomy();
  } catch (e) { alert('❌ ' + e.message); }
}
async function createGift() {
  const name = document.getElementById('giftName').value.trim();
  const priceCoins = document.getElementById('giftCoins').value;
  const priceDiamonds = document.getElementById('giftDiamonds').value || 0;
  const category = document.getElementById('giftCat').value;
  if (!name || !priceCoins) return alert('Informe nome e preço');
  try {
    await api(ADMIN_API + '/gifts', { method: 'POST', body: JSON.stringify({ name, priceCoins, priceDiamonds, category }) });
    alert('✅ Presente criado');
    loadEconomy();
  } catch (e) { alert('❌ ' + e.message); }
}
async function confirmOrder(id) {
  if (!confirm('Confirmar pagamento e creditar moedas?')) return;
  try {
    await api(ADMIN_API + '/recharge-orders/' + id + '/confirm', { method: 'POST' });
    alert('✅ Pagamento confirmado — moedas creditadas');
    loadEconomy();
  } catch (e) { alert('❌ ' + e.message); }
}

// ============================================================
// AGÊNCIAS (Admin)
// ============================================================
async function loadAgencies() {
  try {
    const [data, pend] = await Promise.all([
      api(ADMIN_API + '/agencies'),
      publicApi('/api/agencias/pendentes').catch(() => ({ success: true, data: [] }))
    ]);
    const all = (data.agencies || []).map(a => ({ ...a, _pendente: false }));
    const pendentes = (pend && pend.success && pend.data) ? pend.data.map(p => ({ id: p.id, name: p.nome, tag: p.tag, logo: p.logo, owner_name: p.dono, whatsapp: p.whatsapp, status: p.status, created_at: p.criacaoEm, _pendente: true })) : [];
    const lista = [...pendentes, ...all];
    document.getElementById('agenciesContainer').innerHTML = lista.length ? `
      <div style="margin-bottom:10px;font-size:12px;color:#6b6b80">${pendentes.length ? '🔴 ' + pendentes.length + ' agência(s) aguardando aprovação' : 'Nenhuma pendente'} — aprovadas: ${all.length}</div>
      <table>
        <tr><th>Logo</th><th>Nome</th><th>TAG</th><th>Dono</th><th>WhatsApp</th><th>Data</th><th>Status</th><th>Ações</th></tr>
        ${lista.map(a => `<tr style="opacity:${a.status === 'reprovada' ? 0.55 : 1}">
          <td><span class="mini-av">${a.logo ? `<img src="${a.logo}" alt="" style="width:30px;height:30px;border-radius:50%;object-fit:cover">` : '🏢'}</span></td>
          <td><b>${escapeHtml(a.name)}</b></td><td><span class="badge">[${escapeHtml(a.tag || a.code || '-')}]</span></td>
          <td>${escapeHtml(a.owner_name || '-')}</td><td>${escapeHtml(a.whatsapp || '-')}</td>
          <td>${a.created_at ? String(a.created_at).slice(0, 16) : '-'}</td>
          <td><span style="color:${a.status === 'aprovada' ? '#2ed573' : (a.status === 'reprovada' ? '#ff4757' : '#f5a524')};font-weight:700">${a.status || '-'}</span></td>
          <td style="white-space:nowrap">
            ${(a._pendente || a.status === 'pendente') ? `<button class="btn-sm" style="background:#2ed573" onclick="approveAgency('${a.id}')">Aprovar</button>
            <button class="btn-sm" style="background:rgba(255,59,48,.2);color:#ff6b6b" onclick="rejectAgency('${a.id}')">Reprovar</button>` : ''}
            <button class="btn-sm btn-danger" onclick="deleteAgency('${a.id}')">Excluir</button>
          </td>
        </tr>`).join('')}
      </table>
    ` : '<p style="color:#6b6b80;padding:20px">Nenhuma agência criada</p>';
  } catch (e) {
    document.getElementById('agenciesContainer').innerHTML = '<p style="color:#ff4757;padding:20px">Erro: ' + escapeHtml(e.message) + '</p>';
  }
}
async function publicApi(path, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, credentials: 'include', ...opts, signal: ctrl.signal });
    clearTimeout(timer);
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const text = await res.text();
      throw new Error('API retornou ' + contentType + ': ' + text.substring(0, 100));
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro');
    return data;
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === 'AbortError') throw new Error('Servidor demorou (timeout)');
    throw err;
  }
}
async function approveAgency(id) {
  if (!confirm('Aprovar esta agência?')) return;
  try {
    const d = await publicApi('/api/agencias/' + id + '/aprovar', { method: 'PUT' });
    alert('✅ ' + (d.data.message || 'Aprovada'));
    loadAgencies();
  } catch (e) { alert('❌ ' + e.message); }
}
async function rejectAgency(id) {
  const motivo = prompt('Motivo da reprovação:');
  if (motivo === null) return;
  try {
    const d = await publicApi('/api/agencias/' + id + '/reprovar', { method: 'PUT', body: JSON.stringify({ motivo }) });
    alert('❌ ' + (d.data.message || 'Reprovada'));
    loadAgencies();
  } catch (e) { alert('❌ ' + e.message); }
}
async function deleteAgency(id) {
  if (!confirm('Excluir agência e todos os membros?')) return;
  try {
    await api(ADMIN_API + '/agencies/' + id, { method: 'DELETE' });
    loadAgencies();
  } catch (e) { alert('❌ ' + e.message); }
}

// ============================================================
// ALERTAS DE SEGURANÇA (Admin)
// ============================================================
async function loadAlerts() {
  try {
    const data = await api(ADMIN_API + '/alerts');
    document.getElementById('alertsContainer').innerHTML = (data.alerts || []).length ? `
      <table>
        <tr><th>Severidade</th><th>Tipo</th><th>Mensagem</th><th>IP</th><th>Data</th></tr>
        ${(data.alerts || []).map(a => `<tr style="opacity:${a.is_read ? 0.55 : 1}">
          <td>${a.severity}</td><td>${escapeHtml(a.alert_type)}</td><td>${escapeHtml(a.message)}</td>
          <td>${a.ip_address || '-'}</td><td>${a.created_at}</td>
        </tr>`).join('')}
      </table>
    ` : '<p style="color:#6b6b80;padding:20px">Nenhum alerta de segurança</p>';
  } catch (e) {
    document.getElementById('alertsContainer').innerHTML = '<p style="color:#ff4757;padding:20px">Erro: ' + escapeHtml(e.message) + '</p>';
  }
}

// ============================================================
// VIBEGUARD AI — Bots de moderação/observação + chat da equipe
// ============================================================
let vgChatTimer = null;

function esc(str) { return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

async function loadVibeGuard() {
  loadVGStats();
  loadVGQueue();
  loadVGFlags();
  loadVGActions();
  loadVGChat();
  if (vgChatTimer) clearInterval(vgChatTimer);
  vgChatTimer = setInterval(() => { try { loadVGChat(true); } catch (e) {} }, 8000);
}

async function loadVGStats() {
  const box = document.getElementById('vgStats');
  if (!box) return;
  try {
    const d = await api(ADMIN_API + '/vibeguard/stats');
    const s = d.data || {};
    box.innerHTML = `
      <div class="vg-stat"><b>${s.reportsPending || 0}</b><small>Denúncias pendentes</small></div>
      <div class="vg-stat"><b>${s.highRisk || 0}</b><small>Flags alto risco</small></div>
      <div class="vg-stat"><b>${s.reviewsPending || 0}</b><small>Posts em revisão</small></div>
      <div class="vg-stat"><b>${s.actionsToday || 0}</b><small>Ações hoje</small></div>
      <div class="vg-stat"><b>${s.anonymousReports || 0}</b><small>Denúncias anônimas</small></div>
      <div class="vg-stat"><b>${s.flagsOpen || 0}</b><small>Flags abertas</small></div>
      <div class="vg-stat"><b>${s.alerts || 0}</b><small>Alertas hoje</small></div>
      <div class="vg-stat"><b>${s.chatMessages || 0}</b><small>Msgs da equipe</small></div>`;
  } catch (e) { box.innerHTML = '<p style="color:#ff4757;padding:12px">Erro: ' + esc(e.message) + '</p>'; }
}

async function loadVGQueue() {
  const box = document.getElementById('vgQueue');
  if (!box) return;
  try {
    const d = await api(ADMIN_API + '/vibeguard/queue');
    const q = d.data || {};
    let html = '';
    const reports = (q.reports || []).map(r => `
      <div class="vg-item pri-${r.priority >= 80 ? 'high' : r.priority >= 40 ? 'med' : 'low'}">
        <div class="vg-item-head">
          <span class="vg-tag">🛡️ Denúncia ${r.anonymous ? 'anônima' : ''} · prioridade ${r.priority}</span>
          <span class="vg-date">${esc(r.created_at || '')}</span>
        </div>
        <p><b>${esc(r.content_type || '')}</b>${r.content_id ? ' · ' + esc(String(r.content_id).slice(0, 14)) : ''}${r.reported_username ? ' · usuário @' + esc(r.reported_username) : ''}</p>
        <p class="vg-reason">${esc(r.reason || '')}</p>
        ${r.evidence_url ? `<p class="vg-ev"><a href="${esc(r.evidence_url)}" target="_blank" rel="noopener">🔗 Prova</a></p>` : ''}
        <div class="vg-actions">
          <button class="vg-btn ok" onclick="vgResolve('${r.id}','accepted')">✅ Aceitar</button>
          <button class="vg-btn warn" onclick="vgResolve('${r.id}','analyzing')">🔍 Analisar</button>
          <button class="vg-btn danger" onclick="vgResolve('${r.id}','rejected')">↩️ Rejeitar</button>
          <button class="vg-btn" onclick="vgPunish('${r.id}','warning')">⚠️ Aviso</button>
          <button class="vg-btn" onclick="vgPunish('${r.id}','suspend')">⏸️ Suspender</button>
          <button class="vg-btn danger" onclick="vgPunish('${r.id}','ban')">🚫 Banir</button>
        </div>
      </div>`).join('');
    const reviews = (q.reviews || []).map(r => `
      <div class="vg-item">
        <div class="vg-item-head"><span class="vg-tag">📝 Post em revisão</span><span class="vg-date">${esc(r.created_at || '')}</span></div>
        <p><b>@${esc(r.author_username || '')}</b>: ${esc((r.post_text || r.title || '').slice(0, 120))}</p>
        <div class="vg-actions">
          <button class="vg-btn ok" onclick="vgReviewPost('${r.post_id}','approve')">✅ Aprovar</button>
          <button class="vg-btn danger" onclick="vgReviewPost('${r.post_id}','remove')">🗑️ Remover</button>
          <button class="vg-btn" onclick="vgReviewPost('${r.post_id}','flag')">🚩 Sinalizar</button>
        </div>
      </div>`).join('');
    const flags = (q.flags || []).map(f => `
      <div class="vg-item">
        <div class="vg-item-head"><span class="vg-tag ${f.severity === 'critical' ? 'critical' : ''}">🚩 ${esc(f.severity || '')}</span><span class="vg-date">${esc(f.created_at || '')}</span></div>
        <p><b>@${esc(f.username || '')}</b> — ${esc(f.label || '')} <small style="opacity:.6">(${esc(f.content_type || '')})</small></p>
      </div>`).join('');
    html += reports + reviews + flags;
    box.innerHTML = html || '<p style="color:#6b6b80;padding:20px">Fila limpa — nada pendente 🎉</p>';
  } catch (e) { box.innerHTML = '<p style="color:#ff4757;padding:20px">Erro: ' + esc(e.message) + '</p>'; }
}

async function vgResolve(id, decision) {
  const notes = prompt('Notas da análise (opcional):') || '';
  try {
    await api(ADMIN_API + '/vibeguard/reports/' + id + '/resolve', { method: 'POST', body: JSON.stringify({ decision, notes }) });
    loadVGQueue(); loadVGStats(); loadVGActions(); loadVGChat();
  } catch (e) { alert('❌ ' + e.message); }
}

async function vgPunish(id, punishment) {
  const notes = prompt(punishment === 'ban' ? 'Motivo do banimento:' : punishment === 'suspend' ? 'Motivo da suspensão (dias):' : 'Motivo do aviso:') || '';
  try {
    await api(ADMIN_API + '/vibeguard/reports/' + id + '/resolve', { method: 'POST', body: JSON.stringify({ decision: 'accepted', notes, punishment }) });
    loadVGQueue(); loadVGStats(); loadVGActions(); loadVGChat();
  } catch (e) { alert('❌ ' + e.message); }
}

async function vgReviewPost(postId, decision) {
  const reason = decision === 'remove' ? (prompt('Motivo da remoção:') || 'Removido pela moderação') : '';
  try {
    await api(ADMIN_API + '/vibeguard/posts/' + postId + '/review', { method: 'POST', body: JSON.stringify({ decision, reason }) });
    loadVGQueue(); loadVGStats(); loadVGActions();
  } catch (e) { alert('❌ ' + e.message); }
}

async function loadVGFlags() {
  const box = document.getElementById('vgFlags');
  if (!box) return;
  try {
    const d = await api(ADMIN_API + '/vibeguard/flags');
    const flags = (d.data && d.data.flags) || [];
    box.innerHTML = flags.length ? `<table>
      <tr><th>Severidade</th><th>Usuário</th><th>Motivo</th><th>Tipo</th><th>Data</th></tr>
      ${flags.slice(0, 40).map(f => `<tr style="opacity:${f.resolved ? 0.5 : 1}">
        <td>${f.severity}</td><td>@${esc(f.username || '')}</td><td>${esc(f.label || '')}</td>
        <td>${esc(f.flag_type || '')}</td><td>${esc(f.created_at || '')}</td>
      </tr>`).join('')}
    </table>` : '<p style="color:#6b6b80;padding:14px">Nenhuma flag registrada</p>';
  } catch (e) { box.innerHTML = '<p style="color:#ff4757;padding:14px">Erro: ' + esc(e.message) + '</p>'; }
}

async function loadVGActions() {
  const box = document.getElementById('vgActions');
  if (!box) return;
  try {
    const d = await api(ADMIN_API + '/vibeguard/actions');
    const acts = (d.data && d.data.actions) || [];
    box.innerHTML = acts.length ? `<table>
      <tr><th>Ação</th><th>Moderador</th><th>Alvo</th><th>Nota</th><th>Data</th></tr>
      ${acts.slice(0, 40).map(a => `<tr>
        <td>${esc(a.action_type || '')}</td><td>@${esc(a.username || '')}</td>
        <td>${esc((a.target_type || '') + ' ' + String(a.target_id || '').slice(0, 10))}</td>
        <td>${esc(a.note || '')}</td><td>${esc(a.created_at || '')}</td>
      </tr>`).join('')}
    </table>` : '<p style="color:#6b6b80;padding:14px">Nenhuma ação registrada</p>';
  } catch (e) { box.innerHTML = '<p style="color:#ff4757;padding:14px">Erro: ' + esc(e.message) + '</p>'; }
}

async function loadVGChat(silent) {
  const box = document.getElementById('vgChatBox');
  if (!box) return;
  try {
    const d = await api(ADMIN_API + '/vibeguard/chat');
    const msgs = (d.data && d.data.messages) || [];
    const keepScroll = box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
    box.innerHTML = msgs.map(m => `
      <div class="vg-msg ${m.kind === 'alert' ? 'alert' : m.kind === 'system' ? 'system' : ''}">
        <b>${m.kind === 'alert' ? '🤖 VibeGuard' : esc(m.display_name || m.username || 'Equipe')}</b>
        <span>${esc(m.message || '')}</span>
        <small>${esc(m.created_at || '')}${m.case_ref ? ' · caso ' + esc(String(m.case_ref).slice(0, 10)) : ''}</small>
      </div>`).join('') || '<p style="color:#6b6b80;padding:14px">Canal vazio — alertas automáticos aparecem aqui</p>';
    if (keepScroll) box.scrollTop = box.scrollHeight;
  } catch (e) {
    if (!silent) box.innerHTML = '<p style="color:#ff4757;padding:14px">Erro: ' + esc(e.message) + '</p>';
  }
}

async function vgSendChat() {
  const input = document.getElementById('vgChatMsg');
  const message = (input ? input.value : '').trim();
  if (!message) return;
  try {
    await api(ADMIN_API + '/vibeguard/chat', { method: 'POST', body: JSON.stringify({ message }) });
    if (input) input.value = '';
    loadVGChat();
  } catch (e) { alert('❌ ' + e.message); }
}
