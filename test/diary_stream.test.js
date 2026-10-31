const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DiarySseFilter,
  createDiaryContentFilter,
  filterCompletionResponse
} = require("../diary_stream");

test("filters diary blocks beginning at the start of a line", () => {
  const diaries = [];
  const filter = createDiaryContentFilter(content => diaries.push(content));

  const visible = filter.push("Visible\n[DIARY]private entry[/DIARY]\ntail") + filter.finish();

  assert.equal(visible, "Visible\n\ntail");
  assert.deepEqual(diaries, ["private entry"]);
});

test("filters a diary block at the beginning of the message", () => {
  const diaries = [];
  const filter = createDiaryContentFilter(content => diaries.push(content));

  const visible = filter.push("[DIARY]private entry[/DIARY]\nVisible") + filter.finish();

  assert.equal(visible, "\nVisible");
  assert.deepEqual(diaries, ["private entry"]);
});

test("does not treat an inline diary tag as a diary block", () => {
  const diaries = [];
  const filter = createDiaryContentFilter(content => diaries.push(content));
  const content = "Visible [DIARY]ordinary mention[/DIARY] tail";

  const visible = filter.push(content) + filter.finish();

  assert.equal(visible, content);
  assert.deepEqual(diaries, []);
});

test("keeps a split line-start tag hidden and discards an unclosed diary", () => {
  const diaries = [];
  const filter = createDiaryContentFilter(content => diaries.push(content));

  const visible = filter.push("Visible\n[DIA") +
    filter.push("RY]private entry") +
    filter.finish();

  assert.equal(visible, "Visible\n");
  assert.deepEqual(diaries, []);
});

test("passes through ordinary SSE frames unchanged", () => {
  const stream = new DiarySseFilter(() => {
    throw new Error("No diary should be written");
  });
  const frame = 'data: {"choices":[{"index":0,"delta":{"content":"ordinary text"}}]}\n\n';

  assert.equal(stream.push(Buffer.from(frame)), frame);
  assert.equal(stream.finish(), "");
});

test("filters diary tags split between SSE events and UTF-8 byte chunks", () => {
  const diaries = [];
  const stream = new DiarySseFilter(content => diaries.push(content));
  const frames = [
    { choices: [{ index: 0, delta: { content: "公开🙂\n[DIA" } }] },
    { choices: [{ index: 0, delta: { content: "RY]私密日记" } }] },
    { choices: [{ index: 0, delta: { content: "[/DIA" } }] },
    { choices: [{ index: 0, delta: { content: "RY]结束" } }] }
  ].map(payload => `data: ${JSON.stringify(payload)}\n\n`);
  const input = Buffer.from(`${frames.join("")}data: [DONE]\n\n`);
  const splitAt = input.indexOf(Buffer.from("🙂")) + 2;
  const output = stream.push(input.subarray(0, splitAt)) +
    stream.push(input.subarray(splitAt)) +
    stream.finish();
  const visibleContent = Array.from(output.matchAll(/"content":"((?:\\.|[^"\\])*)"/g))
    .map(match => JSON.parse(`"${match[1]}"`))
    .join("");

  assert.equal(visibleContent, "公开🙂\n结束");
  assert.deepEqual(diaries, ["私密日记"]);
  assert.ok(!output.includes("私密日记"));
  assert.ok(!output.includes("[DIARY]"));
});

test("extracts closed diary tags from non-stream chat responses", () => {
  const diaries = [];
  const response = JSON.stringify({
    choices: [{ message: { role: "assistant", content: "Visible\n[DIARY]private[/DIARY] tail" } }]
  });

  const result = filterCompletionResponse(response, content => diaries.push(content));

  assert.equal(result.changed, true);
  assert.equal(JSON.parse(result.responseText).choices[0].message.content, "Visible\n tail");
  assert.deepEqual(diaries, ["private"]);
});

test("keeps inline diary tags unchanged in non-stream responses", () => {
  const diaries = [];
  const content = "Visible [DIARY]ordinary mention[/DIARY] tail";
  const response = JSON.stringify({
    choices: [{ message: { role: "assistant", content } }]
  });

  const result = filterCompletionResponse(response, entry => diaries.push(entry));

  assert.equal(result.changed, false);
  assert.equal(result.responseText, response);
  assert.deepEqual(diaries, []);
});

test("keeps non-diary non-stream responses byte-for-byte unchanged", () => {
  const response = '{ "choices": [{"message":{"content":"ordinary"}}] }';
  const result = filterCompletionResponse(response, () => {
    throw new Error("No diary should be written");
  });

  assert.deepEqual(result, { changed: false, responseText: response });
});
