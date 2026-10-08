// Share size and path checks, the two gate sets a `files` payload has to pass before the
// writer touches the data repo. Both are pure so the tool handler can call them in order
// and stop at the first failure.

// MCP-SHARE-002
// The three numbers are the limits named in CONTRACT.md. They ride as data so the tool
// descriptions can quote the same values the validator compares against.
export const LIMITS = {
  files: 25,
  perFileBytes: 250 * 1024,
  totalBytes: 2 * 1024 * 1024,
};

// One class per failure family keeps the two kinds of complaint distinguishable by
// instance while both stay plain Errors for the handler to render.
export class LimitError extends Error {}
export class PathError extends Error {}

// MCP-SHARE-005
// Path shape first: `..` can climb out of `shares/<share-id>/`, a leading `/` is an
// absolute path that ignores that prefix, and `.env` files hold the tokens the scan is
// there to catch in the plain files.
function checkPath(path) {
  if (typeof path !== "string" || path.length === 0) {
    throw new PathError("file entry has no path");
  }
  if (path.includes("..")) throw new PathError(`path contains "..": ${path}`);
  if (path.startsWith("/")) throw new PathError(`path starts with "/": ${path}`);
  const base = path.split("/").at(-1);
  if (base === ".env" || base.startsWith(".env.")) {
    throw new PathError(`basename is a dotenv file: ${base}`);
  }
}

// MCP-SHARE-002
// Byte sizes come from Buffer.byteLength in utf8, which counts bytes rather than the
// code units of String.length, so a multi-byte character is charged what it costs on wire.
function byteLength(content) {
  return Buffer.byteLength(String(content ?? ""), "utf8");
}

// MCP-SHARE-002, MCP-SHARE-005
// Every entry is checked, not only the first, and the message names the limit together
// with the numbers that were compared. A caller that catches the error writes nothing,
// because the whole share is rejected by the throw rather than file by file.
export function validateFiles(files) {
  const list = files ?? [];

  if (list.length > LIMITS.files) {
    throw new LimitError(
      `too many files: ${list.length} > ${LIMITS.files} files per share`,
    );
  }

  let total = 0;
  for (const file of list) {
    checkPath(file?.path);
    const size = byteLength(file.content);
    if (size > LIMITS.perFileBytes) {
      throw new LimitError(
        `file too large: ${file.path} is ${size} bytes > ${LIMITS.perFileBytes} bytes per file`,
      );
    }
    total += size;
  }

  if (total > LIMITS.totalBytes) {
    throw new LimitError(`share too large: ${total} bytes > ${LIMITS.totalBytes} bytes total`);
  }

  return list;
}
