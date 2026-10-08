import { test } from "node:test";
import assert from "node:assert";

import {
  RULES,
  shannonEntropy,
  scanText,
  scanFiles,
  ScanError,
  assertClean,
} from "../src/scan.mjs";

// Fixtures are built by hand so each one is the shortest string that satisfies its own
// rule's length bound.
const AWS = "AKIA" + "A".repeat(16);
const GH = "ghp_" + "a".repeat(36);
const SLACK = "xoxb-" + "b".repeat(10);
const GOOGLE = "AIza" + "c".repeat(35);
const STRIPE = "sk_live_" + "d".repeat(24);
const JWT_PART = "eyJhbGZhT25lVHdvVGhyZWVGb3VyRml2ZQ";
// The head and tail of one part are cut 20 characters apart so all three dot separated
// segments reach the ten character minimum the rule asks for.
const JWT = `${JWT_PART}.${JWT_PART.slice(0, 20)}.${JWT_PART.slice(20)}`;
const ENTROPY = "ABCDEFGHIJKLmnopqrst01345678";

test("MCP-SCAN-001 the eight contract rules are named, in order", () => {
  assert.deepEqual(
    RULES.map((r) => r.name),
    [
      "private-key",
      "aws-access-key",
      "github-token",
      "slack-token",
      "google-api-key",
      "stripe-key",
      "jwt",
      "high-entropy-assignment",
    ],
  );
  assert.equal(RULES.length, 8);
  assert.equal(RULES.every((r) => typeof r.test === "function"), true);
});

test("MCP-SCAN-001 each of the seven literal rules matches its own fixture", () => {
  const byName = new Map(RULES.map((r) => [r.name, r]));
  const cases = [
    ["private-key", "-----BEGIN RSA PRIVATE KEY-----"],
    ["aws-access-key", AWS],
    ["github-token", GH],
    ["slack-token", SLACK],
    ["google-api-key", GOOGLE],
    ["stripe-key", STRIPE],
    ["jwt", JWT],
    ["high-entropy-assignment", `MY_KEY=${ENTROPY}`],
  ];
  for (const [name, line] of cases) {
    assert.equal(byName.get(name).test(line), true, name);
  }
});

test("MCP-SCAN-001 the literal rules do not match the plain fixtures", () => {
  const byName = new Map(RULES.map((r) => [r.name, r]));
  // Every rule is tested against the whole set of fixtures, so a pattern that is too
  // permissive shows up as an extra rule name on a short line.
  const expected = [
    ["private-key", ["-----BEGIN RSA PRIVATE KEY-----"]],
    ["aws-access-key", [AWS]],
    ["github-token", [GH]],
    ["slack-token", [SLACK]],
    ["google-api-key", [GOOGLE]],
    ["stripe-key", [STRIPE]],
    ["jwt", [JWT]],
    ["high-entropy-assignment", [`MY_KEY=${ENTROPY}`]],
  ];
  for (const [name, own] of expected) {
    const rule = byName.get(name);
    for (const line of own) assert.equal(rule.test(line), true, `${name} <- own`);
    for (const [, others] of expected.filter((e) => e[0] !== name)) {
      for (const line of others) assert.equal(rule.test(line), false, `${name} <- ${others[0]}`);
    }
  }
});

test("MCP-SCAN-001 shannonEntropy returns bits per character", () => {
  assert.equal(shannonEntropy(""), 0);
  assert.equal(shannonEntropy("aaaa"), 0);
  assert.equal(shannonEntropy("ab"), 1);
  assert.equal(shannonEntropy("aabb"), 1);
  // Four distinct symbols, evenly spread, is two bits per character. A repeated symbol
  // carries its own weight, so three of six symbols is 1.584962500721156.
  assert.equal(shannonEntropy("abcd"), 2);
  assert.equal(shannonEntropy("abcabc"), 1.584962500721156);
  // "3000" is one 3 and three 0 in four characters.
  assert.equal(shannonEntropy("3000"), 0.8112781244591328);
});

test("MCP-SCAN-001 the two halves of the assignment bound act apart", () => {
  // The 28 symbol fixture clears 4.0 bits, while its first 20 characters, which are 4.32
  // bits, fail only on the length half of the bound.
  assert.equal(shannonEntropy(ENTROPY) > 4.0, true);
  assert.equal(shannonEntropy(ENTROPY.slice(0, 20)) > 4.0, true);
  assert.deepEqual(scanText(`MY_KEY=${ENTROPY.slice(0, 20)}`, "b.md"), []);
  // Four symbols in 24 characters is 2 bits, under the bound, so a low entropy value
  // stays clean even with enough length.
  assert.deepEqual(scanText(`ABCD=${"abcd".repeat(6)}`, "b.md"), []);
});

test("MCP-SCAN-001 plain content does not trip the assignment rule", () => {
  const cases = [
    "The context window meets on wednesdays to review member progress.",
    "https://example.com/projects/the-context-window/index.html",
    "PORT=3000",
  ];
  for (const line of cases) assert.deepEqual(scanText(line, "a.md"), []);
});

test("MCP-SCAN-001 a long base64 assignment trips the assignment rule", () => {
  assert.deepEqual(scanText(`MY_KEY=${ENTROPY}`, "b.md"), [
    { path: "b.md", line: 1, rule: "high-entropy-assignment" },
  ]);
  // The value has to be over 20 characters, so the first 20 of it stay clean even though
  // their entropy clears the bound.
  assert.deepEqual(scanText(`MY_KEY=${ENTROPY.slice(0, 20)}`, "b.md"), []);
  // A lowercase key is not the contract's key shape.
  assert.deepEqual(scanText(`my_key=${ENTROPY}`, "b.md"), []);
  // The rule needs an assignment, so a bare value is not a finding.
  assert.deepEqual(scanText(ENTROPY, "b.md"), []);
  // Quoting the value is allowed and still found.
  assert.deepEqual(scanText(`MY_KEY="${ENTROPY}"`, "b.md"), [
    { path: "b.md", line: 1, rule: "high-entropy-assignment" },
  ]);
});

test("MCP-SCAN-001 scanFiles walks every file and every line", () => {
  const text = [
    "PORT=3000",
    `1: ${AWS}`,
    `2: ${GH}`,
    "",
    `3: ${STRIPE}`,
    `4: ${JWT}`,
  ].join("\n");
  const findings = scanFiles([
    { path: "a.md", content: text },
    { path: "b.md", content: "nothing here\n" },
    { path: "c.md", content: `5: ${SLACK}` },
  ]);
  assert.deepEqual(findings, [
    { path: "a.md", line: 2, rule: "aws-access-key" },
    { path: "a.md", line: 3, rule: "github-token" },
    { path: "a.md", line: 5, rule: "stripe-key" },
    { path: "a.md", line: 6, rule: "jwt" },
    { path: "c.md", line: 1, rule: "slack-token" },
  ]);
  assert.equal(scanFiles([]).length, 0);
});

test("MCP-SCAN-001 scanText reports the 1-based line the match sits on", () => {
  const findings = scanText(`-----BEGIN CERTIFICATE-----\n\n${AWS}`, "d.md");
  assert.deepEqual(findings, [
    { path: "d.md", line: 1, rule: "private-key" },
    { path: "d.md", line: 3, rule: "aws-access-key" },
  ]);
});

test("MCP-SCAN-002 every finding carries path, line and rule and no value", () => {
  const files = [{ path: "a.md", content: `${GOOGLE}\n${SLACK}` }];
  const findings = scanFiles(files);
  assert.equal(findings.length, 2);
  for (const f of findings) {
    assert.deepEqual(Object.keys(f).sort(), ["line", "path", "rule"]);
    assert.equal(typeof f.line, "number");
    assert.equal(typeof f.rule, "string");
  }
  const joined = JSON.stringify(findings);
  assert.equal(joined.includes(GOOGLE), false);
  assert.equal(joined.includes(SLACK), false);
});

test("MCP-SCAN-002 the ScanError message names each finding and says nothing was written", () => {
  let err;
  try {
    assertClean([{ path: "a.md", content: `-----BEGIN CERTIFICATE-----\n${AWS}` }]);
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof ScanError);
  assert.equal(err.findings.length, 2);
  assert.match(err.message, /^Secret scan rejected the write \(2 finding\(s\)\):/);
  assert.match(err.message, /a\.md:1 private-key/);
  assert.match(err.message, /a\.md:2 aws-access-key/);
  assert.match(err.message, /Nothing was written\.$/);
  // The values are still absent from the message.
  assert.equal(err.message.includes(AWS), false);
});

test("MCP-SCAN-002 assertClean returns the findings for clean content", () => {
  assert.deepEqual(assertClean([{ path: "a.md", content: "PORT=3000" }]), []);
  assert.deepEqual(assertClean([]), []);
});

// The caller pattern is: scan, then go to the network. The fake client counts its own
// calls so the order is observable without a real fetch.
test("MCP-SCAN-003 assertClean throws before the fake client is reached", async () => {
  const calls = [];
  const client = { fetch: async (url, init) => void calls.push([url, init]) };

  const handler = async (files) => {
    assertClean(files);
    await client.fetch("https://api.github.com/repos/x/contents/y", { body: "p" });
    return "written";
  };

  let caught;
  try {
    await handler([{ path: "a.md", content: `MY_KEY=${ENTROPY}` }]);
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof ScanError);
  assert.equal(caught.findings.length, 1);
  assert.equal(calls.length, 0);

  // The same handler with clean content does reach the client, so the zero above is the
  // scan's doing rather than an unused fake. The promise has to be awaited because the
  // fake fetch is a microtask.
  await handler([{ path: "a.md", content: "PORT=3000" }]);
  assert.equal(calls.length, 1);
});

test("MCP-SCAN-003 the scan is the whole gate: multiple files, first failure reported with all findings", () => {
  const files = [
    { path: "a.md", content: `1: ${GOOGLE}` },
    { path: "b.md", content: `x\n2: ${JWT}` },
    { path: "c.md", content: "plain" },
  ];
  assert.throws(
    () => assertClean(files),
    (e) =>
      e instanceof ScanError &&
      e.findings.length === 2 &&
      /a\.md:1 google-api-key/.test(e.message) &&
      /b\.md:2 jwt/.test(e.message),
  );
});
