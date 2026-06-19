import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const source = readFileSync(resolve("src/components/MarkdownContent.tsx"), "utf8");

test("MarkdownContent keeps block code rendering on pre wrapper", () => {
  assert.match(source, /throwOnError:\s*false/u);
  assert.match(source, /strict:\s*false/u);
  assert.match(source, /errorColor:\s*"currentColor"/u);
  assert.match(source, /singleTilde:\s*false/u);
  assert.ok(source.includes("[&_*]:!bg-transparent"));
  assert.ok(source.includes("CodeCopyButton"));
  assert.ok(source.includes("navigator.clipboard?.writeText"));
  assert.ok(source.includes("document.execCommand(\"copy\")"));
  assert.ok(source.includes("Fall back for browsers"));
  assert.ok(source.includes("aria-label={copied ? \"Copied code\" : \"Copy code\"}"));
  assert.ok(source.includes("pr-14"));
  assert.match(source, /import \{ Check, Copy \} from "lucide-react"/u);
  assert.doesNotMatch(source, /function\s+Code\s*\(/u);
});
