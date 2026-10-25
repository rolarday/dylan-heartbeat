const fs = require("fs");
const { writeJsonAtomicSync } = require("./runtime_paths");

function normalizeTimelineKey(value, fallback = "default") {
  const key = typeof value === "string" ? value.trim() : "";
  if (key) return key;
  const fallbackKey = typeof fallback === "string" ? fallback.trim() : "";
  return fallbackKey || "default";
}

function loadTimelineStore(filePath, legacyKey = "default") {
  if (!fs.existsSync(filePath)) return Object.create(null);

  const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const store = Object.create(null);

  if (Array.isArray(parsed)) {
    store[normalizeTimelineKey(legacyKey)] = parsed;
    return store;
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("时间线格式错误：顶层必须是数组或按模型名分组的对象");
  }

  for (const [key, messages] of Object.entries(parsed)) {
    if (!Array.isArray(messages)) {
      throw new Error(`时间线格式错误：模型 ${key} 对应的内容必须是数组`);
    }
    store[key] = messages;
  }
  return store;
}

function migrateLegacyTimelineStore(filePath, legacyKey = "default") {
  if (!fs.existsSync(filePath)) return false;

  const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  if (!Array.isArray(parsed)) return false;

  const timeline = parsed.map(message => {
    if (!message || typeof message !== "object" || Array.isArray(message)) return message;
    const sanitized = { ...message };
    delete sanitized.reasoning_content;
    return sanitized;
  });
  const store = Object.create(null);
  store[normalizeTimelineKey(legacyKey)] = timeline;
  writeJsonAtomicSync(filePath, store);
  return true;
}

function readTimelineForKey(filePath, key, legacyKey = key) {
  const normalizedKey = normalizeTimelineKey(key, legacyKey);
  const store = loadTimelineStore(filePath, legacyKey);
  return store[normalizedKey] || [];
}

function writeTimelineForKey(filePath, key, messages, legacyKey = key) {
  if (!Array.isArray(messages)) {
    throw new TypeError("时间线内容必须是数组");
  }
  const normalizedKey = normalizeTimelineKey(key, legacyKey);
  const store = loadTimelineStore(filePath, legacyKey);
  store[normalizedKey] = messages;
  writeJsonAtomicSync(filePath, store);
}

module.exports = {
  normalizeTimelineKey,
  loadTimelineStore,
  migrateLegacyTimelineStore,
  readTimelineForKey,
  writeTimelineForKey
};
