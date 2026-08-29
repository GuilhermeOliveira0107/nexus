const TOKEN_KEY = "nexus_token";
const state = {
  me: null,
  servers: [],
  channels: [],
  members: [],
  friends: { accepted: [], incoming: [], outgoing: [] },
  dms: [],
  messages: [],
  online: new Set(),
  voiceStates: {},
  view: "home",
  serverId: null,
  channel: null,
  invite: new URLSearchParams(location.search).get("invite"),
};

const voice = new VoiceChat();
let ws = null;
let heartbeat = null;
let typingTimer = null;
let typingUsers = new Map();

const $ = (id) => document.getElementById(id);

function initials(name) {
  return (name || "?").trim().slice(0, 2).toUpperCase();
}

function avatar(user, cls = "avatar") {
  return `<div class="${cls}" style="background:${user.avatar_color}">${initials(user.display_name)}</div>`;
}

function toast(text) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  $("toasts").appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(options.body);
  }
  const res = await fetch(path, { ...options, headers });
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(apiError(data));
  return data;
}

function apiError(data) {
  const detail = data.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((item) => item.msg || item).join(" ");
  return data.message || "Algo deu errado.";
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    const box = document.createElement("textarea");
    box.value = text;
    document.body.appendChild(box);
    box.select();
    document.execCommand("copy");
    box.remove();
  }
}

function send(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function inThisCall(channelId) {
  return Boolean(voice.channelId && channelId && voice.channelId === channelId);
}

function playCallSfx(name) {
  if (voice.deafened) return;
  if (name === "join" && prefs && !prefs.sfxJoin) return;
  if (name === "leave" && prefs && !prefs.sfxLeave) return;
  Sfx.play(name);
}

function playMessageSound(msg) {
  if (!state.me || msg.author.id === state.me.id) return;
  if (voice.deafened) return;
  const watching = state.channel && msg.channel_id === state.channel.id && !document.hidden;
  const text = (msg.content || "").toLowerCase();
  const mentioned = text.includes(`@${state.me.username.toLowerCase()}`) ||
    text.includes(state.me.display_name.toLowerCase());
  if (mentioned) {
    if (!prefs || prefs.sfxMention) Sfx.play("mention");
    return;
  }
  const allowOpenChannel = prefs && !prefs.notifyUnfocusedOnly;
  if ((!watching || allowOpenChannel) && (!prefs || prefs.sfxMessage)) Sfx.play("message");
}

function toggleMute() {
  const next = !voice.muted;
  Sfx.play(next ? "mute" : "unmute");
  voice.setMuted(next);
}

function toggleDeafen() {
  const next = !voice.deafened;
  Sfx.play(next ? "deafen" : "undeafen");
  voice.setDeafened(next);
}

async function leaveCall() {
  if (!prefs || prefs.sfxDisconnect) Sfx.play("disconnect");
  await voice.leave(true);
}

function publicUrl() {
  return location.origin;
}

function inviteLink(code) {
  return `${publicUrl()}/?invite=${code}`;
}

function showLogin(show) {
  $("login-screen").classList.toggle("hidden", !show);
  $("app").classList.toggle("hidden", show);
}

function openModal(html) {
  $("modal-card").innerHTML = html;
  $("modal").classList.remove("hidden");
}

function closeModal() {
  $("modal").classList.add("hidden");
}

$("modal").addEventListener("click", (e) => {
  if (e.target.id === "modal") closeModal();
});

/* ---------- auth ---------- */
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    $("login-form").classList.toggle("hidden", tab.dataset.tab !== "login");
    $("register-form").classList.toggle("hidden", tab.dataset.tab !== "register");
  });
});

async function bootInviteBanner() {
  if (!state.invite) return;
  try {
    const info = await fetch(`/api/invites/${state.invite}`).then((r) => r.json());
    if (!info.name) return;
    $("invite-banner").classList.remove("hidden");
    $("invite-banner").textContent = `Você foi chamado para ${info.name} · ${info.member_count} ${info.member_count === 1 ? "pessoa" : "pessoas"}`;
  } catch (_) {}
}

async function afterAuth(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  state.me = user;
  if (state.invite) {
    try {
      await api("/api/servers/join", { method: "POST", body: { invite_code: state.invite } });
      history.replaceState({}, "", "/");
    } catch (err) {
      toast(err.message);
    }
  }
  await startApp();
}

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("auth-error").textContent = "";
  const body = Object.fromEntries(new FormData(e.target));
  try {
    const data = await api("/api/auth/login", { method: "POST", body });
    await afterAuth(data.token, data.user);
  } catch (err) {
    $("auth-error").textContent = err.message;
  }
});

$("register-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("auth-error").textContent = "";
  const body = Object.fromEntries(new FormData(e.target));
  try {
    const data = await api("/api/auth/register", { method: "POST", body });
    await afterAuth(data.token, data.user);
  } catch (err) {
    $("auth-error").textContent = err.message;
  }
});

/* ---------- app shell ---------- */
async function startApp() {
  showLogin(false);
  await refreshAll();
  connectWs();
  if (state.invite && state.servers.length) {
    const joined = state.servers.find((s) => s.invite_code === state.invite.toUpperCase());
    if (joined) openServer(joined.id);
  } else {
    render();
  }
}

async function refreshAll() {
  const [servers, friends, dms] = await Promise.all([
    api("/api/servers"),
    api("/api/friends"),
    api("/api/dms"),
  ]);
  state.servers = servers;
  state.friends = friends;
  state.dms = dms;
}

function connectWs() {
  const token = localStorage.getItem(TOKEN_KEY);
  const proto = location.protocol === "https:" ? "wss" : "ws";
  if (heartbeat) clearInterval(heartbeat);
  ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);
  ws.onopen = () => {
    heartbeat = setInterval(() => send({ type: "ping" }), 25000);
  };
  ws.onmessage = (ev) => onEvent(JSON.parse(ev.data));
  ws.onclose = () => {
    if (heartbeat) clearInterval(heartbeat);
    setTimeout(() => {
      if (localStorage.getItem(TOKEN_KEY)) connectWs();
    }, 1500);
  };
}

function onEvent(msg) {
  if (msg.type === "pong") return;
  if (msg.type === "hello") {
    state.online = new Set(msg.online || []);
    state.voiceStates = msg.voice || {};
    render();
  } else if (msg.type === "presence") {
    if (msg.online) state.online.add(msg.user_id);
    else state.online.delete(msg.user_id);
    renderMembers();
    if (state.view === "home") renderFriends();
  } else if (msg.type === "message") {
    if (state.channel && msg.channel_id === state.channel.id) {
      state.messages.push(msg);
      renderMessages(false);
    }
    playMessageSound(msg);
  } else if (msg.type === "typing") {
    if (state.channel && msg.channel_id === state.channel.id) {
      typingUsers.set(msg.user.id, msg.user.display_name);
      renderTyping();
      setTimeout(() => {
        typingUsers.delete(msg.user.id);
        renderTyping();
      }, 2500);
    }
  } else if (msg.type === "voice_peers") {
    voice.join(msg.channel_id, msg.peers, send).then(() => {
      if (prefs && prefs.defaultMuted && !voice.muted) voice.setMuted(true);
      if (!prefs || prefs.sfxJoin) Sfx.play("join");
      renderUser();
      renderVoiceBar();
    }).catch((err) => {
      send({ type: "voice_leave" });
      toast(err.name === "NotAllowedError" || err.name === "NotFoundError"
        ? "Libere o microfone. Amigos na Wi‑Fi precisam do link HTTPS que aparece no terminal."
        : err.message);
    });
  } else if (msg.type === "voice_join") {
    state.voiceStates[msg.user.id] = { channel_id: msg.channel_id, muted: msg.muted, deafened: msg.deafened };
    if (msg.user.id !== state.me.id && inThisCall(msg.channel_id)) {
      playCallSfx("join");
    }
    render();
  } else if (msg.type === "voice_leave") {
    const leftChannel = msg.channel_id;
    delete state.voiceStates[msg.user_id];
    voice.drop(msg.user_id);
    if (msg.user_id !== state.me.id && inThisCall(leftChannel)) {
      playCallSfx("leave");
    }
    render();
  } else if (msg.type === "voice_state") {
    if (state.voiceStates[msg.user_id]) {
      state.voiceStates[msg.user_id].muted = msg.muted;
      state.voiceStates[msg.user_id].deafened = msg.deafened;
    }
    render();
  } else if (msg.type === "webrtc_offer") {
    voice.onOffer(msg.from_id, msg.sdp);
  } else if (msg.type === "webrtc_answer") {
    voice.onAnswer(msg.from_id, msg.sdp);
  } else if (msg.type === "webrtc_ice") {
    voice.onIce(msg.from_id, msg.candidate);
  }
}

voice.onSpeaking = () => {
  document.querySelectorAll("[data-speak]").forEach((el) => {
    const id = el.dataset.speak;
    const on = id === "me" ? voice.speaking.has("me") : voice.speaking.has(Number(id));
    el.classList.toggle("speaking", on);
  });
};

function render() {
  renderServers();
  renderUser();
  renderVoiceBar();
  if (state.view === "dm") {
    renderHomeSidebar();
    $("friends-view").classList.add("hidden");
    $("voice-view").classList.add("hidden");
    $("chat-view").classList.remove("hidden");
    $("app").classList.add("no-members");
    if (state.channel) {
      $("topbar").innerHTML = `<span>@ ${state.channel.peer.display_name}</span><span class="muted grow">mensagem direta</span>`;
      $("composer-input").placeholder = `Mensagem para @${state.channel.peer.username}`;
    }
  } else if (state.view === "home") {
    renderHomeSidebar();
    renderFriends();
    $("chat-view").classList.add("hidden");
    $("voice-view").classList.add("hidden");
    $("friends-view").classList.remove("hidden");
    $("app").classList.add("no-members");
  } else {
    renderServerSidebar();
    renderMembers();
    $("friends-view").classList.add("hidden");
    $("app").classList.remove("no-members");
    if (state.channel && state.channel.type === "voice") {
      $("chat-view").classList.add("hidden");
      $("voice-view").classList.remove("hidden");
      renderVoiceRoom();
    } else {
      $("voice-view").classList.add("hidden");
      $("chat-view").classList.remove("hidden");
    }
  }
}

function renderServers() {
  $("server-list").innerHTML = state.servers.map((s) => `
    <button class="server-btn ${state.serverId === s.id ? "active" : ""}" data-server="${s.id}" title="${s.name}" ${state.serverId === s.id ? `style="background:${s.icon_color}"` : ""} type="button">
      <span class="pill"></span>${initials(s.name)}
    </button>
  `).join("");
  $("home-btn").classList.toggle("active", state.view === "home" || state.view === "dm");
  $("server-list").querySelectorAll("[data-server]").forEach((btn) => {
    btn.onclick = () => openServer(Number(btn.dataset.server));
  });
}

$("home-btn").onclick = () => {
  state.view = "home";
  state.serverId = null;
  state.channel = null;
  render();
};

function renderUser() {
  const me = state.me;
  const status = voice.channelId ? "Na call" : "Online";
  $("user-panel").innerHTML = `
    <button class="user-card" id="user-card" type="button">
      <div class="avatar-wrap">${avatar(me)}<i class="status-dot ${voice.channelId ? "call" : ""}"></i></div>
      <div class="user-meta">
        <b>${esc(me.display_name)}</b>
        <small class="${voice.channelId ? "in-call" : ""}">${status}</small>
      </div>
    </button>
    <div class="user-controls">
      <button class="icon-btn ${voice.muted ? "on" : ""}" id="mute-btn" title="${voice.muted ? "Ativar microfone" : "Silenciar"}">${micIcon(voice.muted)}</button>
      <button class="icon-btn ${voice.deafened ? "on" : ""}" id="deaf-btn" title="${voice.deafened ? "Ouvir de novo" : "Ensurdecer"}">${deafIcon(voice.deafened)}</button>
      <button class="icon-btn" id="settings-btn" title="Configurações">${gearIcon()}</button>
    </div>
  `;
  $("user-card").onclick = showSettings;
  $("mute-btn").onclick = () => {
    toggleMute();
    renderUser();
    renderVoiceBar();
  };
  $("deaf-btn").onclick = () => {
    toggleDeafen();
    renderUser();
    renderVoiceBar();
  };
  $("settings-btn").onclick = showSettings;
}

function gearIcon() {
  return `<svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M19.1 12.9a7.6 7.6 0 0 0 .1-.9 7.6 7.6 0 0 0-.1-.9l2.1-1.6-2-3.4-2.5 1a7.3 7.3 0 0 0-1.6-.9l-.4-2.6h-4l-.4 2.6a7.3 7.3 0 0 0-1.6.9l-2.5-1-2 3.4 2.1 1.6a7.6 7.6 0 0 0-.1.9 7.6 7.6 0 0 0 .1.9L2.9 14.5l2 3.4 2.5-1a7.3 7.3 0 0 0 1.6.9l.4 2.6h4l.4-2.6a7.3 7.3 0 0 0 1.6-.9l2.5 1 2-3.4-2.1-1.6ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"/></svg>`;
}

function showSettings() {
  SettingsUI.open("profile");
}

function micIcon(on) {
  return on
    ? `<svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M19 11c0 1.2-.3 2.3-.8 3.3l-1.5-1.5c.2-.6.3-1.2.3-1.8v-1h2v1ZM4.3 3 21 19.7 19.7 21l-4.3-4.3A7 7 0 0 1 5 11H7c0 2.8 2.2 5 5 5 .5 0 1-.1 1.4-.2L11 13.4A3 3 0 0 1 9 10.2V10H4.3L3 8.7 4.3 3Zm7.7 2a3 3 0 0 1 3 3v.6l-6-6c.9-.4 1.9-.6 3-.6Z"/></svg>`
    : `<svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2Z"/></svg>`;
}

function sfxIcon(on) {
  return on
    ? `<svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M3 10v4h4l5 5V5L7 10H3Zm13.5 2A4.5 4.5 0 0 0 14 8.2v7.6A4.5 4.5 0 0 0 16.5 12ZM14 3.2v2.1c2.9.9 5 3.5 5 6.7s-2.1 5.8-5 6.7v2.1c4-.9 7-4.5 7-8.8s-3-7.9-7-8.8Z"/></svg>`
    : `<svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M16.5 12c0-1.8-1-3.3-2.5-4v2.2l2.5 2.5V12Zm2.5 6.1-1.4 1.4-2.1-2.1A7 7 0 0 1 14 18.9v2.1A9 9 0 0 0 18.1 17l.9 1.1ZM4.3 3 3 4.3 7.7 9H3v6h4l5 5v-6.7l4.7 4.7 1.3-1.3L4.3 3ZM14 8.2 12 6.2V4L9.8 6.2 14 10.4V8.2Z"/></svg>`;
}

function deafIcon(on) {
  return on
    ? `<svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M3 10v4h4l5 5V5L7 10H3Zm13.5 2c0-1.8-1-3.3-2.5-4v8c1.5-.7 2.5-2.2 2.5-4ZM14 3.2v2.1A7 7 0 0 1 19 12a7 7 0 0 1-2.1 5l1.5 1.5A9 9 0 0 0 21 12c0-4.3-3-7.9-7-8.8Z"/></svg>`
    : `<svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3Zm13.5 3A4.5 4.5 0 0 0 14 8.2v7.6A4.5 4.5 0 0 0 16.5 12ZM14 3.2v2.1c2.9.9 5 3.5 5 6.7s-2.1 5.8-5 6.7v2.1c4-.9 7-4.5 7-8.8s-3-7.9-7-8.8Z"/></svg>`;
}

function renderVoiceBar() {
  const bar = $("voice-bar");
  if (!voice.channelId) {
    bar.classList.add("hidden");
    return;
  }
  const channel = [...state.channels, ...findVoiceChannels()].find((c) => c.id === voice.channelId);
  bar.classList.remove("hidden");
  bar.innerHTML = `
    <strong>Conectado</strong>
    <span>${channel ? channel.name : "Voz"}</span>
    <div class="voice-actions">
      <button class="icon-btn ${voice.muted ? "on" : ""}" id="v-mute">${micIcon(voice.muted)}</button>
      <button class="icon-btn danger" id="v-leave">⏏</button>
    </div>
  `;
  $("v-mute").onclick = () => { toggleMute(); render(); };
  $("v-leave").onclick = async () => { await leaveCall(); render(); };
}

function findVoiceChannels() {
  return state.channels.filter((c) => c.type === "voice");
}

function renderHomeSidebar() {
  $("sidebar-head").textContent = "Amigos";
  $("sidebar-scroll").innerHTML = `
    <button class="channel ${state.view === "home" ? "active" : ""}" id="friends-nav" type="button">Amigos</button>
    <div class="cat">MENSAGENS DIRETAS</div>
    ${state.dms.map((dm) => `
      <button class="channel ${state.channel && state.channel.id === dm.id ? "active" : ""}" data-dm="${dm.id}" type="button">
        ${avatar(dm.peer, "mini")} ${dm.peer.display_name}
      </button>
    `).join("") || `<p class="empty" style="padding:8px">Nenhuma conversa ainda.</p>`}
  `;
  const friendsNav = $("friends-nav");
  if (friendsNav) {
    friendsNav.onclick = () => {
      state.view = "home";
      state.channel = null;
      render();
    };
  }
  $("sidebar-scroll").querySelectorAll("[data-dm]").forEach((btn) => {
    btn.onclick = () => openDm(Number(btn.dataset.dm));
  });
  $("topbar").innerHTML = `<span>Amigos</span><span class="muted grow">Adicione pelo nome de usuário ou envie um convite.</span>
    <button class="btn primary" id="invite-home">Convidar</button>`;
  $("invite-home").onclick = () => showInvitePicker();
}

function renderFriends() {
  const { accepted, incoming, outgoing } = state.friends;
  const onlineCount = accepted.filter((f) => state.online.has(f.id)).length;
  $("friends-view").innerHTML = `
    <div class="home-hero">
      <div>
        <p class="eyebrow">Início</p>
        <h2>Amigos</h2>
        <p class="lead">Adicione alguém pelo usuário ou copie o link da sua sala.</p>
      </div>
      <button class="btn primary" id="invite-big">Convidar</button>
    </div>
    <div class="stat-row">
      <div class="stat"><b>${state.servers.length}</b><span>servidores</span></div>
      <div class="stat"><b>${accepted.length}</b><span>amigos</span></div>
      <div class="stat"><b>${onlineCount}</b><span>online agora</span></div>
    </div>
    <div class="row">
      <input id="friend-name" placeholder="Usuário do amigo (ex: lucas)" />
      <button class="btn" id="add-friend">Adicionar amigo</button>
    </div>
    <h3 style="margin:8px 0;color:var(--muted);font-size:12px;letter-spacing:.06em">PEDIDOS</h3>
    <div class="card-list">
      ${incoming.map((p) => `
        <div class="person">${avatar(p)}<div class="grow"><b>${p.display_name}</b><small>@${p.username} te adicionou</small></div>
          <button class="btn green" data-accept="${p.friendship_id}">Aceitar</button>
          <button class="btn ghost" data-decline="${p.friendship_id}">Recusar</button>
        </div>`).join("")}
      ${outgoing.map((p) => `
        <div class="person">${avatar(p)}<div class="grow"><b>${p.display_name}</b><small>pedido enviado</small></div></div>`).join("")}
      ${!incoming.length && !outgoing.length ? `<p class="empty">Nenhum pedido pendente.</p>` : ""}
    </div>
    <h3 style="margin:18px 0 8px;color:var(--muted);font-size:12px;letter-spacing:.06em">ONLINE — ${accepted.filter((f) => state.online.has(f.id)).length}</h3>
    <div class="card-list">
      ${accepted.map((p) => `
        <div class="person">${avatar(p)}<div class="grow"><b>${p.display_name}</b><small>${state.online.has(p.id) ? "online" : "offline"} · @${p.username}</small></div>
          <button class="btn" data-msg="${p.id}">Mensagem</button>
        </div>`).join("") || `<p class="empty">Sem amigos ainda. Manda o link da sala — eles entram e vocês se encontram lá.</p>`}
    </div>
  `;
  $("add-friend").onclick = async () => {
    const username = $("friend-name").value.trim();
    if (!username) return;
    try {
      await api("/api/friends", { method: "POST", body: { username } });
      await refreshAll();
      render();
      toast("Pedido enviado.");
    } catch (err) { toast(err.message); }
  };
  $("invite-big").onclick = () => showInvitePicker();
  $("friends-view").querySelectorAll("[data-accept]").forEach((b) => {
    b.onclick = async () => {
      await api(`/api/friends/${b.dataset.accept}/accept`, { method: "POST" });
      await refreshAll();
      render();
    };
  });
  $("friends-view").querySelectorAll("[data-decline]").forEach((b) => {
    b.onclick = async () => {
      await api(`/api/friends/${b.dataset.decline}/decline`, { method: "POST" });
      await refreshAll();
      render();
    };
  });
  $("friends-view").querySelectorAll("[data-msg]").forEach((b) => {
    b.onclick = async () => {
      const dm = await api("/api/dms", { method: "POST", body: { user_id: Number(b.dataset.msg) } });
      await refreshAll();
      openDm(dm.id);
    };
  });
}

function showInvitePicker() {
  if (!state.servers.length) {
    toast("Crie um servidor primeiro.");
    return showAddServer();
  }
  const options = state.servers.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");
  openModal(`
    <h2>Chamar os amigos</h2>
    <p>Envie este link. Seus amigos criam a conta e entram na sala.</p>
    <label>Qual sala<select id="inv-server">${options}</select></label>
    <div class="invite-box" id="inv-link"></div>
    <div class="modal-actions">
      <button class="btn ghost" id="close-m">Fechar</button>
      <button class="btn primary" id="copy-inv">Copiar link</button>
    </div>
  `);
  const pick = () => {
    const server = state.servers.find((s) => s.id === Number($("inv-server").value));
    $("inv-link").textContent = inviteLink(server.invite_code);
  };
  $("inv-server").onchange = pick;
  pick();
  $("close-m").onclick = closeModal;
  $("copy-inv").onclick = async () => {
    await copyText($("inv-link").textContent);
    toast("Link copiado. Manda no Zap.");
  };
}

$("add-server-btn").onclick = showAddServer;

function showAddServer() {
  openModal(`
    <h2>Servidor</h2>
    <p>Crie um servidor ou entre com um convite.</p>
    <label>Nome<input id="new-server-name" placeholder="Ex: Jogos da sexta" /></label>
    <button class="btn primary full" id="create-server">Criar servidor</button>
    <p style="margin:16px 0 8px;text-align:center">ou</p>
    <label>Convite<input id="join-code" placeholder="Código ou link" /></label>
    <div class="modal-actions">
      <button class="btn ghost" id="close-m">Fechar</button>
      <button class="btn green" id="join-server">Entrar na sala</button>
    </div>
  `);
  $("close-m").onclick = closeModal;
  $("create-server").onclick = async () => {
    const name = $("new-server-name").value.trim();
    if (name.length < 2) return toast("Dá um nome pra sala.");
    const server = await api("/api/servers", { method: "POST", body: { name } });
    await refreshAll();
    closeModal();
    openServer(server.id);
    showInvitePicker();
  };
  $("join-server").onclick = async () => {
    let code = $("join-code").value.trim();
    const match = code.match(/invite=([A-Za-z0-9]+)/);
    if (match) code = match[1];
    try {
      const server = await api("/api/servers/join", { method: "POST", body: { invite_code: code } });
      await refreshAll();
      closeModal();
      openServer(server.id);
    } catch (err) { toast(err.message); }
  };
}

async function openServer(id) {
  state.view = "server";
  state.serverId = id;
  state.channels = await api(`/api/servers/${id}/channels`);
  state.members = await api(`/api/servers/${id}/members`);
  const firstText = state.channels.find((c) => c.type === "text");
  if (firstText) await openChannel(firstText);
  else render();
}

function renderServerSidebar() {
  const server = state.servers.find((s) => s.id === state.serverId);
  $("sidebar-head").textContent = server ? server.name : "Servidor";
  const texts = state.channels.filter((c) => c.type === "text");
  const voices = state.channels.filter((c) => c.type === "voice");
  const owner = server && state.me && server.owner_id === state.me.id;
  $("sidebar-scroll").innerHTML = `
    <div class="cat">CANAIS DE TEXTO ${owner ? `<button id="add-text" type="button">+</button>` : ""}</div>
    ${texts.map(channelBtn).join("")}
    <div class="cat">CANAIS DE VOZ ${owner ? `<button id="add-voice" type="button">+</button>` : ""}</div>
    ${voices.map((c) => channelBtn(c) + voiceOccupants(c.id)).join("")}
  `;
  $("sidebar-scroll").querySelectorAll("[data-ch]").forEach((btn) => {
    btn.onclick = () => openChannel(state.channels.find((c) => c.id === Number(btn.dataset.ch)));
  });
  const addText = $("add-text");
  const addVoice = $("add-voice");
  if (addText) addText.onclick = () => promptChannel("text");
  if (addVoice) addVoice.onclick = () => promptChannel("voice");
}

function channelBtn(c) {
  const active = state.channel && state.channel.id === c.id;
  const icon = c.type === "voice" ? "🔊" : "#";
  return `<button class="channel ${active ? "active" : ""}" data-ch="${c.id}" type="button"><span class="hash">${icon}</span>${c.name}</button>`;
}

function voiceOccupants(channelId) {
  const people = state.members.filter((m) => state.voiceStates[m.id]?.channel_id === channelId);
  if (!people.length) return "";
  return `<div class="voice-users">${people.map((p) => `
    <div class="voice-user" data-speak="${p.id === state.me.id ? "me" : p.id}">${avatar(p, "mini")} ${p.display_name}</div>
  `).join("")}</div>`;
}

function promptChannel(type) {
  openModal(`
    <h2>Novo canal de ${type === "voice" ? "voz" : "texto"}</h2>
    <label>Nome<input id="ch-name" placeholder="${type === "voice" ? "Ranked" : "memes"}" /></label>
    <div class="modal-actions">
      <button class="btn ghost" id="close-m">Cancelar</button>
      <button class="btn primary" id="mk-ch">Criar</button>
    </div>
  `);
  $("close-m").onclick = closeModal;
  $("mk-ch").onclick = async () => {
    const name = $("ch-name").value.trim();
    if (!name) return;
    await api(`/api/servers/${state.serverId}/channels`, { method: "POST", body: { name, type } });
    state.channels = await api(`/api/servers/${state.serverId}/channels`);
    closeModal();
    render();
  };
}

async function openChannel(channel) {
  state.channel = channel;
  const server = state.servers.find((s) => s.id === state.serverId);
  if (channel.type === "voice") {
    $("topbar").innerHTML = `<span>🔊 ${channel.name}</span><span class="muted grow">Você está neste canal de voz.</span>
      <button class="btn primary" id="top-invite">Convidar</button>`;
    $("top-invite").onclick = showInvitePicker;
    if (voice.channelId !== channel.id) send({ type: "voice_join", channel_id: channel.id });
    render();
    return;
  }
  state.messages = await api(`/api/channels/${channel.id}/messages`);
  $("topbar").innerHTML = `<span># ${channel.name}</span><span class="muted grow">${server ? server.name : ""}</span>
    <button class="btn primary" id="top-invite">Convidar</button>`;
  $("top-invite").onclick = showInvitePicker;
  $("composer-input").placeholder = `Conversar em #${channel.name}`;
  render();
  renderMessages(true);
}

async function openDm(id) {
  if (!state.dms.find((d) => d.id === id)) await refreshAll();
  const channel = state.dms.find((d) => d.id === id);
  if (!channel) return;
  state.view = "dm";
  state.serverId = null;
  state.channel = channel;
  state.messages = await api(`/api/channels/${id}/messages`);
  render();
  renderMessages(true);
}

function renderMessages(stick) {
  const box = $("messages");
  if (!state.channel) return;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  const title = state.channel.type === "dm" ? state.channel.peer.display_name : state.channel.name;
  let html = `<div class="welcome"><div class="avatar" style="width:68px;height:68px;font-size:26px;background:${state.channel.type === "dm" ? state.channel.peer.avatar_color : "#4f6ef7"}">${initials(title)}</div>
    <h2>${state.channel.type === "dm" ? title : "Bem-vindo a #" + title}</h2>
    <p>${state.channel.type === "dm" ? "Começo da conversa." : "Este é o início do canal."}</p></div>`;
  let lastDay = "";
  let lastAuthor = null;
  let lastTime = 0;
  for (const msg of state.messages) {
    const date = new Date(msg.created_at);
    const day = date.toLocaleDateString("pt-BR");
    if (day !== lastDay) {
      html += `<div class="day-sep">${day}</div>`;
      lastDay = day;
      lastAuthor = null;
    }
    const grouped = lastAuthor === msg.author.id && date.getTime() - lastTime < 7 * 60 * 1000;
    html += `<article class="msg ${grouped ? "grouped" : ""}">
      ${avatar(msg.author)}
      <div class="msg-body">
        ${grouped ? "" : `<b>${esc(msg.author.display_name)}</b><time>${date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</time>`}
        <p>${esc(msg.content)}</p>
      </div>
    </article>`;
    lastAuthor = msg.author.id;
    lastTime = date.getTime();
  }
  box.innerHTML = html;
  if (stick || nearBottom) box.scrollTop = box.scrollHeight;
}

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderTyping() {
  const names = [...typingUsers.values()];
  $("typing").textContent = names.length ? `${names.join(", ")} digitando...` : "";
}

$("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("composer-input");
  const content = input.value.trim();
  if (!content || !state.channel) return;
  send({ type: "message", channel_id: state.channel.id, content });
  input.value = "";
});

$("composer-input").addEventListener("input", () => {
  if (!state.channel) return;
  const now = Date.now();
  if (!typingTimer || now - typingTimer > 1500) {
    send({ type: "typing", channel_id: state.channel.id });
    typingTimer = now;
  }
});

function renderMembers() {
  const online = state.members.filter((m) => state.online.has(m.id) || m.id === state.me.id);
  const offline = state.members.filter((m) => !online.includes(m));
  $("members-panel").innerHTML = `
    <h3>ONLINE — ${online.length}</h3>
    ${online.map((m) => `<div class="member">${avatar(m, "mini")}<span>${m.display_name}</span></div>`).join("")}
    <h3>OFFLINE — ${offline.length}</h3>
    ${offline.map((m) => `<div class="member off">${avatar(m, "mini")}<span>${m.display_name}</span></div>`).join("")}
  `;
}

function renderVoiceRoom() {
  const channel = state.channel;
  const people = state.members.filter((m) => state.voiceStates[m.id]?.channel_id === channel.id);
  if (!people.find((p) => p.id === state.me.id) && voice.channelId === channel.id) {
    people.unshift(state.me);
  }
  $("voice-view").innerHTML = `
    <h2>🔊 ${channel.name}</h2>
    <p class="lead">Quem estiver neste canal consegue te ouvir. Permita o microfone quando o navegador pedir.</p>
    <div class="tiles">
      ${people.map((p) => {
        const vs = state.voiceStates[p.id] || {};
        return `<div class="tile" data-speak="${p.id === state.me.id ? "me" : p.id}">
          ${avatar(p)}<b>${p.display_name}</b>
          <small>${vs.muted ? "microfone off" : "na call"}</small>
        </div>`;
      }).join("") || `<p class="empty">Ninguém na call ainda. Entra e espera a galera.</p>`}
    </div>
  `;
}

/* ---------- boot ---------- */
bootInviteBanner();
(async function boot() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    showLogin(true);
    return;
  }
  try {
    state.me = await api("/api/auth/me");
    await startApp();
  } catch (_) {
    localStorage.removeItem(TOKEN_KEY);
    showLogin(true);
  }
})();
