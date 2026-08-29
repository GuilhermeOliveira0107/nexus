const AVATAR_PALETTE = [
  "#ed4245", "#5865f2", "#57f287", "#fee75c", "#eb459e", "#f47b67",
  "#3ba55c", "#00b0f4", "#ff8c00", "#9b59b6", "#3dffd1", "#7b5cff",
  "#ff3d9a", "#38bdf8", "#f97316", "#14b8a6",
];

const THEMES = {
  aurora: "Azul",
  violet: "Roxo",
  magma: "Vermelho",
  ice: "Ciano",
};

const PREF_DEFAULTS = {
  theme: "aurora",
  reduceMotion: false,
  compact: false,
  sfxJoin: true,
  sfxLeave: true,
  sfxDisconnect: true,
  sfxMessage: true,
  sfxMention: true,
  notifyUnfocusedOnly: true,
  defaultMuted: false,
};

function loadPrefs() {
  try {
    return { ...PREF_DEFAULTS, ...JSON.parse(localStorage.getItem("nexus_prefs") || "{}") };
  } catch (_) {
    return { ...PREF_DEFAULTS };
  }
}

function savePrefs(next) {
  localStorage.setItem("nexus_prefs", JSON.stringify(next));
}

const prefs = loadPrefs();

function applyChrome() {
  document.documentElement.dataset.theme = prefs.theme;
  document.documentElement.classList.toggle("reduce-motion", prefs.reduceMotion);
  document.documentElement.classList.toggle("compact", prefs.compact);
}

const SettingsUI = {
  tab: "profile",
  micTimer: 0,
  micStream: null,

  open(tab) {
    this.tab = tab || this.tab || "profile";
    $("settings").classList.remove("hidden");
    this.drawNav();
    this.draw();
  },

  close() {
    this.stopMic();
    $("settings").classList.add("hidden");
  },

  drawNav() {
    const items = [
      ["profile", "Meu perfil"],
      ["account", "Conta"],
      ["voice", "Voz"],
      ["sounds", "Sons"],
      ["appearance", "Aparência"],
      ["notifications", "Notificações"],
      ["keybinds", "Atalhos"],
      ["about", "Sobre"],
    ];
    $("settings-nav-list").innerHTML = items.map(([id, label]) => `
      <button class="set-nav ${this.tab === id ? "active" : ""}" data-tab="${id}" type="button">${label}</button>
    `).join("");
    $("settings-nav-list").querySelectorAll("[data-tab]").forEach((btn) => {
      btn.onclick = () => {
        this.stopMic();
        this.tab = btn.dataset.tab;
        this.drawNav();
        this.draw();
      };
    });
  },

  draw() {
    const titles = {
      profile: "Meu perfil",
      account: "Conta",
      voice: "Voz",
      sounds: "Sons",
      appearance: "Aparência",
      notifications: "Notificações",
      keybinds: "Atalhos",
      about: "Sobre",
    };
    $("settings-title").textContent = titles[this.tab];
    $("settings-body").innerHTML = this[this.tab]();
    this.bind();
  },

  profile() {
    const me = state.me;
    return `
      <div class="set-hero">
        ${avatar(me, "avatar set-avatar")}
        <div>
          <h3>${esc(me.display_name)}</h3>
          <p>@${esc(me.username)}</p>
        </div>
      </div>
      <label class="set-label">Nome de exibição
        <input id="set-name" maxlength="64" value="${esc(me.display_name)}" />
      </label>
      <p class="set-hint">É assim que seus amigos te veem na call e no chat.</p>
      <p class="set-label">Cor do avatar</p>
      <div class="color-grid" id="color-grid">
        ${AVATAR_PALETTE.map((c) => `
          <button type="button" class="swatch ${me.avatar_color.toLowerCase() === c.toLowerCase() ? "on" : ""}" data-color="${c}" style="background:${c}"></button>
        `).join("")}
      </div>
      <div class="set-actions">
        <button class="btn primary" id="set-save-profile" type="button">Salvar perfil</button>
      </div>
    `;
  },

  account() {
    const me = state.me;
    return `
      <div class="set-card">
        <b>Usuário</b>
        <span>@${esc(me.username)}</span>
        <button class="btn" id="copy-user" type="button">Copiar</button>
      </div>
      <h4>Trocar senha</h4>
      <label class="set-label">Senha atual<input id="pw-now" type="password" autocomplete="current-password" /></label>
      <label class="set-label">Nova senha<input id="pw-new" type="password" autocomplete="new-password" /></label>
      <div class="set-actions">
        <button class="btn" id="set-pw" type="button">Atualizar senha</button>
      </div>
      <div class="set-danger">
        <div>
          <b>Sair da conta</b>
          <p>Desconecta este navegador. A sala na nuvem continua no ar.</p>
        </div>
        <button class="btn danger" id="set-logout" type="button">Sair</button>
      </div>
    `;
  },

  voice() {
    return `
      <div class="set-row">
        <div><b>Microfone</b><p>Silencia o que você envia pra call.</p></div>
        <button class="btn ${voice.muted ? "danger" : ""}" id="set-mute" type="button">${voice.muted ? "Desmutar" : "Silenciar"}</button>
      </div>
      <div class="set-row">
        <div><b>Ensurdecer</b><p>Corta o que você ouve e o que envia.</p></div>
        <button class="btn ${voice.deafened ? "danger" : ""}" id="set-deaf" type="button">${voice.deafened ? "Ouvir de novo" : "Ensurdecer"}</button>
      </div>
      <label class="check-row"><input type="checkbox" id="pref-muted" ${prefs.defaultMuted ? "checked" : ""} /> Entrar na call já silenciado</label>
      <h4>Teste de microfone</h4>
      <p class="set-hint">Fala alguma coisa. A barra sobe se o navegador estiver pegando o áudio.</p>
      <div class="mic-meter"><i id="mic-level"></i></div>
      <div class="set-actions">
        <button class="btn primary" id="mic-test" type="button">Testar microfone</button>
        <button class="btn ghost" id="mic-stop" type="button">Parar</button>
      </div>
    `;
  },

  sounds() {
    const rows = [
      ["sfxJoin", "Entrar na call", "join"],
      ["sfxLeave", "Sair da call", "leave"],
      ["sfxDisconnect", "Você desconectou", "disconnect"],
      ["sfxMessage", "Nova mensagem", "message"],
      ["sfxMention", "Alguém te mencionou", "mention"],
    ];
    return `
      <label class="check-row"><input type="checkbox" id="sfx-master" ${Sfx.enabled ? "checked" : ""} /> Ativar todos os efeitos sonoros</label>
      <label class="set-label">Volume
        <input id="sfx-vol" type="range" min="5" max="100" value="${Math.round(Sfx.master * 100)}" />
      </label>
      <h4>Eventos</h4>
      ${rows.map(([key, label, sound]) => `
        <div class="set-row">
          <label class="check-row"><input type="checkbox" data-pref="${key}" ${prefs[key] ? "checked" : ""} /> ${label}</label>
          <button class="btn" data-preview="${sound}" type="button">Ouvir</button>
        </div>
      `).join("")}
    `;
  },

  appearance() {
    return `
      <p class="set-label">Tema de cor</p>
      <div class="theme-grid">
        ${Object.entries(THEMES).map(([id, name]) => `
          <button class="theme-card ${prefs.theme === id ? "on" : ""}" data-theme="${id}" type="button">
            <i class="theme-dot ${id}"></i>${name}
          </button>
        `).join("")}
      </div>
      <label class="check-row"><input type="checkbox" id="pref-compact" ${prefs.compact ? "checked" : ""} /> Modo compacto</label>
      <label class="check-row"><input type="checkbox" id="pref-motion" ${prefs.reduceMotion ? "checked" : ""} /> Reduzir animações</label>
    `;
  },

  notifications() {
    return `
      <label class="check-row"><input type="checkbox" id="pref-unfocused" ${prefs.notifyUnfocusedOnly ? "checked" : ""} /> Som de mensagem só se eu não estiver olhando o canal</label>
      <p class="set-hint">Se desligar, o ping toca em toda mensagem dos outros, mesmo no canal aberto.</p>
    `;
  },

  keybinds() {
    return `
      <div class="set-card"><b>Esc</b><span>Fecha configurações e janelas</span></div>
      <div class="set-card"><b>Enter</b><span>Envia a mensagem</span></div>
      <div class="set-card"><b>Clique no nome</b><span>Abre estas configurações</span></div>
    `;
  },

  about() {
    return `
      <div class="set-hero">
        <div class="logo-mark">N</div>
        <div>
          <h3>NEXUS</h3>
          <p>Chat e voz no navegador</p>
        </div>
      </div>
      <div class="stat-row">
        <div class="stat"><b>${state.servers.length}</b><span>servidores</span></div>
        <div class="stat"><b>${state.friends.accepted.length}</b><span>amigos</span></div>
        <div class="stat"><b>${state.me.id}</b><span>seu id</span></div>
      </div>
      <p class="set-hint">Mensagens e ligações de voz entre você e seus amigos.</p>
    `;
  },

  bind() {
    const savePref = (key, value) => {
      prefs[key] = value;
      savePrefs(prefs);
      applyChrome();
    };

    const saveProfile = $("set-save-profile");
    if (saveProfile) {
      $("color-grid").querySelectorAll(".swatch").forEach((btn) => {
        btn.onclick = () => {
          $("color-grid").querySelectorAll(".swatch").forEach((s) => s.classList.toggle("on", s === btn));
        };
      });
      saveProfile.onclick = async () => {
        const display_name = $("set-name").value.trim();
        const picked = $("color-grid").querySelector(".swatch.on");
        if (!display_name) return toast("Escreve um nome.");
        try {
          state.me = await api("/api/auth/me", {
            method: "PATCH",
            body: { display_name, avatar_color: picked ? picked.dataset.color : state.me.avatar_color },
          });
          render();
          this.draw();
          toast("Perfil salvo.");
        } catch (err) {
          toast(err.message);
        }
      };
    }

    const copyUser = $("copy-user");
    if (copyUser) {
      copyUser.onclick = async () => {
        await copyText(state.me.username);
        toast("Usuário copiado.");
      };
    }
    const setPw = $("set-pw");
    if (setPw) {
      setPw.onclick = async () => {
        try {
          await api("/api/auth/password", {
            method: "POST",
            body: { current_password: $("pw-now").value, new_password: $("pw-new").value },
          });
          $("pw-now").value = "";
          $("pw-new").value = "";
          toast("Senha atualizada.");
        } catch (err) {
          toast(err.message);
        }
      };
    }
    const logoutBtn = $("set-logout");
    if (logoutBtn) {
      logoutBtn.onclick = async () => {
        try { await api("/api/auth/logout", { method: "POST" }); } catch (_) {}
        localStorage.removeItem(TOKEN_KEY);
        location.href = "/";
      };
    }

    const muteBtn = $("set-mute");
    if (muteBtn) {
      muteBtn.onclick = () => { toggleMute(); renderUser(); this.draw(); };
      $("set-deaf").onclick = () => { toggleDeafen(); renderUser(); this.draw(); };
      $("pref-muted").onchange = (e) => savePref("defaultMuted", e.target.checked);
      $("mic-test").onclick = () => this.startMic();
      $("mic-stop").onclick = () => this.stopMic();
    }

    const master = $("sfx-master");
    if (master) {
      master.onchange = (e) => {
        Sfx.setEnabled(e.target.checked);
        if (Sfx.enabled) Sfx.play("unmute");
        renderUser();
      };
      $("sfx-vol").oninput = (e) => Sfx.setVolume(Number(e.target.value) / 100);
      $("settings-body").querySelectorAll("[data-pref]").forEach((box) => {
        box.onchange = () => savePref(box.dataset.pref, box.checked);
      });
      $("settings-body").querySelectorAll("[data-preview]").forEach((btn) => {
        btn.onclick = () => Sfx.play(btn.dataset.preview);
      });
    }

    const compact = $("pref-compact");
    if (compact) {
      compact.onchange = (e) => savePref("compact", e.target.checked);
      $("pref-motion").onchange = (e) => savePref("reduceMotion", e.target.checked);
      $("settings-body").querySelectorAll("[data-theme]").forEach((btn) => {
        btn.onclick = () => {
          savePref("theme", btn.dataset.theme);
          this.draw();
        };
      });
    }

    const unfocused = $("pref-unfocused");
    if (unfocused) unfocused.onchange = (e) => savePref("notifyUnfocusedOnly", e.target.checked);
  },

  async startMic() {
    this.stopMic();
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(this.micStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const bar = $("mic-level");
      const tick = () => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        if (bar) bar.style.width = `${Math.min(100, avg * 1.8)}%`;
        this.micTimer = requestAnimationFrame(tick);
      };
      this.micTimer = requestAnimationFrame(tick);
      toast("Microfone ligado. Fala pra testar.");
    } catch (err) {
      toast(err.name === "NotAllowedError" ? "Libere o microfone no navegador." : err.message);
    }
  },

  stopMic() {
    if (this.micTimer) cancelAnimationFrame(this.micTimer);
    this.micTimer = 0;
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    const bar = $("mic-level");
    if (bar) bar.style.width = "0%";
  },
};

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!$("settings").classList.contains("hidden")) SettingsUI.close();
    else if (!$("modal").classList.contains("hidden")) closeModal();
  }
});

$("settings-close").onclick = () => SettingsUI.close();
applyChrome();
window.SettingsUI = SettingsUI;
window.prefs = prefs;
