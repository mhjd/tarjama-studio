import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSafeProjectId,
  assertSafeSnapshotId,
  isLoopbackDevServer,
  mediaProjectIdFromPath,
  safeByteRange,
  safeFormatSelector,
  safeRemoteUrl,
  safeRendererAssetPath,
} from "../dist-electron/security.js";

test("local media byte ranges are strict and bounded", () => {
  assert.deepEqual(safeByteRange("bytes=0-", 1_000), { start: 0, end: 999 });
  assert.deepEqual(safeByteRange("bytes=100-199", 1_000), { start: 100, end: 199 });
  assert.deepEqual(safeByteRange("bytes=-100", 1_000), { start: 900, end: 999 });
  assert.deepEqual(safeByteRange("bytes=950-2000", 1_000), { start: 950, end: 999 });
  for (const value of ["bytes=", "bytes=200-100", "bytes=1000-", "bytes=0-1,4-5", "items=0-10"]) {
    assert.equal(safeByteRange(value, 1_000), null);
  }
});

test("project identifiers cannot escape the library", () => {
  assert.doesNotThrow(() => assertSafeProjectId("youtube_hm_hcq6rucc"));
  for (const value of ["../outside", "project/child", "/absolute", "", "UPPERCASE"]) {
    assert.throws(() => assertSafeProjectId(value));
  }
});

test("snapshot identifiers are plain JSON filenames", () => {
  assert.doesNotThrow(() => assertSafeSnapshotId("save_20260713T120000Z.json"));
  for (const value of ["../save.json", "save/child.json", "save.txt", "..json"]) {
    assert.throws(() => assertSafeSnapshotId(value));
  }
});

test("download URLs accept only credential-free HTTP(S)", () => {
  assert.equal(safeRemoteUrl("https://youtu.be/hM_hCQ6RUcc"), "https://youtu.be/hM_hCQ6RUcc");
  for (const value of ["--exec=bad", "file:///etc/passwd", "javascript:alert(1)", "https://user:pass@example.com/video"]) {
    assert.throws(() => safeRemoteUrl(value));
  }
});

test("format selectors must come from the analyzed metadata", () => {
  assert.equal(safeFormatSelector("18", ["best", "18"], "best"), "18");
  assert.equal(safeFormatSelector(undefined, ["best", "18"], "best"), "best");
  assert.throws(() => safeFormatSelector("--exec=bad", ["best", "18"], "best"));
});

test("development renderer is restricted to loopback", () => {
  assert.equal(isLoopbackDevServer("http://127.0.0.1:5173"), true);
  assert.equal(isLoopbackDevServer("http://localhost:5173"), true);
  assert.equal(isLoopbackDevServer("https://example.com"), false);
  assert.equal(isLoopbackDevServer("file:///tmp/index.html"), false);
});

test("local protocol serves only renderer assets and validated project media", () => {
  assert.equal(safeRendererAssetPath("/app/dist", "/assets/index.js"), "/app/dist/assets/index.js");
  assert.equal(safeRendererAssetPath("/app/dist", "/"), "/app/dist/index.html");
  assert.equal(mediaProjectIdFromPath("/media/youtube_hm_hcq6rucc"), "youtube_hm_hcq6rucc");
  for (const value of ["/../secret", "/assets/../../secret", "/assets\\..\\secret"]) {
    assert.throws(() => safeRendererAssetPath("/app/dist", value));
  }
  assert.equal(mediaProjectIdFromPath("/media/../secret"), null);
  assert.equal(mediaProjectIdFromPath("/media/project/extra"), null);
  assert.throws(() => mediaProjectIdFromPath("/media/UPPERCASE"));
});
