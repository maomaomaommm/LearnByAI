/**
 * Deterministic Mermaid source normalization.
 *
 * LLMs make two common, fatal Mermaid mistakes:
 *  1. Prose-style Unicode arrows (→, ⟶, ⇒, …) instead of ASCII edges
 *     (`-->`, `->>`). Mermaid throws "Syntax error in text".
 *  2. Omitting the required first-line diagram-type declaration
 *     (`flowchart TD`, `sequenceDiagram`, …), which fails the whole diagram.
 *
 * Both turn a diagram into an error graphic. We repair them here before handing
 * the code to Mermaid, which fixes already-generated content without a
 * regeneration.
 */

/** Unicode arrow glyphs LLMs use in place of Mermaid's ASCII `-->`. */
const UNICODE_ARROWS =
  /[→↔↝↠⇒⇔⇨⇾➡➙➜➝➞➟⟶⟷⟹⟺⭢⮕]/g;

/** Mermaid diagram-type keywords that may open a diagram (first meaningful line). */
const DIAGRAM_TYPES = [
  "flowchart",
  "graph",
  "sequenceDiagram",
  "classDiagram",
  "stateDiagram-v2",
  "stateDiagram",
  "erDiagram",
  "journey",
  "gantt",
  "pie",
  "mindmap",
  "timeline",
  "quadrantChart",
  "gitGraph",
  "requirementDiagram",
  "C4Context",
  "C4Container",
  "C4Component",
  "C4Dynamic",
  "sankey-beta",
  "xychart-beta",
  "block-beta",
  "packet-beta",
  "kanban",
  "architecture-beta",
  "zenuml",
];

/** True if the first non-blank, non-directive line opens a known diagram type. */
function hasDiagramHeader(code: string): boolean {
  for (const rawLine of code.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue; // skip blank lines
    if (line.startsWith("%%")) continue; // skip %%{init}%% directives / comments
    return DIAGRAM_TYPES.some((type) => line === type || line.startsWith(`${type} `) || line.startsWith(`${type}\t`));
  }
  return false;
}

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

  // Mermaid requires the first line to declare the diagram type; models sometimes
  // omit it, which fails the whole diagram. Inject a sensible default so node/edge
  // content still renders instead of falling back to raw source.
  if (!hasDiagramHeader(out)) {
    out = `flowchart TD\n${out.replace(/^\s*\n/, "")}`;
  }

  return out;
}
