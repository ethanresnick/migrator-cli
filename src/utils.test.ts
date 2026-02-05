import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "path";

import { toAbsolutePath, toFileBaseName } from "./utils.js";

describe("toFileBaseName", () => {
  it("extracts basename from path", () => {
    const result = toFileBaseName("/path/to/file.sql");
    assert.equal(result, "file.sql");
  });

  it("returns input as-is when already a basename", () => {
    const result = toFileBaseName("file.sql");
    assert.equal(result, "file.sql");
  });

  it("handles empty string", () => {
    const result = toFileBaseName("");
    assert.equal(result, "");
  });
});

describe("toAbsolutePath", () => {
  it("returns absolute path unchanged", () => {
    const absPath = path.isAbsolute(process.cwd())
      ? process.cwd()
      : path.resolve(process.cwd());
    const result = toAbsolutePath(absPath);
    assert.equal(result, absPath);
  });

  it("resolves relative path", () => {
    const result = toAbsolutePath(".");
    assert.ok(path.isAbsolute(result as string));
  });
});
