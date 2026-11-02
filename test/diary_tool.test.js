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

test("defines read_diary with date and note arguments", () => {
  assert.equal(READ_DIARY_TOOL.function.name, "read_diary");
  assert.deepEqual(READ_DIARY_TOOL.function.parameters.anyOf, [
    { required: ["date"] },
    { required: ["note"] }
  ]);
  assert.deepEqual(READ_DIARY_TOOL.function.parameters.properties.note.oneOf, [
    { type: "boolean", enum: [true] },
    { type: "string" }
  ]);
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
  assert.deepEqual(parseDiaryToolArguments('{"note":true}'), { note: true });
  assert.deepEqual(parseDiaryToolArguments('{"date":"2026-10-31","note":"abc-2026-10-31T12-00-00-000Z.md"}'), {
    date: "2026-10-31",
    note: "abc-2026-10-31T12-00-00-000Z.md"
  });
  assert.match(parseDiaryToolArguments('{"date":"2026-10-31","path":"secret"}').error, /只允许/);
  assert.match(parseDiaryToolArguments("{").error, /合法 JSON/);
});

test("reads latest or named notes without mixing them into date-based diary results", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "diary-tool-"));
  const notesDirectory = path.join(directory, "notes");
  fs.mkdirSync(notesDirectory);
  const oldFilename = "window-2026-10-30T12-00-00-000Z.md";
  const newFilename = "window-2026-10-31T12-00-00-000Z.md";
  try {
    fs.writeFileSync(path.join(directory, "2026-10-31.md"), "daily diary");
    fs.writeFileSync(path.join(notesDirectory, oldFilename), "old note");
    fs.writeFileSync(path.join(notesDirectory, newFilename), "latest note");
    const oldTime = new Date("2026-10-30T12:00:00Z");
    const newTime = new Date("2026-10-31T12:00:00Z");
    fs.utimesSync(path.join(notesDirectory, oldFilename), oldTime, oldTime);
    fs.utimesSync(path.join(notesDirectory, newFilename), newTime, newTime);

    assert.ok(readDiary("2026-10-31", directory, "2026-10-31").includes("daily diary"));
    assert.ok(!readDiary("2026-10-31", directory, "2026-10-31").includes("latest note"));
    assert.equal(readDiary(undefined, directory, "2026-10-31", true), "latest note");
    assert.equal(readDiary(undefined, directory, "2026-10-31", oldFilename), "old note");
    assert.match(readDiary(undefined, directory, "2026-10-31", "../outside.md"), /只能指定/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("truncates oversized notes from the end", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "diary-tool-"));
  const notesDirectory = path.join(directory, "notes");
  fs.mkdirSync(notesDirectory);
  const filename = "window-2026-10-31T12-00-00-000Z.md";
  try {
    fs.writeFileSync(path.join(notesDirectory, filename), "old".repeat(5000) + "\n\nLATEST PARAGRAPH");

    const result = readDiary(undefined, directory, "2026-10-31", filename);

    assert.ok(Array.from(result).length <= MAX_DIARY_CHARS);
    assert.ok(result.startsWith("[便签过长，已截断，以下为末尾内容]"));
    assert.ok(result.endsWith("LATEST PARAGRAPH"));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
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
