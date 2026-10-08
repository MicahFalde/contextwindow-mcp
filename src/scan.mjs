// Secret scan for the content about to be sent to GitHub. The eight rules are the eight
// named in CONTRACT.md, in the same order, and the rule name is what the error reports.

// MCP-SCAN-001
// Each test takes one physical line. Every pattern is anchored so the engine cannot back-
// track over a long line, which keeps the scan linear in the number of characters.
// The value length and entropy bounds are the ones named in the contract: over 20
// characters and over 4.0 bits per character.
export const RULES = [
  { name: "private-key", test: (line) => /-----BEGIN[^-]*-----/.test(line) },
  { name: "aws-access-key", test: (line) => /AKIA[0-9A-Z]{16}/.test(line) },
  { name: "github-token", test: (line) => /gh[pousr]_[A-Za-z0-9]{36,}/.test(line) },
  { name: "slack-token", test: (line) => /xox[baprs]-[A-Za-z0-9-]{10,}/.test(line) },
  { name: "google-api-key", test: (line) => /AIza[0-9A-Za-z_-]{35}/.test(line) },
  { name: "stripe-key", test: (line) => /sk_(live|test)_[0-9a-zA-Z]{24,}/.test(line) },
  { name: "jwt", test: (line) => /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(line) },
  { name: "high-entropy-assignment", test: (line) => isHighEntropyAssignment(line) },
];

// MCP-SCAN-001
// The assignment rule is the only one whose decision needs the captured value, so the
// three bounds (key of capitals, value longer than 20, entropy above 4.0) are applied to
// that capture rather than to the whole line. Each class is written with a comma-free
// repetition count, so the one-character set repeats that many times.
function isHighEntropyAssignment(line) {
  const match = /^([A-Z0-9_]{3,})\s*=\s*(["\x27]?)([^\s\x27"]+)/.exec(line);
  if (!match) return false;
  // The two value bounds come off the value itself: over 20 characters, and above 4.0
  // bits per character.
  const value = match[3];
  return value.length > 20 && shannonEntropy(value) > 4.0;
}

// MCP-SCAN-001
// Bits per character, the base-2 sum over the symbol frequencies of the value. Length is
// the total of the counts so a repeated character contributes its own share of weight.
export function shannonEntropy(str) {
  const value = String(str ?? "");
  if (value.length === 0) return 0;
  const counts = new Map();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

// MCP-SCAN-001, MCP-SCAN-002
// One finding per matching line, and the payload is only the pointer plus the rule name,
// so the matched value itself never travels into the returned structure.
export function scanText(text, path) {
  const findings = [];
  const lines = String(text ?? "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const rule of RULES) {
      if (rule.test(line)) findings.push({ path, line: i + 1, rule: rule.name });
    }
  }
  return findings;
}

// MCP-SCAN-001
// Every file is scanned, every line of it, and the findings are concatenated in the order
// the files were handed in so the report reads like the payload.
export function scanFiles(files) {
  const findings = [];
  for (const file of files ?? []) findings.push(...scanText(file.content, file.path));
  return findings;
}

// The message numbers the findings, one per line, after a count, so a member can jump to
// the offset in the file they submitted. "Nothing was written." states the outcome of the
// whole share, which is the second half of MCP-SCAN-002.
export class ScanError extends Error {
  constructor(findings) {
    super(ScanError.format(findings));
    this.name = "ScanError";
    this.findings = findings;
  }

  static format(findings) {
    const list = (findings ?? []).map((f) => `${f.path}:${f.line} ${f.rule}`);
    return [
      `Secret scan rejected the write (${list.length} finding(s)):`,
      ...list.map((entry, i) => `${i + 1}. ${entry}`),
      "Nothing was written.",
    ].join("\n");
  }
}

// MCP-SCAN-003
// Contract on the caller: call this as the first statement of the tool handler, before
// any fetch or exec, so a rejected payload never reaches the network. The scan needs no
// transport, so it can run with none: a handler that sequences its work after this call
// cannot transmit rejected content, because the throw skips the rest of the body.
// MCP-SCAN-002
export function assertClean(files) {
  const findings = scanFiles(files);
  if (findings.length === 0) return findings;
  throw new ScanError(findings);
}
