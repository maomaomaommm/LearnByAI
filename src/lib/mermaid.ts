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

/** Greek/symbol LaTeX commands → Unicode. None are Mermaid structural tokens,
 *  so replacing them anywhere in the diagram is safe. Deliberately excludes
 *  arrow-like commands (\to, \rightarrow) so we never synthesize Mermaid edges. */
const LATEX_SYMBOLS: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε",
  zeta: "ζ", eta: "η", theta: "θ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ",
  nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ",
  phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ",
  Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  cdot: "·", times: "×", leq: "≤", geq: "≥", neq: "≠", approx: "≈", infty: "∞",
  nabla: "∇", sum: "Σ", prod: "Π", in: "∈",
};

/**
 * Mermaid renders labels as plain text, so any LaTeX a model leaves in a node/
 * edge label (`$...$`, `\pi`, `_{t+1}`, `\text{ref}`) shows up as literal source.
 * Reduce it to a readable plain-text approximation. `$`, `\<greek>`, `\text{}`,
 * and `_{}`/`^{}` never appear in Mermaid's own syntax, so this is safe to run
 * over the whole diagram (node ids like `state_1` keep their bare underscore).
 */
function stripMathNotation(code: string): string {
  let out = code.replace(/\$/gu, "");
  out = out.replace(/\\(?:text|mathrm|mathbf|mathbb|mathcal|operatorname)\s*\{([^{}]*)\}/gu, "$1");
  out = out.replace(/\\(?:hat|bar|tilde|vec|dot|widehat)\s*\{([^{}]*)\}/gu, "$1");
  // \pi, \gamma, … → Unicode. A letter boundary (\b) fails before `_`/subscripts,
  // so gate on "not followed by a letter"; longest name first (\varphi before \phi).
  for (const name of Object.keys(LATEX_SYMBOLS).sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`\\\\${name}(?![a-zA-Z])`, "gu"), LATEX_SYMBOLS[name]);
  }
  // Drop LaTeX grouping on sub/superscripts, keeping the marker: S_{t+1} → S_t+1.
  out = out.replace(/([_^])\{([^{}]*)\}/gu, "$1$2");
  return out;
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

  // Labels are plain text in Mermaid — strip any stray LaTeX so it doesn't render
  // literally (e.g. a node label `$\pi_{\text{ref}}$` → `π_ref`).
  out = stripMathNotation(out);

  // Mermaid requires the first line to declare the diagram type; models sometimes
  // omit it, which fails the whole diagram. Inject a sensible default so node/edge
  // content still renders instead of falling back to raw source.
  if (!hasDiagramHeader(out)) {
    out = `flowchart TD\n${out.replace(/^\s*\n/, "")}`;
  }

  return out;
}
