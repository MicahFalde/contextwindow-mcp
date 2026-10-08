import { test } from "node:test";
import assert from "node:assert";

import { registerPrompts } from "../src/prompts.mjs";

// The same capture pattern the tool suite uses. The SDK hands the config and the callback as
// two arguments, so the capture merges them into one record per name.
function captured() {
  const registry = { _registeredTools: {}, _registeredPrompts: {} };
  registry.registerTool = (name, config, handler) => {
    registry._registeredTools[name] = { ...config, handler };
  };
  registry.registerPrompt = (name, config, callback) => {
    registry._registeredPrompts[name] = { ...config, callback };
  };
  registerPrompts(registry);
  return registry;
}

// The prompt body is the single text block of the one message.
function textOf(registry, name) {
  const { messages } = registry._registeredPrompts[name].callback();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, "user");
  assert.equal(messages[0].content.type, "text");
  return messages[0].content.text;
}

test("MCP-PROMPT-002 two prompts are registered, each with a description and a handler", () => {
  const { _registeredPrompts: prompts } = captured();
  assert.deepEqual(Object.keys(prompts), ["prep", "brief"]);
  for (const name of ["prep", "brief"]) {
    assert.match(prompts[name].description, /.+/, name);
    assert.equal(typeof prompts[name].callback, "function", name);
  }
});

// The five steps are asserted as substrings in order, which is what makes the sequence part of
// the check rather than the set.
test("MCP-PROMPT-001 prep walks git log, the extra ask, the draft, the attach, then the write", () => {
  const text = textOf(captured(), "prep");
  const steps = [
    "git log for the last 7 days in the current directory",
    "Ask the member what else they did",
    "Draft a three-sentence roundtable item",
    "Ask whether to attach any code",
    "Call add_agenda_item only after the member approves",
  ];
  let at = 0;
  for (const step of steps) {
    const found = text.indexOf(step, at);
    assert.notEqual(found, -1, `missing step: ${step}`);
    at = found + step.length;
  }
});

test("MCP-PROMPT-001 the prep steps are numbered one per line, in five lines", () => {
  const lines = textOf(captured(), "prep").split("\n");
  assert.deepEqual(
    lines.filter((l) => /^[0-9]\./.test(l)).map((l) => l.slice(0, 2)),
    ["1.", "2.", "3.", "4.", "5."],
  );
});

test("MCP-PROMPT-002 brief calls both read tools and presents one screen grouped by member", () => {
  const text = textOf(captured(), "brief");
  const steps = ["Call list_agenda", "Call get_projects", "one screen grouped by member"];
  let at = 0;
  for (const step of steps) {
    const found = text.indexOf(step, at);
    assert.notEqual(found, -1, `missing step: ${step}`);
    at = found + step.length;
  }
});

test("MCP-PROMPT-001 the prep text carries no other tool name than add_agenda_item", () => {
  const text = textOf(captured(), "prep");
  assert.equal(text.includes("list_agenda"), false);
  assert.equal(text.includes("get_projects"), false);
  assert.equal(text.includes("add_agenda_item"), true);
});
