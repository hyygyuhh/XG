import {
  appPackage,
  appTitle,
  asList,
  batteryView,
  canRemove,
  faceId,
  faceTitle,
  infoRows,
  isCurrentFace,
  pick,
  storageView,
} from "./deviceView.js";

const CATALOG_URL =
  "https://cdn.jsdelivr.net/gh/AstralSightStudios/AstroBox-Repo@main/index_v2.csv";

const DEVICES = [
  ["xmb9", "小米手环 9"],
  ["xmb9p", "小米手环 9 Pro"],
  ["xmb10", "小米手环 10"],
  ["xmb10nfc", "小米手环 10 NFC"],
  ["xmb10p", "小米手环 10 Pro"],
  ["xmws3", "Xiaomi Watch S3"],
  ["xmws4", "Xiaomi Watch S4"],
  ["xmws4xring", "Xiaomi Watch S4 15 周年"],
  ["xmws441", "Xiaomi Watch S4 41mm"],
  ["xmws5", "Xiaomi Watch S5"],
  ["xmrw5", "REDMI Watch 5"],
  ["xmrw5xring", "REDMI Watch 5 eSIM"],
  ["xmrw6", "REDMI Watch 6"],
];

const deviceLabels = new Map(DEVICES);

const PAGE_SIZE = 24;
const WATCHFACE = 16;
const FIRMWARE = 32;
const APP = 64;

const state = {
  items: [],
  kind: "quick_app",
  query: "",
  device: localStorage.getItem("astrobox.web.device") || "xmb9",
  onlyDevice: true,
  shown: PAGE_SIZE,
  wasm: null,
  wasmError: "",
  session: null,
  deviceView: null,
  deviceLoading: false,
  busy: false,
};

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function deviceName(id) {
  return deviceLabels.get(id) || id;
}

function cdn(owner, repo, commit, file) {
  const path = String(file || "")
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  return `https://cdn.jsdelivr.net/gh/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}@${encodeURIComponent(commit)}/${path}`;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") cell += char;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  rows.shift();
  return rows
    .filter((columns) => columns[0] && (columns[2] === "quick_app" || columns[2] === "watchface"))
    .map((columns) => ({
      id: columns[0].trim(),
      name: columns[1].trim(),
      restype: columns[2].trim(),
      owner: columns[3].trim(),
      repo: columns[4].trim(),
      commit: columns[5].trim(),
      icon: columns[6].trim(),
      cover: columns[7].trim(),
      tags: (columns[8] || "").split(";").map((tag) => tag.trim()).filter(Boolean),
      devices: (columns[10] || "").split(";").map((id) => id.trim()).filter(Boolean),
      paid: (columns[11] || "").trim(),
    }))
    .reverse();
}

function visibleItems() {
  const query = state.query.trim().toLowerCase();
  return state.items.filter((item) => {
    if (item.restype !== state.kind) return false;
    if (state.onlyDevice && !item.devices.includes(state.device)) return false;
    if (!query) return true;
    const haystack = [item.name, item.id, item.tags.join(" ")].join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

function paidLabel(paid) {
  if (paid === "force_paid") return "强制付费";
  if (paid === "paid") return "付费";
  return "";
}

function render() {
  const items = visibleItems();
  const slice = items.slice(0, state.shown);
  const kindLabel = state.kind === "quick_app" ? "个应用" : "个表盘";
  $("summary").textContent = items.length
    ? `${deviceName(state.device)} · ${items.length} ${kindLabel}`
    : "没有符合条件的资源";
  $("grid").innerHTML = slice
    .map((item, index) => {
      const paid = paidLabel(item.paid);
      const image = item.cover || item.icon;
      return `<button class="card" type="button" data-index="${index}">
        ${image ? `<img alt="" src="${escapeHtml(cdn(item.owner, item.repo, item.commit, image))}" />` : `<div class="cover"></div>`}
        <h3>${escapeHtml(item.name)}</h3>
        <div class="pills">
          ${paid ? `<span class="pill paid">${paid}</span>` : ""}
          ${item.devices
            .slice()
            .sort((a, b) => Number(b === state.device) - Number(a === state.device))
            .slice(0, 3)
            .map((id) => `<span class="pill">${escapeHtml(deviceName(id))}</span>`)
            .join("")}
        </div>
      </button>`;
    })
    .join("");
  $("more").hidden = state.shown >= items.length;
}

function toast(message) {
  const node = $("toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("show"), 2400);
}

async function loadCatalog() {
  const response = await fetch(CATALOG_URL);
  if (!response.ok) throw new Error(`资源目录请求失败（${response.status}）`);
  state.items = parseCsv(await response.text());
  for (const item of state.items) {
    for (const id of item.devices) {
      if (!deviceLabels.has(id)) deviceLabels.set(id, id);
    }
  }
  fillDevices();
  render();
}

async function loadWasm() {
  if (state.wasm || state.wasmError) return state.wasm;
  try {
    const mod = await import("./wasm/astrobox_ng_wasm.js");
    await mod.default();
    mod.register_event_sink((event, payload) => {
      if (event === "device-disconnected") {
        state.session = null;
        setLinkStatus("连接已断开", "bad");
        refreshDeviceButtons();
      } else if (payload) {
        console.info("[astrobox]", event, payload);
      }
    });
    state.wasm = mod;
  } catch (error) {
    state.wasmError = error instanceof Error ? error.message : String(error);
  }
  return state.wasm;
}

function setLinkStatus(text, kind) {
  const node = $("link-status");
  node.textContent = text;
  node.className = `status${kind ? ` ${kind}` : ""}`;
}

function refreshDeviceButtons() {
  $("disconnect").hidden = !state.session;
  const battery = batteryView(state.deviceView?.status);
  $("connect-open").textContent = state.session
    ? `${battery.percent == null ? "已连接" : `${battery.percent}%`}`
    : "连接设备";
}

function startConnect() {
  if (!state.wasm) {
    setLinkStatus("安装后端还没编译，现在只能浏览和挑选资源。", "bad");
    return null;
  }
  if (!navigator.serial) {
    setLinkStatus("这个浏览器没有串口接口。请用电脑上的 Chrome 或 Edge 打开。", "bad");
    return null;
  }
  const authkey = $("authkey").value.trim();
  if (!authkey) {
    setLinkStatus("先填写这只设备的认证密钥。", "bad");
    return null;
  }
  localStorage.setItem("astrobox.web.authkey", authkey);
  localStorage.setItem("astrobox.web.name", $("device-name").value.trim());
  setLinkStatus("正在请求串口…");
  return state.wasm.device_connect(
    $("device-name").value.trim(),
    "",
    authkey,
    2,
    "SPP",
    0,
  );
}

async function finishConnect(pending) {
  const info = await pending;
  state.session = info;
  state.deviceView = null;
  setLinkStatus(`已连接 ${info.name || "设备"}`, "ok");
  refreshDeviceButtons();
  renderDevice();
  if ($("device-dialog").open) $("device-dialog").close();
  await refreshDeviceView();
}

async function disconnectDevice() {
  if (!state.session || !state.wasm) return;
  const addr = state.session.addr;
  state.session = null;
  state.deviceView = null;
  state.deviceLoading = false;
  await state.wasm.device_disconnect(addr);
  setLinkStatus("已断开");
  refreshDeviceButtons();
  renderDevice();
}

function renderDevice() {
  const panel = $("device-panel");
  if (!state.session) {
    panel.innerHTML = `<div class="device-head"><div><h2>设备</h2><p class="hint">连接手环后，这里显示电量、存储、固件，以及已经安装的应用和表盘。</p></div></div>`;
    return;
  }
  const view = state.deviceView;
  const battery = batteryView(view?.status);
  const storage = storageView(view?.storage);
  const facts = infoRows(view?.info).map(([label, value]) => (
    label === "产品名" && deviceLabels.has(String(value)) ? [label, deviceLabels.get(String(value))] : [label, value]
  ));
  const title = state.session.name || pick(view?.info, "model") || "已连接的设备";
  const batteryText = battery.percent == null ? (state.deviceLoading ? "读取中" : "—") : `${battery.percent}%`;
  const chargeText = battery.charge ? ` · ${battery.charge}` : "";
  panel.innerHTML = `
    <div class="device-head">
      <div>
        <h2>${escapeHtml(title)}</h2>
        <p class="hint">${escapeHtml(state.session.addr || "")}</p>
      </div>
      <div class="row">
        <button class="ghost" type="button" data-action="refresh" ${state.deviceLoading ? "disabled" : ""}>刷新状态</button>
        <button class="ghost" type="button" data-action="disconnect">断开</button>
      </div>
    </div>
    <div class="stats">
      <div class="stat"><span>电量</span><b>${escapeHtml(batteryText)}</b><small>${escapeHtml(chargeText.replace(/^ · /, "") || (state.deviceLoading ? "正在向手环读取" : ""))}</small></div>
      <div class="stat"><span>存储</span><b>${escapeHtml(state.deviceLoading && !view?.storage ? "读取中" : storage.text)}</b><div class="meter"><span style="width:${Math.round(storage.ratio * 100)}%"></span></div></div>
      ${facts.map(([label, value]) => `<div class="stat"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`).join("")}
    </div>
    ${view?.errors?.length ? `<p class="status bad">${escapeHtml(view.errors.join("；"))}</p>` : ""}
    <div class="device-columns">
      ${renderEntryList("已安装应用", view?.apps, "app")}
      ${renderEntryList("已安装表盘", view?.faces, "face")}
    </div>
  `;
}

function renderEntryList(title, entries, kind) {
  const list = Array.isArray(entries) ? entries : [];
  const body = state.deviceLoading && !state.deviceView
    ? `<p class="hint">正在读取…</p>`
    : list.length
      ? list.map((entry, index) => entryRow(entry, kind, index)).join("")
      : `<p class="hint">还没有读到内容。</p>`;
  return `<section><div class="list-head"><h3>${title}</h3></div>${body}</section>`;
}

function entryRow(entry, kind, index) {
  const title = kind === "app" ? appTitle(entry) : faceTitle(entry);
  const extra = kind === "app" ? appPackage(entry) : (isCurrentFace(entry) ? "当前表盘" : faceId(entry));
  const actions = [];
  if (kind === "app" && appPackage(entry)) {
    actions.push(`<button class="ghost" type="button" data-action="launch" data-index="${index}">打开</button>`);
  }
  if (kind === "face" && faceId(entry) && !isCurrentFace(entry)) {
    actions.push(`<button class="ghost" type="button" data-action="use-face" data-index="${index}">设为当前</button>`);
  }
  if (canRemove(entry) && (kind === "app" ? appPackage(entry) : faceId(entry))) {
    actions.push(`<button class="ghost" type="button" data-action="remove" data-kind="${kind}" data-index="${index}">卸载</button>`);
  }
  return `<div class="installed-item"><div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(extra)}</small></div><div class="row">${actions.join("")}</div></div>`;
}

async function refreshDeviceView() {
  if (!state.session || !state.wasm) {
    renderDevice();
    return;
  }
  const addr = state.session.addr;
  state.deviceLoading = true;
  renderDevice();
  const next = { info: null, status: null, storage: null, apps: [], faces: [], errors: [] };
  for (const [key, type] of [["info", "info"], ["status", "status"], ["storage", "storage"]]) {
    try {
      next[key] = await state.wasm.device_get_data(addr, type);
    } catch (error) {
      next.errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  try {
    next.apps = asList(await state.wasm.thirdpartyapp_get_list(addr));
  } catch (error) {
    next.errors.push(error instanceof Error ? error.message : String(error));
  }
  try {
    next.faces = asList(await state.wasm.watchface_get_list(addr));
  } catch (error) {
    next.errors.push(error instanceof Error ? error.message : String(error));
  }
  if (state.session?.addr !== addr) return;
  state.deviceView = next;
  state.deviceLoading = false;
  const product = pick(next.info, "productDevice", "product_device", "model");
  if (product && deviceLabels.has(String(product)) && state.device !== String(product)) {
    state.device = String(product);
    localStorage.setItem("astrobox.web.device", state.device);
    $("device").value = state.device;
    render();
  }
  refreshDeviceButtons();
  renderDevice();
}

async function onDeviceAction(action, index, kind) {
  if (!state.session || !state.wasm) return;
  const addr = state.session.addr;
  const view = state.deviceView;
  if (action === "refresh") {
    await refreshDeviceView();
    return;
  }
  if (action === "disconnect") {
    await disconnectDevice();
    return;
  }
  if (action === "launch") {
    const entry = view?.apps?.[index];
    const packageName = appPackage(entry);
    if (!packageName) return;
    await state.wasm.thirdpartyapp_launch(addr, packageName, "");
    toast(`已发送打开 ${appTitle(entry)}`);
    return;
  }
  if (action === "use-face") {
    const entry = view?.faces?.[index];
    const id = faceId(entry);
    if (!id) return;
    await state.wasm.watchface_set_current(addr, id);
    toast(`已切换到 ${faceTitle(entry)}`);
    await refreshDeviceView();
    return;
  }
  if (action === "remove") {
    const entry = (kind === "face" ? view?.faces : view?.apps)?.[index];
    const id = kind === "face" ? faceId(entry) : appPackage(entry);
    if (!id) return;
    if (kind === "face") await state.wasm.watchface_uninstall(addr, id);
    else await state.wasm.thirdpartyapp_uninstall(addr, id);
    toast("已发送卸载请求");
    await refreshDeviceView();
  }
}

async function installBytes({ bytes, name, restype, packageName, watchfaceId, onProgress }) {
  const wasm = state.wasm || (await loadWasm());
  if (!wasm) throw new Error("安装后端还没编译，暂时不能写入设备。");
  if (!state.session) throw new Error("先连接设备。");
  const detected = await wasm.device_get_file_type(bytes, name);
  if (detected === FIRMWARE) throw new Error("网页版不安装固件。");
  let dataType = restype === "watchface" ? WATCHFACE : restype === "quick_app" ? APP : 0;
  if (!dataType) {
    if (detected === APP || detected === WATCHFACE) dataType = detected;
    else if (name.toLowerCase().endsWith(".rpk")) dataType = APP;
    else if (/\.(bin|mwz)$/i.test(name)) dataType = WATCHFACE;
  }
  if (dataType !== APP && dataType !== WATCHFACE) {
    throw new Error("认不出这是应用还是表盘。");
  }
  await wasm.device_install(
    state.session.addr,
    dataType,
    bytes,
    dataType === APP ? packageName || undefined : undefined,
    (payload) => {
      const progress = Number(payload?.progress);
      if (Number.isFinite(progress)) onProgress?.(progress);
    },
    dataType === WATCHFACE ? watchfaceId || undefined : undefined,
  );
}

async function installCatalogFile(item, fileName, progressNode) {
  if (state.busy) return;
  const wasm = state.wasm || (await loadWasm());
  if (!wasm) throw new Error("安装后端还没编译，暂时不能写入设备。");
  if (!state.session) throw new Error("先连接设备。");
  state.busy = true;
  try {
    const response = await fetch(cdn(item.owner, item.repo, item.commit, fileName));
    if (!response.ok) throw new Error(`下载失败（${response.status}）`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    await installBytes({
      bytes,
      name: fileName,
      restype: item.restype,
      packageName: item.restype === "quick_app" ? item.id : undefined,
      watchfaceId: item.restype === "watchface" ? item.id : undefined,
      onProgress(progress) {
        progressNode.hidden = false;
        progressNode.firstElementChild.style.width = `${Math.round(progress * 100)}%`;
        progressNode.dataset.label = `${Math.round(progress * 100)}%`;
      },
    });
    toast(`${item.name} 已安装`);
    await refreshDeviceView();
  } finally {
    state.busy = false;
  }
}

async function openDetail(item) {
  const body = $("detail-body");
  body.innerHTML = `<h2>${escapeHtml(item.name)}</h2><p class="hint">正在读取介绍…</p>`;
  $("detail").showModal();
  let manifest = null;
  try {
    const response = await fetch(cdn(item.owner, item.repo, item.commit, "manifest_v2.json"));
    if (response.ok) manifest = await response.json();
  } catch (error) {
    console.warn(error);
  }
  const info = manifest?.item || {};
  const downloads = manifest?.downloads || {};
  const chosen = downloads[state.device];
  const previews = Array.isArray(info.preview) ? info.preview : [];
  const authors = Array.isArray(info.author) ? info.author.map((author) => author.name).filter(Boolean) : [];
  const links = Array.isArray(manifest?.links) ? manifest.links : [];
  const paid = paidLabel(item.paid);
  body.innerHTML = `
    <h2>${escapeHtml(info.name || item.name)}</h2>
    <div class="pills">
      <span class="pill">${item.restype === "quick_app" ? "应用" : "表盘"}</span>
      ${paid ? `<span class="pill paid">${paid}</span>` : ""}
      ${authors.map((name) => `<span class="pill">${escapeHtml(name)}</span>`).join("")}
    </div>
    <p class="hint">${escapeHtml(info.description || "这个资源没有公开介绍。")}</p>
    ${previews.length ? `<div class="previews">${previews.map((file) => `<img alt="" src="${escapeHtml(cdn(item.owner, item.repo, item.commit, file))}" />`).join("")}</div>` : ""}
    ${links.map((link) => `<a class="link" href="${escapeHtml(link.url)}" target="_blank" rel="noreferrer">${escapeHtml(link.title || link.url)}</a>`).join("")}
    <div id="install-slot"></div>
  `;
  const slot = body.querySelector("#install-slot");
  if (!chosen?.file_name) {
    const others = Object.keys(downloads).map(deviceName).join("、");
    slot.innerHTML = `<p class="status bad">${others
      ? `当前型号没有安装包。公开文件提供给：${escapeHtml(others)}`
      : "没有公开的安装包。付费资源通常要在 AstroBox 账号里解锁，网页版只能安装目录里公开的文件。"}</p>`;
    return;
  }
  slot.innerHTML = `
    <p class="hint">${escapeHtml(deviceName(state.device))} · ${escapeHtml(chosen.version || "")} · ${escapeHtml(chosen.file_name)}</p>
    <div class="progress" hidden><span></span></div>
    <div class="actions"><button id="install-now" type="button">安装到已连接的设备</button></div>
    <p id="install-error" class="status bad"></p>
  `;
  const installable = { ...item, id: info.id || item.id };
  slot.querySelector("#install-now").addEventListener("click", async () => {
    const button = slot.querySelector("#install-now");
    const error = slot.querySelector("#install-error");
    button.disabled = true;
    error.textContent = "";
    try {
      await installCatalogFile(installable, chosen.file_name, slot.querySelector(".progress"));
    } catch (cause) {
      error.textContent = cause instanceof Error ? cause.message : String(cause);
    } finally {
      button.disabled = false;
    }
  });
}

function fillDevices() {
  $("device").innerHTML = [...deviceLabels.entries()]
    .map(([id, name]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`)
    .join("");
  if (!deviceLabels.has(state.device)) state.device = "xmb9";
  $("device").value = state.device;
}

function bind() {
  fillDevices();
  $("authkey").value = localStorage.getItem("astrobox.web.authkey") || "";
  $("device-name").value = localStorage.getItem("astrobox.web.name") || "";
  $("transport-hint").textContent = navigator.serial
    ? "连接时浏览器会弹出串口选择。选中手表或手环对应的 COM 口。"
    : "当前浏览器不能打开串口。浏览和挑选可以继续，安装请换到电脑上的 Chrome 或 Edge。";

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      state.kind = tab.dataset.kind;
      state.shown = PAGE_SIZE;
      document.querySelectorAll(".tab").forEach((node) => node.classList.toggle("active", node === tab));
      render();
    });
  });

  $("search").addEventListener("input", () => {
    state.query = $("search").value;
    state.shown = PAGE_SIZE;
    render();
  });
  $("device").addEventListener("change", () => {
    state.device = $("device").value;
    localStorage.setItem("astrobox.web.device", state.device);
    state.shown = PAGE_SIZE;
    render();
  });
  $("only-device").addEventListener("change", () => {
    state.onlyDevice = $("only-device").checked;
    state.shown = PAGE_SIZE;
    render();
  });
  $("more").addEventListener("click", () => {
    state.shown += PAGE_SIZE;
    render();
  });
  $("grid").addEventListener("click", (event) => {
    const card = event.target.closest(".card");
    if (!card) return;
    const item = visibleItems()[Number(card.dataset.index)];
    if (item) openDetail(item);
  });
  $("grid").addEventListener("error", (event) => {
    if (event.target.tagName === "IMG") event.target.replaceWith(Object.assign(document.createElement("div"), { className: "cover" }));
  }, true);

  $("device-panel").addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    button.disabled = true;
    onDeviceAction(button.dataset.action, Number(button.dataset.index), button.dataset.kind)
      .catch((error) => toast(error instanceof Error ? error.message : String(error)))
      .finally(() => {
        if (button.isConnected) button.disabled = false;
      });
  });
  $("connect-open").addEventListener("click", () => $("device-dialog").showModal());
  $("device-close").addEventListener("click", () => $("device-dialog").close());
  $("device-form").addEventListener("submit", (event) => event.preventDefault());
  $("connect").addEventListener("click", () => {
    const pending = startConnect();
    if (!pending) return;
    finishConnect(pending).catch((error) => setLinkStatus(error instanceof Error ? error.message : String(error), "bad"));
  });
  $("disconnect").addEventListener("click", () => {
    disconnectDevice().catch((error) => setLinkStatus(error instanceof Error ? error.message : String(error), "bad"));
  });
  $("local-install").addEventListener("click", async () => {
    const file = $("local-file").files?.[0];
    if (!file) {
      setLinkStatus("先选择一个文件。", "bad");
      return;
    }
    const button = $("local-install");
    button.disabled = true;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const restype = file.name.toLowerCase().endsWith(".rpk") ? "quick_app" : "watchface";
      await installBytes({ bytes, name: file.name, restype });
      toast(`${file.name} 已安装`);
      await refreshDeviceView();
    } catch (error) {
      setLinkStatus(error instanceof Error ? error.message : String(error), "bad");
    } finally {
      button.disabled = false;
    }
  });
}

bind();
renderDevice();
loadWasm();
loadCatalog().catch((error) => {
  $("summary").textContent = error instanceof Error ? error.message : String(error);
});
