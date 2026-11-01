const fs = require("node:fs");
const path = require("node:path");

const MAX_DIARY_CHARS = 8000;
const READ_DIARY_TOOL = {
  type: "function",
  function: {
    name: "read_diary",
    description: "读取近七天内指定日期的自动唤醒日记和 Kelivo 日记。日期格式为 YYYY-MM-DD。",
    parameters: {
      type: "object",
      properties: {
        date: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          description: "要读取的日期，格式为 YYYY-MM-DD，且只能是今天或之前六天。"
        }
      },
      required: ["date"],
      additionalProperties: false
    }
  }
};

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function truncateDiary(text) {
  const characters = Array.from(text);
  if (characters.length <= MAX_DIARY_CHARS) return text;

  const marker = "\n[日记过长，已截断]";
  const markerLength = Array.from(marker).length;
  return characters.slice(0, MAX_DIARY_CHARS - markerLength).join("") + marker;
}

function readDiaryFile(directory, filename) {
  const filePath = path.join(directory, filename);
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }

  if (!stat.isFile()) {
    throw new Error(`日记文件不是普通文件，拒绝读取：${filename}`);
  }
  return fs.readFileSync(filePath, "utf8").trim();
}

function readDiary(date, directory, today) {
  if (!isValidDate(date)) {
    return "读取失败：日期格式必须是 YYYY-MM-DD。";
  }
  if (!isValidDate(today)) {
    throw new Error("当前日期无效，无法校验日记读取范围");
  }

  const dayOffset = (Date.parse(`${today}T00:00:00.000Z`) -
    Date.parse(`${date}T00:00:00.000Z`)) / 86400000;
  if (dayOffset < 0 || dayOffset >= 7) {
    return "读取失败：只能读取今天及之前六天内的日记。";
  }

  const sections = [];
  for (const [label, filename] of [
    ["自动唤醒日记", `${date}.md`],
    ["Kelivo 日记", `${date}.kelivo.md`]
  ]) {
    const content = readDiaryFile(directory, filename);
    if (content) sections.push(`## ${label}\n\n${content}`);
  }

  if (sections.length === 0) return "这一天没有日记内容。";
  return truncateDiary(sections.join("\n\n"));
}

function parseDiaryToolArguments(rawArguments) {
  let args;
  try {
    args = JSON.parse(rawArguments || "{}");
  } catch {
    return { error: "参数必须是合法 JSON。" };
  }

  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return { error: "参数必须是包含 date 字段的对象。" };
  }
  if (Object.keys(args).some(key => key !== "date")) {
    return { error: "只允许提供 date 字段。" };
  }
  if (typeof args.date !== "string") {
    return { error: "date 必须是 YYYY-MM-DD 格式的字符串。" };
  }
  return { date: args.date };
}

module.exports = {
  MAX_DIARY_CHARS,
  READ_DIARY_TOOL,
  parseDiaryToolArguments,
  readDiary
};
