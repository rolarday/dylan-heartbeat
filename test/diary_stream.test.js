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

  const visible = filter.push("Visible\n<日记>private entry<结束日记>\ntail") + filter.finish();

  assert.equal(visible, "Visible\n\ntail");
  assert.deepEqual(diaries, ["private entry"]);
});

test("filters a diary block at the beginning of the message", () => {
  const diaries = [];
  const filter = createDiaryContentFilter(content => diaries.push(content));

  const visible = filter.push("<日记>private entry<结束日记>\nVisible") + filter.finish();

  assert.equal(visible, "\nVisible");
  assert.deepEqual(diaries, ["private entry"]);
});

test("saves diary and note blocks independently in one message", () => {
  const diaries = [];
  const notes = [];
  const filter = createDiaryContentFilter(
    content => diaries.push(content),
    content => notes.push(content)
  );

  const visible = filter.push(
    "Visible\n<日记>diary body<结束日记>\n<便签>note body<结束便签>\nDone"
  ) + filter.finish();

  assert.equal(visible, "Visible\n\n\nDone");
  assert.deepEqual(diaries, ["diary body"]);
  assert.deepEqual(notes, ["note body"]);
});

test("filters diary tags even when they are inline", () => {
  const diaries = [];
  const filter = createDiaryContentFilter(content => diaries.push(content));
  const content = "Visible <日记>ordinary mention<结束日记> tail";

  const visible = filter.push(content) + filter.finish();

  assert.equal(visible, "Visible  tail");
  assert.deepEqual(diaries, ["ordinary mention"]);
});

test("treats a nested note marker as ordinary text and closes at the outer marker", () => {
  const notes = [];
  const filter = createDiaryContentFilter(() => {}, content => notes.push(content));

  const visible = filter.push(
    "<便签>outer <日记>nested text<结束日记> remains<结束便签> visible"
  ) + filter.finish();

  assert.equal(visible, " visible");
  assert.deepEqual(notes, ["outer <日记>nested text<结束日记> remains"]);
});

test("discards and warns for an unmatched note end marker", () => {
  const warnings = [];
  const filter = createDiaryContentFilter(() => {}, () => {}, warning => warnings.push(warning));

  const visible = filter.push("Visible<结束便签>Tail") + filter.finish();

  assert.equal(visible, "VisibleTail");
  assert.deepEqual(warnings, [{ type: "unexpected-end", tag: "<结束便签>" }]);
});

test("keeps a split line-start tag hidden and discards an unclosed diary", () => {
  const diaries = [];
  const filter = createDiaryContentFilter(content => diaries.push(content));

  const visible = filter.push("Visible\n<日") +
    filter.push("记>private entry") +
    filter.finish();

  assert.equal(visible, "Visible\n");
  assert.deepEqual(diaries, []);
});

test("discards and warns for an unterminated note", () => {
  const notes = [];
  const warnings = [];
  const filter = createDiaryContentFilter(
    () => {},
    content => notes.push(content),
    warning => warnings.push(warning)
  );

  const visible = filter.push("Visible\n<便签>incomplete note") + filter.finish();

  assert.equal(visible, "Visible\n");
  assert.deepEqual(notes, []);
  assert.deepEqual(warnings, [{ type: "unterminated", mode: "note" }]);
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
    { choices: [{ index: 0, delta: { content: "公开🙂\n<日" } }] },
    { choices: [{ index: 0, delta: { content: "记>私密日记" } }] },
    { choices: [{ index: 0, delta: { content: "<结束日" } }] },
    { choices: [{ index: 0, delta: { content: "记>结束" } }] }
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
  assert.ok(!output.includes("<日记>"));
});

test("extracts closed diary tags from non-stream chat responses", () => {
  const diaries = [];
  const response = JSON.stringify({
    choices: [{ message: { role: "assistant", content: "Visible\n<日记>private<结束日记> tail" } }]
  });

  const result = filterCompletionResponse(response, content => diaries.push(content));

  assert.equal(result.changed, true);
  assert.equal(JSON.parse(result.responseText).choices[0].message.content, "Visible\n tail");
  assert.deepEqual(diaries, ["private"]);
});

test("filters inline diary tags in non-stream responses", () => {
  const diaries = [];
  const content = "Visible <日记>ordinary mention<结束日记> tail";
  const response = JSON.stringify({
    choices: [{ message: { role: "assistant", content } }]
  });

  const result = filterCompletionResponse(response, entry => diaries.push(entry));

  assert.equal(result.changed, true);
  assert.equal(JSON.parse(result.responseText).choices[0].message.content, "Visible  tail");
  assert.deepEqual(diaries, ["ordinary mention"]);
});

test("keeps non-diary non-stream responses byte-for-byte unchanged", () => {
  const response = '{ "choices": [{"message":{"content":"ordinary"}}] }';
  const result = filterCompletionResponse(response, () => {
    throw new Error("No diary should be written");
  });

  assert.deepEqual(result, { changed: false, responseText: response });
});
