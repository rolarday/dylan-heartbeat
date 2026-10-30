const { StringDecoder } = require("node:string_decoder");

const DIARY_START_TAG = "[DIARY]";
const DIARY_END_TAG = "[/DIARY]";

function trailingTagPrefixLength(text, tag) {
  const maxLength = Math.min(text.length, tag.length - 1);
  for (let length = maxLength; length > 0; length--) {
    if (text.endsWith(tag.slice(0, length))) return length;
  }
  return 0;
}

function createDiaryContentFilter(onDiary) {
  let inDiary = false;
  let pending = "";
  let diaryContent = "";

  return {
    push(text) {
      let input = pending + String(text || "");
      pending = "";
      let visible = "";

      while (input) {
        if (!inDiary) {
          const startIndex = input.indexOf(DIARY_START_TAG);
          if (startIndex >= 0) {
            visible += input.slice(0, startIndex);
            input = input.slice(startIndex + DIARY_START_TAG.length);
            inDiary = true;
            diaryContent = "";
            continue;
          }

          const suffixLength = trailingTagPrefixLength(input, DIARY_START_TAG);
          visible += suffixLength ? input.slice(0, -suffixLength) : input;
          pending = suffixLength ? input.slice(-suffixLength) : "";
          break;
        }

        const endIndex = input.indexOf(DIARY_END_TAG);
        if (endIndex >= 0) {
          diaryContent += input.slice(0, endIndex);
          onDiary(diaryContent);
          diaryContent = "";
          input = input.slice(endIndex + DIARY_END_TAG.length);
          inDiary = false;
          continue;
        }

        const suffixLength = trailingTagPrefixLength(input, DIARY_END_TAG);
        diaryContent += suffixLength ? input.slice(0, -suffixLength) : input;
        pending = suffixLength ? input.slice(-suffixLength) : "";
        break;
      }

      return visible;
    },
    finish() {
      if (inDiary) {
        pending = "";
        diaryContent = "";
        return "";
      }
      const visible = pending;
      pending = "";
      return visible;
    },
    get canBypass() {
      return !inDiary && !pending;
    }
  };
}

function parseSseDataFrame(frame) {
  const lines = frame.split(/\r\n|\n|\r/);
  const dataIndexes = [];
  const data = [];

  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].startsWith("data:")) continue;
    dataIndexes.push(index);
    data.push(lines[index].slice(5).replace(/^ /, ""));
  }

  return { lines, dataIndexes, data: data.join("\n") };
}

function replaceSseData(lines, dataIndexes, payload) {
  const replacement = `data: ${JSON.stringify(payload)}`;
  if (dataIndexes.length === 0) return lines.join("\n");
  const firstDataIndex = dataIndexes[0];
  const dataIndexSet = new Set(dataIndexes);
  return lines
    .map((line, index) => {
      if (index === firstDataIndex) return replacement;
      return dataIndexSet.has(index) ? null : line;
    })
    .filter(line => line !== null)
    .join("\n");
}

function hasDiaryStartCandidate(frame) {
  const contentKey = /"content"\s*:\s*"/g;
  let match;

  while ((match = contentKey.exec(frame)) !== null) {
    let escaped = false;
    for (let index = contentKey.lastIndex; index < frame.length; index++) {
      const character = frame[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        if (frame.slice(index, index + 6).toLowerCase() === "\\u005b") return true;
        escaped = true;
        continue;
      }
      if (character === '"') break;
      if (character === "[") return true;
    }
  }

  return false;
}

class DiarySseFilter {
  constructor(onDiary) {
    this.decoder = new StringDecoder("utf8");
    this.buffer = "";
    this.onDiary = onDiary;
    this.filters = new Map();
    this.finished = false;
  }

  push(chunk) {
    if (this.finished) throw new Error("Cannot write to a finished diary stream filter");
    this.buffer += this.decoder.write(Buffer.from(chunk));
    let output = "";

    while (true) {
      const delimiter = /\r\n\r\n|\n\n|\r\r/.exec(this.buffer);
      if (!delimiter) break;

      const frame = this.buffer.slice(0, delimiter.index);
      const separator = delimiter[0];
      this.buffer = this.buffer.slice(delimiter.index + separator.length);
      output += this.processFrame(frame, separator);
    }

    return output;
  }

  finish() {
    if (this.finished) return "";
    this.finished = true;
    this.buffer += this.decoder.end();

    let output = "";
    if (this.buffer) {
      output += this.processFrame(this.buffer, "");
      this.buffer = "";
    }

    output += this.flushPendingContent();
    return output;
  }

  processFrame(frame, separator) {
    const rawFrame = `${frame}${separator}`;
    const parsedFrame = parseSseDataFrame(frame);
    if (parsedFrame.data === "[DONE]") {
      return this.flushPendingContent() + rawFrame;
    }

    const hasPendingFilter = Array.from(this.filters.values()).some(filter => !filter.canBypass);
    if (!hasPendingFilter && !hasDiaryStartCandidate(frame)) {
      return rawFrame;
    }
    if (parsedFrame.dataIndexes.length === 0) return rawFrame;

    let payload;
    try {
      payload = JSON.parse(parsedFrame.data);
    } catch {
      return rawFrame;
    }

    if (!Array.isArray(payload?.choices)) return rawFrame;
    let changed = false;

    for (let index = 0; index < payload.choices.length; index++) {
      const choice = payload.choices[index];
      const choiceIndex = Number.isInteger(choice?.index) ? choice.index : index;
      const delta = choice?.delta;
      if (typeof delta?.content !== "string") continue;

      let filter = this.filters.get(choiceIndex);
      if (!filter) {
        filter = createDiaryContentFilter(this.onDiary);
        this.filters.set(choiceIndex, filter);
      }
      const visibleContent = filter.push(delta.content);
      if (visibleContent !== delta.content) {
        delta.content = visibleContent;
        changed = true;
      }
    }

    if (!changed) return rawFrame;
    return `${replaceSseData(parsedFrame.lines, parsedFrame.dataIndexes, payload)}${separator}`;
  }

  flushPendingContent() {
    const choices = [];
    for (const [index, filter] of this.filters) {
      const content = filter.finish();
      if (content) choices.push({ index, delta: { content } });
    }
    if (choices.length === 0) return "";
    return `data: ${JSON.stringify({ choices })}\n\n`;
  }
}

function filterCompletionResponse(responseText, onDiary) {
  if (!responseText.includes(DIARY_START_TAG) && !responseText.includes(DIARY_END_TAG)) {
    return { changed: false, responseText };
  }

  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch {
    return { changed: false, responseText };
  }
  if (!Array.isArray(payload?.choices)) return { changed: false, responseText };

  let changed = false;
  for (const choice of payload.choices) {
    const content = choice?.message?.content;
    if (typeof content !== "string") continue;

    const filter = createDiaryContentFilter(onDiary);
    const visibleContent = filter.push(content) + filter.finish();
    if (visibleContent !== content) {
      choice.message.content = visibleContent;
      changed = true;
    }
  }

  return {
    changed,
    responseText: changed ? JSON.stringify(payload) : responseText
  };
}

module.exports = {
  DiarySseFilter,
  createDiaryContentFilter,
  filterCompletionResponse
};
