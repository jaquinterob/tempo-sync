(() => {
  const STORAGE_KEY = "pulpit-admin-token";

  const loginCard = document.querySelector("#login-card");
  const loginForm = document.querySelector("#login-form");
  const adminUser = document.querySelector("#admin-user");
  const adminPassword = document.querySelector("#admin-password");
  const loginError = document.querySelector("#login-error");

  const adminPanel = document.querySelector("#admin-panel");
  const refreshButton = document.querySelector("#refresh-button");
  const logoutButton = document.querySelector("#logout-button");
  const panelError = document.querySelector("#panel-error");
  const connectionsBody = document.querySelector("#connections-body");
  const statTotal = document.querySelector("#stat-total");
  const statRooms = document.querySelector("#stat-rooms");
  const adminStatus = document.querySelector("#admin-status");

  let token = localStorage.getItem(STORAGE_KEY);

  function getToken() {
    return token;
  }

  function setToken(nextToken) {
    token = nextToken;
    if (nextToken) {
      localStorage.setItem(STORAGE_KEY, nextToken);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set("Content-Type", "application/json");
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    const response = await fetch(path, { ...options, headers });
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (!response.ok) {
      throw new Error(data.error || "Error de conexión con el servidor.");
    }

    return data;
  }

  function showLogin() {
    loginCard.style.display = "";
    adminPanel.classList.remove("visible");
    adminStatus.textContent = "LOCKED";
    adminStatus.classList.add("status-offline");
    adminStatus.classList.remove("status-online");
  }

  function showPanel() {
    loginCard.style.display = "none";
    adminPanel.classList.add("visible");
    adminStatus.textContent = "ONLINE";
    adminStatus.classList.add("status-online");
    adminStatus.classList.remove("status-offline");
    loadConnections();
  }

  function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }

  function renderConnections(connections) {
    const pins = new Set(connections.map((c) => c.pin).filter(Boolean));
    statTotal.textContent = String(connections.length);
    statRooms.textContent = String(pins.size);

    connectionsBody.innerHTML = "";

    if (connections.length === 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 5;
      cell.className = "empty-state";
      cell.textContent = "No hay conexiones activas en este momento.";
      row.appendChild(cell);
      connectionsBody.appendChild(row);
      return;
    }

    for (const connection of connections) {
      const row = document.createElement("tr");

      const pinCell = document.createElement("td");
      const pinBadge = document.createElement("span");
      pinBadge.className = `pin-badge${connection.pin ? "" : " none"}`;
      pinBadge.textContent = connection.pin || "—";
      pinCell.appendChild(pinBadge);

      const addressCell = document.createElement("td");
      addressCell.className = "mono";
      addressCell.textContent = connection.address || "—";

      const timeCell = document.createElement("td");
      timeCell.className = "mono";
      timeCell.textContent = formatDuration(connection.connectedForMs);

      const idCell = document.createElement("td");
      idCell.className = "mono connection-id";
      idCell.title = connection.id;
      idCell.textContent = connection.id;

      const actionCell = document.createElement("td");
      const kickButton = document.createElement("button");
      kickButton.type = "button";
      kickButton.className = "kick-button";
      kickButton.textContent = "Eliminar";
      kickButton.addEventListener("click", () => kickConnection(connection.id, kickButton));
      actionCell.appendChild(kickButton);

      row.appendChild(pinCell);
      row.appendChild(addressCell);
      row.appendChild(timeCell);
      row.appendChild(idCell);
      row.appendChild(actionCell);

      connectionsBody.appendChild(row);
    }
  }

  async function loadConnections() {
    panelError.textContent = "";
    try {
      const data = await api("/api/admin/connections");
      renderConnections(data.connections || []);
    } catch (error) {
      if (String(error.message).toLowerCase().includes("401") || String(error.message).includes("No autorizado")) {
        setToken(null);
        showLogin();
        loginError.textContent = "Tu sesión expiró. Vuelve a iniciar sesión.";
        return;
      }
      connectionsBody.innerHTML = "";
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
      loadConnections();
    } catch (error) {
      button.disabled = false;
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

  refreshButton.addEventListener("click", loadConnections);

  logoutButton.addEventListener("click", async () => {
    try {
      await api("/api/admin/logout", { method: "POST" });
    } catch {
      // ignore
    }
    setToken(null);
    showLogin();
  });

  if (token) {
    showPanel();
  } else {
    showLogin();
  }
})();
