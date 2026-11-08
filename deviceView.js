export function pick(obj, ...keys) {
  if (!obj || typeof obj !== "object") return undefined;
  for (const key of keys) {
    const value = obj[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

export function asList(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.list)) return value.list;
  return [];
}

export function formatBytes(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return "—";
  const units = [
    [1024 ** 3, "GB"],
    [1024 ** 2, "MB"],
    [1024, "KB"],
  ];
  for (const [size, unit] of units) {
    if (amount >= size) {
      const shown = amount / size;
      return `${shown >= 10 ? shown.toFixed(0) : shown.toFixed(1)} ${unit}`;
    }
  }
  return `${Math.round(amount)} B`;
}

const CHARGE_TEXT = {
  UNKNOWN: "状态未知",
  CHARGING: "充电中",
  NOT_CHARGING: "未在充电",
  FULL: "已充满",
  0: "状态未知",
  1: "充电中",
  2: "未在充电",
  3: "已充满",
};

export function batteryView(status) {
  const battery = pick(status, "battery") || {};
  const capacity = Number(pick(battery, "capacity"));
  const charge = pick(battery, "chargeStatus", "charge_status");
  const percent = Number.isFinite(capacity) ? Math.max(0, Math.min(100, Math.round(capacity))) : null;
  return {
    percent,
    charge: CHARGE_TEXT[charge] || (charge ? String(charge) : ""),
  };
}

export function storageView(storage) {
  const used = Number(pick(storage, "used"));
  const total = Number(pick(storage, "total"));
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) {
    return { text: "—", ratio: 0 };
  }
  return {
    text: `${formatBytes(used)} / ${formatBytes(total)}`,
    ratio: Math.max(0, Math.min(1, used / total)),
  };
}

export function infoRows(info) {
  const rows = [
    ["型号", pick(info, "model")],
    ["产品名", pick(info, "productDevice", "product_device")],
    ["固件", pick(info, "firmwareVersion", "firmware_version")],
    ["序列号", pick(info, "serialNumber", "serial_number")],
  ];
  return rows.filter(([, value]) => value);
}

export function appTitle(entry) {
  return pick(entry, "appName", "app_name", "name") || pick(entry, "packageName", "package_name") || "未命名应用";
}

export function appPackage(entry) {
  return pick(entry, "packageName", "package_name") || "";
}

export function faceTitle(entry) {
  return pick(entry, "name") || pick(entry, "id") || "未命名表盘";
}

export function faceId(entry) {
  return pick(entry, "id", "watchfaceId", "watchface_id") || "";
}

export function canRemove(entry) {
  const value = pick(entry, "canRemove", "can_remove");
  return value !== false && value !== 0 && value !== "false";
}

export function isCurrentFace(entry) {
  const value = pick(entry, "isCurrent", "is_current");
  return value === true || value === 1 || value === "true";
}
