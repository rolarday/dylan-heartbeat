const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  loadTimelineStore,
  migrateLegacyTimelineStore,
  readTimelineForKey,
  writeTimelineForKey
} = require("../timeline_store");

function withTimelineFile(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dylan-heartbeat-timeline-"));
  const filePath = path.join(directory, "enhanced_messages.json");
  try {
    run(filePath);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("stores and reads separate timelines for different model keys", () => {
  withTimelineFile(filePath => {
    writeTimelineForKey(filePath, "model-a", [{ role: "user", content: "A" }]);
    writeTimelineForKey(filePath, "model-b", [{ role: "user", content: "B" }]);

    assert.deepEqual(readTimelineForKey(filePath, "model-a"), [{ role: "user", content: "A" }]);
    assert.deepEqual(readTimelineForKey(filePath, "model-b"), [{ role: "user", content: "B" }]);
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(filePath, "utf-8"))).sort(), ["model-a", "model-b"]);
  });
});

test("migrates an existing array under the configured legacy model on write", () => {
  withTimelineFile(filePath => {
    const legacyTimeline = [{ role: "user", content: "legacy context" }];
    fs.writeFileSync(filePath, JSON.stringify(legacyTimeline));

    assert.deepEqual(readTimelineForKey(filePath, "model-a", "model-a"), legacyTimeline);
    writeTimelineForKey(filePath, "model-a", [...legacyTimeline, { role: "assistant", content: "new" }], "model-a");

    assert.deepEqual(
      JSON.parse(fs.readFileSync(filePath, "utf-8")),
      { "model-a": [...legacyTimeline, { role: "assistant", content: "new" }] }
    );
  });
});

test("migrates legacy storage before other models read it", () => {
  withTimelineFile(filePath => {
    const legacyTimeline = [{
      role: "user",
      content: "legacy context",
      reasoning_content: "remove while migrating"
    }];
    fs.writeFileSync(filePath, JSON.stringify(legacyTimeline));

    assert.equal(migrateLegacyTimelineStore(filePath, "model-a"), true);
    assert.deepEqual(readTimelineForKey(filePath, "model-a"), [{ role: "user", content: "legacy context" }]);
    assert.deepEqual(readTimelineForKey(filePath, "model-b"), []);
  });
});

test("rejects malformed timeline stores instead of silently dropping messages", () => {
  withTimelineFile(filePath => {
    fs.writeFileSync(filePath, JSON.stringify({ "model-a": "not an array" }));
    assert.throws(() => loadTimelineStore(filePath), /必须是数组/);
  });
});
