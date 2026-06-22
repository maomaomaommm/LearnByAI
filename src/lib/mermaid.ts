/**
 * Deterministic Mermaid source normalization.
 *
 * LLMs frequently emit prose-style Unicode arrows (→, ⟶, ⇒, …) instead of
 * Mermaid's ASCII edge tokens (`-->`, `->>`). Mermaid cannot parse those and
 * throws "Syntax error in text", so a single bad arrow turns the whole diagram
 * into an error graphic. We fix the common, unambiguous mistakes here before
 * handing the code to Mermaid, which repairs already-generated content without
 * requiring a regeneration.
 */

/** Unicode arrow glyphs LLMs use in place of Mermaid's ASCII `-->`. */
const UNICODE_ARROWS =
  /[→↔↝↠⇒⇔⇨⇾➡➙➜➝➞➟⟶⟷⟹⟺⭢⮕]/g;

export function normalizeMermaidCode(code: string): string {
  if (!code) return code;

  // Sequence diagrams use `->>` for messages; flowcharts/most others use `-->`.
  const isSequence = /^\s*sequenceDiagram\b/.test(code);
  const arrow = isSequence ? "->>" : "-->";

  let out = code.replace(UNICODE_ARROWS, ` ${arrow} `);

  // Collapse artifacts from the substitution: doubled arrows and extra spaces.
  out = out
    .replace(/(-->|->>)\s+(-->|->>)/g, "$1")
    .replace(/[ \t]{2,}(-->|->>)/g, " $1")
    .replace(/(-->|->>)[ \t]{2,}/g, "$1 ");

  return out;
}
