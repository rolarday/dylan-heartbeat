const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  MAX_DIARY_CHARS,
  READ_DIARY_TOOL,
  parseDiaryToolArguments,
  readDiary
} = require("../diary_tool");

test("defines read_diary with only a date argument", () => {
  assert.equal(READ_DIARY_TOOL.function.name, "read_diary");
  assert.deepEqual(READ_DIARY_TOOL.function.parameters.required, ["date"]);
  assert.equal(READ_DIARY_TOOL.function.parameters.additionalProperties, false);
});

test("reads only the two fixed diary filenames for a date", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "diary-tool-"));
  try {
    fs.writeFileSync(path.join(directory, "2026-10-31.md"), "heartbeat entry");
    fs.writeFileSync(path.join(directory, "2026-10-31.kelivo.md"), "Kelivo entry");
    fs.writeFileSync(path.join(directory, "2026-10-30.md"), "other date");

    const result = readDiary("2026-10-31", directory, "2026-10-31");

    assert.ok(result.includes("heartbeat entry"));
    assert.ok(result.includes("Kelivo entry"));
    assert.ok(!result.includes("other date"));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects malformed, future, and older-than-seven-day dates", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "diary-tool-"));
  try {
    fs.writeFileSync(path.join(directory, "2026-10-25.md"), "six days ago");
    assert.match(readDiary("../../server.js", directory, "2026-10-31"), /日期格式/);
    assert.match(readDiary("2026-11-01", directory, "2026-10-31"), /只能读取/);
    assert.ok(readDiary("2026-10-25", directory, "2026-10-31").includes("six days ago"));
    assert.match(readDiary("2026-10-24", directory, "2026-10-31"), /只能读取/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("caps the complete response at 8000 Unicode characters", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "diary-tool-"));
  try {
    fs.writeFileSync(path.join(directory, "2026-10-31.md"), "日".repeat(9000));

    const result = readDiary("2026-10-31", directory, "2026-10-31");

    assert.ok(Array.from(result).length <= MAX_DIARY_CHARS);
    assert.ok(result.endsWith("[日记过长，已截断]"));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects unexpected arguments and reports invalid tool JSON", () => {
  assert.deepEqual(parseDiaryToolArguments('{"date":"2026-10-31"}'), { date: "2026-10-31" });
  assert.match(parseDiaryToolArguments('{"date":"2026-10-31","path":"secret"}').error, /只允许/);
  assert.match(parseDiaryToolArguments("{").error, /合法 JSON/);
});

test("refuses non-file diary entries", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "diary-tool-"));
  try {
    fs.mkdirSync(path.join(directory, "2026-10-31.md"));
    assert.throws(() => readDiary("2026-10-31", directory, "2026-10-31"), /拒绝读取/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
