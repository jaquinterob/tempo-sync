(() => {
  const STORAGE_KEY = "pulpit-admin-token";
  const REFRESH_MS = 3000;

  const loginCard = document.querySelector("#login-card");
  const loginForm = document.querySelector("#login-form");
  const adminUser = document.querySelector("#admin-user");
  const adminPassword = document.querySelector("#admin-password");
  const loginError = document.querySelector("#login-error");

  const adminPanel = document.querySelector("#admin-panel");
  const refreshButton = document.querySelector("#refresh-button");
  const logoutButton = document.querySelector("#logout-button");
  const autoRefresh = document.querySelector("#auto-refresh");
  const panelError = document.querySelector("#panel-error");
  const connectionsBody = document.querySelector("#connections-body");
  const roomsList = document.querySelector("#rooms-list");
  const adminStatus = document.querySelector("#admin-status");
  const towerClock = document.querySelector("#tower-clock");
  const towerUpdated = document.querySelector("#tower-updated");

  const statUptime = document.querySelector("#stat-uptime");
  const statEnv = document.querySelector("#stat-env");
  const statSockets = document.querySelector("#stat-sockets");
  const statEngine = document.querySelector("#stat-engine");
  const statRoles = document.querySelector("#stat-roles");
  const statRooms = document.querySelector("#stat-rooms");
  const statMemory = document.querySelector("#stat-memory");
  const statWarmup = document.querySelector("#stat-warmup");
  const statWarmupDetail = document.querySelector("#stat-warmup-detail");
  const roomsCount = document.querySelector("#rooms-count");
  const sessionsCount = document.querySelector("#sessions-count");
  const warmupCount = document.querySelector("#warmup-count");
  const warmupBody = document.querySelector("#warmup-body");
  const statRoomsDetail = document.querySelector("#stat-rooms-detail");
  const purgeInactiveButton = document.querySelector("#purge-inactive-button");

  let token = null;
  try {
    token = localStorage.getItem(STORAGE_KEY);
  } catch {
    token = null;
  }

  let refreshTimer = null;
  let clockTimer = null;

  function setToken(nextToken) {
    token = nextToken;
    try {
      if (nextToken) localStorage.setItem(STORAGE_KEY, nextToken);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // sin localStorage
    }
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set("Content-Type", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const response = await fetch(path, { ...options, headers });
    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (!response.ok) {
      const error = new Error(data.error || "Error de conexión con el servidor.");
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function formatDuration(ms) {
    const total = Math.max(0, Math.floor(Number(ms) / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }

  function formatClock(ms) {
    const total = Math.max(0, Math.ceil(Number(ms) / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function roleLabel(role) {
    if (role === "control") return "Control";
    if (role === "display") return "Display";
    return "Idle";
  }

  function formatRelative(iso) {
    if (!iso) return "—";
    const then = Date.parse(iso);
    if (!Number.isFinite(then)) return "—";
    const deltaSec = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (deltaSec < 5) return "ahora";
    if (deltaSec < 60) return `hace ${deltaSec}s`;
    if (deltaSec < 3600) return `hace ${Math.floor(deltaSec / 60)}m`;
    return `hace ${Math.floor(deltaSec / 3600)}h`;
  }

  function shortUa(ua) {
    const value = String(ua || "").trim();
    if (!value) return "—";
    if (/pulpit|keep-?alive/i.test(value)) return "Keep-alive";
    if (/iPhone|iPad/i.test(value)) return "iOS";
    if (/Android/i.test(value)) return "Android";
    if (/Chrome/i.test(value)) return "Chrome";
    if (/Safari/i.test(value)) return "Safari";
    if (/Firefox/i.test(value)) return "Firefox";
    if (/curl|node-fetch|undici|axios/i.test(value)) return "Bot/script";
    return value.slice(0, 28);
  }

  function tickClock() {
    if (!towerClock) return;
    towerClock.textContent = new Date().toLocaleTimeString("es-CO", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function showLogin() {
    stopRefresh();
    document.body.classList.add("is-gate");
    loginCard.hidden = false;
    loginCard.style.display = "";
    adminPanel.hidden = true;
    adminPanel.classList.add("is-hidden");
    adminStatus.textContent = "Bloqueado";
    adminStatus.classList.add("is-locked");
    adminStatus.classList.remove("is-live");
  }

  function showPanel() {
    document.body.classList.remove("is-gate");
    loginCard.hidden = true;
    loginCard.style.display = "none";
    adminPanel.hidden = false;
    adminPanel.classList.remove("is-hidden");
    adminStatus.textContent = "En vivo";
    adminStatus.classList.add("is-live");
    adminStatus.classList.remove("is-locked");
    loadTower();
    syncRefreshTimer();
  }

  function stopRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  function syncRefreshTimer() {
    stopRefresh();
    if (!autoRefresh?.checked || adminPanel.hidden) return;
    refreshTimer = setInterval(loadTower, REFRESH_MS);
  }

  function renderRooms(rooms) {
    const inactiveCount = rooms.filter((room) => room.inactive).length;
    roomsCount.textContent = String(rooms.length);
    if (purgeInactiveButton) {
      purgeInactiveButton.disabled = inactiveCount === 0;
      purgeInactiveButton.title =
        inactiveCount === 0
          ? "No hay salas inactivas"
          : `Eliminar ${inactiveCount} sala${inactiveCount === 1 ? "" : "s"} sin sockets`;
    }
    roomsList.innerHTML = "";

    if (rooms.length === 0) {
      const empty = document.createElement("p");
      empty.className = "tower-empty";
      empty.textContent = "No hay salas en memoria.";
      roomsList.appendChild(empty);
      return;
    }

    for (const room of rooms) {
      const card = document.createElement("article");
      card.className = `tower-room${room.inactive ? " is-inactive" : ""}`;

      const top = document.createElement("div");
      top.className = "tower-room-top";

      const pin = document.createElement("strong");
      pin.className = "tower-room-pin";
      pin.textContent = room.pin;

      const meta = document.createElement("div");
      meta.className = "tower-room-meta";

      if (room.inactive) {
        const inactive = document.createElement("span");
        inactive.className = "tower-badge is-inactive";
        inactive.textContent = "Inactiva";
        meta.appendChild(inactive);
      }

      const state = document.createElement("span");
      state.className = `tower-badge${room.isRunning ? " is-running" : ""}`;
      state.textContent = room.isRunning ? "En curso" : "En espera";
      meta.appendChild(state);

      if (room.isBlank) {
        const blank = document.createElement("span");
        blank.className = "tower-badge is-blank";
        blank.textContent = "Pantalla oculta";
        meta.appendChild(blank);
      }

      top.appendChild(pin);
      top.appendChild(meta);

      const grid = document.createElement("div");
      grid.className = "tower-room-grid";

      const cells = [
        ["Unidad", room.wardName || "—"],
        ["Restante", formatClock(room.remainingMs)],
        ["Duración", formatClock(room.durationMs)],
        ["Edad", room.ageMs != null ? formatDuration(room.ageMs) : "—"],
        ["Sockets", `${room.sockets} · ${room.controls}C / ${room.displays}D`],
        ["Tema", room.theme === "dark" ? "Oscuro" : "Claro"],
        ["Revisión", String(room.revision ?? 0)],
        ["Mensaje", room.message ? room.message : "—"],
      ];

      for (const [label, value] of cells) {
        const cell = document.createElement("div");
        const span = document.createElement("span");
        span.textContent = label;
        const strong = document.createElement("strong");
        strong.textContent = value;
        strong.title = value;
        cell.appendChild(span);
        cell.appendChild(strong);
        grid.appendChild(cell);
      }

      const foot = document.createElement("div");
      foot.className = "tower-room-foot";

      const details = document.createElement("p");
      details.className = "tower-room-notes";
      const thanks = room.finishThanks || "—";
      const done = room.finishDone || "—";
      details.textContent = `Cierre: “${thanks}” · “${done}”`;
      details.title = details.textContent;

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "tower-kick";
      deleteButton.textContent = room.inactive ? "Eliminar" : "Cerrar sala";
      deleteButton.addEventListener("click", () => deleteRoom(room.pin, room.inactive, deleteButton));

      foot.append(details, deleteButton);

      card.appendChild(top);
      card.appendChild(grid);
      card.appendChild(foot);
      roomsList.appendChild(card);
    }

    window.PulpitIcons?.createIcons?.(roomsList);
  }

  function renderConnections(connections) {
    sessionsCount.textContent = String(connections.length);
    connectionsBody.innerHTML = "";

    if (connections.length === 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 6;
      cell.className = "tower-empty";
      cell.textContent = "No hay sesiones socket activas.";
      row.appendChild(cell);
      connectionsBody.appendChild(row);
      return;
    }

    for (const connection of connections) {
      const row = document.createElement("tr");

      const pinCell = document.createElement("td");
      pinCell.className = "mono";
      pinCell.textContent = connection.pin || "—";

      const roleCell = document.createElement("td");
      const role = document.createElement("span");
      role.className = `tower-role${
        connection.role === "control"
          ? " is-control"
          : connection.role === "display"
            ? " is-display"
            : ""
      }`;
      role.textContent = roleLabel(connection.role);
      roleCell.appendChild(role);

      const addressCell = document.createElement("td");
      addressCell.className = "mono";
      addressCell.textContent = connection.address || "—";

      const timeCell = document.createElement("td");
      timeCell.className = "mono";
      timeCell.textContent = formatDuration(connection.connectedForMs);

      const idCell = document.createElement("td");
      idCell.className = "mono socket-id";
      idCell.title = connection.id;
      idCell.textContent = connection.id;

      const actionCell = document.createElement("td");
      const kickButton = document.createElement("button");
      kickButton.type = "button";
      kickButton.className = "tower-kick";
      kickButton.textContent = "Expulsar";
      kickButton.addEventListener("click", () => kickConnection(connection.id, kickButton));
      actionCell.appendChild(kickButton);

      row.append(pinCell, roleCell, addressCell, timeCell, idCell, actionCell);
      connectionsBody.appendChild(row);
    }
  }

  function renderTower(data) {
    const server = data.server || {};
    const socket = data.socket || {};
    const rooms = data.rooms || [];
    const connections = data.connections || [];

    statUptime.textContent = formatDuration((server.uptimeSec || 0) * 1000);
    statEnv.textContent = server.env || "—";
    statSockets.textContent = String(socket.sockets ?? 0);
    statEngine.textContent = `engine ${socket.engineClients ?? "—"}`;
    statRoles.textContent = `${socket.controls ?? 0} / ${socket.displays ?? 0}`;
    const inactiveRooms = rooms.filter((room) => room.inactive).length;
    const activeRooms = rooms.length - inactiveRooms;
    statRooms.textContent = String(socket.roomsTracked ?? rooms.length);
    if (statRoomsDetail) {
      statRoomsDetail.textContent = `${activeRooms} activas · ${inactiveRooms} inactivas · mem ${
        server.memory?.heapUsedMb ?? "—"
      } MB`;
    }
    if (statMemory) {
      statMemory.textContent = `mem ${server.memory?.heapUsedMb ?? "—"} MB`;
    }

    towerUpdated.textContent = `Actualizado ${new Date(
      data.generatedAt || Date.now(),
    ).toLocaleTimeString("es-CO")}`;

    const warmup = data.warmup || {};
    const recentWarm = Array.isArray(warmup.recent) ? warmup.recent : [];
    if (statWarmup) statWarmup.textContent = String(warmup.total ?? 0);
    if (statWarmupDetail) {
      statWarmupDetail.textContent = warmup.lastAt
        ? `último ${formatRelative(warmup.lastAt)}`
        : "sin pings aún";
    }
    if (warmupCount) warmupCount.textContent = String(recentWarm.length);
    renderWarmups(recentWarm);

    renderRooms(rooms);
    renderConnections(connections);
  }

  function renderWarmups(entries) {
    if (!warmupBody) return;
    warmupBody.replaceChildren();

    if (!entries.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 3;
      cell.className = "tower-empty";
      cell.textContent = "Sin pings warm todavía.";
      row.appendChild(cell);
      warmupBody.appendChild(row);
      return;
    }

    for (const entry of entries) {
      const row = document.createElement("tr");

      const time = document.createElement("td");
      time.className = "mono";
      time.textContent = new Date(entry.at).toLocaleTimeString("es-CO", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      time.title = formatRelative(entry.at);

      const ip = document.createElement("td");
      ip.className = "mono";
      ip.textContent = entry.ip || "—";

      const client = document.createElement("td");
      client.textContent = shortUa(entry.ua);
      client.title = entry.ua || "";

      row.append(time, ip, client);
      warmupBody.appendChild(row);
    }
  }

  async function loadTower() {
    panelError.textContent = "";
    try {
      const data = await api("/api/admin/tower");
      renderTower(data);
    } catch (error) {
      if (error.status === 401 || /no autorizado|expir/i.test(String(error.message))) {
        setToken(null);
        showLogin();
        loginError.textContent = "Tu sesión expiró. Vuelve a entrar.";
        return;
      }
      panelError.textContent = error.message;
    }
  }

  async function kickConnection(socketId, button) {
    button.disabled = true;
    panelError.textContent = "";
    try {
      await api("/api/admin/kick", {
        method: "POST",
        body: JSON.stringify({ socketId }),
      });
      await loadTower();
    } catch (error) {
      button.disabled = false;
      panelError.textContent = error.message;
    }
  }

  async function deleteRoom(pin, inactive, button) {
    const confirmText = inactive
      ? `¿Eliminar la sala inactiva ${pin}?`
      : `La sala ${pin} tiene sesiones activas. ¿Expulsar a todos y cerrarla?`;
    if (!window.confirm(confirmText)) return;

    button.disabled = true;
    panelError.textContent = "";
    try {
      await api("/api/admin/rooms/delete", {
        method: "POST",
        body: JSON.stringify({ pin }),
      });
      await loadTower();
    } catch (error) {
      button.disabled = false;
      panelError.textContent = error.message;
    }
  }

  async function purgeInactive() {
    if (!window.confirm("¿Eliminar todas las salas sin sockets conectados?")) return;
    purgeInactiveButton.disabled = true;
    panelError.textContent = "";
    try {
      const result = await api("/api/admin/rooms/purge-inactive", { method: "POST" });
      await loadTower();
      if (result.count === 0) {
        panelError.textContent = "No había salas inactivas.";
      }
    } catch (error) {
      purgeInactiveButton.disabled = false;
      panelError.textContent = error.message;
    }
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginError.textContent = "";
    try {
      const data = await api("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({
          user: adminUser.value.trim(),
          password: adminPassword.value,
        }),
      });
      setToken(data.token);
      adminPassword.value = "";
      showPanel();
    } catch (error) {
      loginError.textContent = error.message;
    }
  });

  refreshButton.addEventListener("click", loadTower);
  purgeInactiveButton?.addEventListener("click", purgeInactive);
  autoRefresh?.addEventListener("change", syncRefreshTimer);

  logoutButton.addEventListener("click", async () => {
    try {
      await api("/api/admin/logout", { method: "POST" });
    } catch {
      // ignore
    }
    setToken(null);
    showLogin();
  });

  tickClock();
  clockTimer = setInterval(tickClock, 1000);

  if (token) showPanel();
  else showLogin();

  window.addEventListener("beforeunload", () => {
    stopRefresh();
    if (clockTimer) clearInterval(clockTimer);
  });
})();
