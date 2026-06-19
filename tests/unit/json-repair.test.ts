import assert from "node:assert/strict";
import { test } from "node:test";
import { repairInvalidJsonEscapes } from "../../src/lib/jsonRepair";

test("JSON escape repair doubles invalid LaTeX-style backslashes in strings", () => {
  const bad = String.raw`{"passed":false,"issues":[{"severity":"medium","category":"math","message":"公式 \(R_n = S_n + L_n\) 和 \frac{1}{2} 需要解释","suggestion":"补充符号说明"}],"summary":"ok"}`;
  assert.throws(() => JSON.parse(bad), /Bad escaped character|Unexpected token/u);

  const repaired = repairInvalidJsonEscapes(bad);
  const parsed = JSON.parse(repaired) as { issues: Array<{ message: string }> };

  assert.match(parsed.issues[0].message, /\\\(R_n/u);
  assert.match(parsed.issues[0].message, /\\frac/u);
});

test("JSON escape repair preserves valid JSON escapes", () => {
  const source = String.raw`{"message":"第一行\n第二行","quote":"He said \"ok\"","slash":"a\/b","unicode":"\u4e2d"}`;
  const parsed = JSON.parse(repairInvalidJsonEscapes(source)) as {
    message: string;
    quote: string;
    slash: string;
    unicode: string;
  };

  assert.equal(parsed.message, "第一行\n第二行");
  assert.equal(parsed.quote, "He said \"ok\"");
  assert.equal(parsed.slash, "a/b");
  assert.equal(parsed.unicode, "中");
});
