"use client";

import { FormEvent } from "react";
import { PencilLine, RotateCcw, Trash2, Undo2, X } from "lucide-react";
import { useRevise } from "@/lib/hooks/useRevise";
import { RevisionMode, RevisionScope } from "@/lib/types";

const SCOPES: { value: RevisionScope; label: string }[] = [
  { value: "selection", label: "选区" },
  { value: "paragraph", label: "段落" },
  { value: "section", label: "小节" },
];

const MODES: { value: RevisionMode; label: string }[] = [
  { value: "rewrite", label: "按要求改写" },
  { value: "fix", label: "最小修复" },
];

const REWRITE_PRESETS: { label: string; intent: string }[] = [
  { label: "更详细", intent: "把这段讲得更详细一些，补充必要的展开。" },
  { label: "更简洁", intent: "把这段精简，去掉冗余，保留要点。" },
  { label: "多举例", intent: "为这段补充一个具体例子帮助理解。" },
  { label: "换个讲法", intent: "换一种更通俗易懂的讲法重写这段。" },
  { label: "更严谨", intent: "让这段更严谨，补全前提、条件与边界。" },
  { label: "加个图示", intent: "如果合适，为这段补充一个 Mermaid 图示帮助理解。" },
];

const FIX_PRESETS: { label: string; intent: string }[] = [
  { label: "检查/建议", intent: "请检查这段内容是否有公式、Markdown 或概念错误，并给出最小修复建议。" },
  { label: "最小修复", intent: "请修复这段内容中的格式、公式或明显表述问题，只做最小必要修改。" },
];

type RevisePanelProps = {
  revise: ReturnType<typeof useRevise>;
  onClose: () => void;
};

export function RevisePanel({ revise, onClose }: RevisePanelProps) {
  const { target, proposal, mode, scope, busy, error, revisions } = revise;
  const presets = mode === "rewrite" ? REWRITE_PRESETS : FIX_PRESETS;
  const history = revisions.filter((item) => item.status === "applied" || item.status === "reverted");

  function submitIntent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem("intent") as HTMLInputElement;
    if (input.value.trim()) void revise.propose(input.value);
    input.value = "";
  }

  return (
    <aside className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <PencilLine size={14} className="text-primary" />
          <span className="font-mono text-[11px] font-medium text-primary uppercase tracking-wider">局部改写</span>
        </div>
        <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:text-foreground">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
        {target ? (
          <div className="space-y-4">
            <button onClick={revise.clear} className="font-mono text-[10px] text-muted-foreground hover:text-foreground">
              ← 返回历史
            </button>
            <div>
              <p className="mb-1 font-mono text-[10px] text-muted-foreground">范围</p>
              <div className="flex gap-1">
                {SCOPES.map((item) => (
                  <button
                    key={item.value}
                    onClick={() => revise.setScope(item.value)}
                    className={`flex-1 border px-2 py-1 font-mono text-[10px] transition-colors ${
                      scope === item.value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1 font-mono text-[10px] text-muted-foreground">方式</p>
              <div className="flex gap-1">
                {MODES.map((item) => (
                  <button
                    key={item.value}
                    onClick={() => revise.setMode(item.value)}
                    className={`flex-1 border px-2 py-1 font-mono text-[10px] transition-colors ${
                      mode === item.value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-l-2 border-primary pl-3">
              <p className="font-mono text-[10px] text-muted-foreground mb-1">TARGET_TEXT</p>
              <div className="text-sm leading-relaxed text-foreground italic line-clamp-4">&quot;{target.selectedText}&quot;</div>
            </div>

            <div className="flex flex-wrap gap-2">
              {presets.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => void revise.propose(preset.intent)}
                  disabled={busy}
                  className="border border-border bg-background px-2 py-1 font-mono text-[10px] text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <form onSubmit={submitIntent} className="relative flex items-center">
              <span className="absolute left-3 font-mono text-[12px] text-primary">{">"}</span>
              <input
                name="intent"
                placeholder={mode === "rewrite" ? "描述你想怎么改..." : "描述要修复的问题..."}
                autoComplete="off"
                disabled={busy}
                className="w-full bg-background border border-border py-2 pl-7 pr-3 font-mono text-[12px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-50"
              />
            </form>

            {error && <p className="text-xs leading-relaxed text-destructive">{error}</p>}

            {busy && !proposal && <p className="font-mono text-[10px] text-primary animate-pulse">生成中...</p>}

            {proposal && (
              <div className="space-y-3 border border-border bg-background/70 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[10px] text-primary uppercase tracking-wider">
                    {proposal.mode === "rewrite" ? "REWRITE_PREVIEW" : "FIX_PREVIEW"}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {proposal.status === "applied" ? "APPLIED" : (proposal.confidence ?? "")}
                  </span>
                </div>
                {proposal.diagnosis && <p className="text-xs leading-relaxed text-muted-foreground">{proposal.diagnosis}</p>}
                <div>
                  <p className="mb-1 font-mono text-[10px] text-muted-foreground">原文 (BEFORE)</p>
                  <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap border border-border bg-muted/20 p-2 text-xs leading-relaxed text-muted-foreground">{proposal.beforeText}</pre>
                </div>
                <div>
                  <p className="mb-1 font-mono text-[10px] text-primary">改写后 (AFTER)</p>
                  <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap border border-primary/30 bg-primary/5 p-2 text-xs leading-relaxed text-foreground">{proposal.afterText}</pre>
                </div>
                <button
                  onClick={() => void revise.apply()}
                  disabled={busy || proposal.status !== "proposed"}
                  className="w-full border border-primary/50 bg-primary/10 px-3 py-2 font-mono text-[11px] text-primary transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {proposal.status === "applied" ? "已应用改写" : busy ? "应用中..." : "应用改写"}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">选中正文 → 选「改写此处」开始；下面是本章改写历史。</p>
            <div className="font-mono text-[10px] font-bold text-muted-foreground uppercase tracking-widest">改写历史 · {history.length}</div>
            {history.length === 0 ? (
              <p className="pt-8 text-center font-mono text-xs text-muted-foreground">暂无改写记录</p>
            ) : (
              <div className="space-y-1">
                {history.map((revision) => (
                  <div key={revision.id} className="group flex items-start gap-1 border border-border/60 bg-background/50 p-2">
                    <div className="flex-1">
                      <div className="font-mono text-[9px] uppercase text-muted-foreground/70">
                        {revision.scope} · {revision.mode} · {revision.status === "reverted" ? "已撤销" : "已应用"}
                      </div>
                      <div className="mt-0.5 text-xs line-clamp-2 text-foreground">{revision.intent}</div>
                    </div>
                    {revision.status === "applied" && (
                      <button
                        onClick={() => void revise.revert(revision.id)}
                        disabled={busy}
                        className="rounded p-1 text-muted-foreground/50 transition-colors hover:text-primary disabled:opacity-50"
                        title="撤销这次改写"
                      >
                        <Undo2 size={13} />
                      </button>
                    )}
                    {revision.status === "reverted" && (
                      <button
                        onClick={() => void revise.reapply(revision.id)}
                        disabled={busy}
                        className="rounded p-1 text-muted-foreground/50 transition-colors hover:text-primary disabled:opacity-50"
                        title="重新应用这次改写"
                        aria-label="重新应用这次改写"
                      >
                        <RotateCcw size={13} />
                      </button>
                    )}
                    <button
                      onClick={() => {
                        if (window.confirm("删除这条改写历史？正文内容不会改变。")) void revise.deleteRevision(revision.id);
                      }}
                      disabled={busy}
                      className="rounded p-1 text-muted-foreground/50 transition-colors hover:text-destructive disabled:opacity-50"
                      title="删除这条改写历史"
                      aria-label="删除这条改写历史"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {error && <p className="text-xs leading-relaxed text-destructive">{error}</p>}
          </div>
        )}
      </div>
    </aside>
  );
}
