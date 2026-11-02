const fs = require("node:fs");
const path = require("node:path");

const MAX_DIARY_CHARS = 8000;
const READ_DIARY_TOOL = {
  type: "function",
  function: {
    name: "read_diary",
    description: "读取近七天内指定日期的日记，或读取指定/最新的 Kelivo 便签。",
    parameters: {
      type: "object",
      properties: {
        date: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          description: "要读取的日期，格式为 YYYY-MM-DD，且只能是今天或之前六天。"
        },
        note: {
          oneOf: [
            { type: "boolean", enum: [true] },
            { type: "string" }
          ],
          description: "true 读取 notes/ 中修改时间最新的便签；字符串指定 notes/ 下的文件名。"
        }
      },
      anyOf: [
        { required: ["date"] },
        { required: ["note"] }
      ],
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

function truncateNote(text) {
  const characters = Array.from(text);
  if (characters.length <= MAX_DIARY_CHARS) return text;

  const marker = "[便签过长，已截断，以下为末尾内容]\n\n";
  const markerLength = Array.from(marker).length;
  let tail = characters.slice(-(MAX_DIARY_CHARS - markerLength)).join("");
  const paragraphBoundary = tail.indexOf("\n\n");
  if (paragraphBoundary >= 0 && tail.length - paragraphBoundary > 100) {
    tail = tail.slice(paragraphBoundary + 2);
  }
  return marker + tail;
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

function readNoteFile(notesDirectory, filename) {
  if (
    typeof filename !== "string" ||
    filename !== path.basename(filename) ||
    filename === "." ||
    filename === ".." ||
    !filename.endsWith(".md")
  ) {
    return "读取便签失败：只能指定 notes/ 下的 Markdown 文件名。";
  }

  const content = readDiaryFile(notesDirectory, filename);
  if (content === null) return "没有找到指定的便签文件。";
  return truncateNote(content);
}

function readLatestNote(notesDirectory) {
  let filenames;
  try {
    filenames = fs.readdirSync(notesDirectory);
  } catch (error) {
    if (error.code === "ENOENT") return "还没有便签。";
    throw error;
  }

  const latest = filenames
    .filter(filename => filename.endsWith(".md"))
    .map(filename => {
      const filePath = path.join(notesDirectory, filename);
      const stat = fs.lstatSync(filePath);
      return stat.isFile() ? { filename, modifiedAt: stat.mtimeMs } : null;
    })
    .filter(Boolean)
    .sort((left, right) => right.modifiedAt - left.modifiedAt)[0];

  return latest
    ? readNoteFile(notesDirectory, latest.filename)
    : "还没有便签。";
}

function readDiary(date, directory, today, note) {
  const notesDirectory = path.join(directory, "notes");
  if (note === true) return readLatestNote(notesDirectory);
  if (typeof note === "string") return readNoteFile(notesDirectory, note);
  if (note !== undefined && note !== false) {
    return "读取便签失败：note 必须为 true 或文件名。";
  }
  if (typeof date !== "string") {
    return "读取失败：请提供日期，或使用 note 参数读取便签。";
  }
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
  if (Object.keys(args).some(key => !["date", "note"].includes(key))) {
    return { error: "只允许提供 date 和 note 字段。" };
  }
  if (!Object.hasOwn(args, "date") && !Object.hasOwn(args, "note")) {
    return { error: "必须提供 date 或 note 字段。" };
  }
  if (Object.hasOwn(args, "date") && typeof args.date !== "string") {
    return { error: "date 必须是 YYYY-MM-DD 格式的字符串。" };
  }
  if (Object.hasOwn(args, "note") && args.note !== true && typeof args.note !== "string") {
    return { error: "note 必须为 true 或文件名。" };
  }
  const parsed = {};
  if (Object.hasOwn(args, "date")) parsed.date = args.date;
  if (Object.hasOwn(args, "note")) parsed.note = args.note;
  return parsed;
}

module.exports = {
  MAX_DIARY_CHARS,
  READ_DIARY_TOOL,
  parseDiaryToolArguments,
  readDiary,
  truncateNote
};
