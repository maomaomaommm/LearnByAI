import katex from "katex";

/**
 * The single authority for "is this string renderable math".
 *
 * Instead of guessing with regexes whether some text is a formula, we ask KaTeX
 * itself — the same engine the reader uses (rehype-katex runs with
 * throwOnError:false, strict:false). If KaTeX can render it, it is valid math;
 * if KaTeX throws, it is broken/incomplete LaTeX (e.g. a trailing `^` with no
 * operand) and must NOT be wrapped as a formula.
 *
 * Note: KaTeX renders almost any plain string (a word, CJK) without throwing, so
 * this judge only decides *syntactic validity*, not "is it a formula". Callers
 * still apply a lightweight candidate gate (must look like math) before trusting
 * this — the gate selects candidates, KaTeX makes the final ruling.
 */
export function canRenderMath(latex: string, displayMode = false): boolean {
  const s = latex.trim();
  if (!s) return false;
  try {
    katex.renderToString(s, { throwOnError: true, strict: false, displayMode });
    return true;
  } catch {
    return false;
  }
}
