"use client";

import { FormEvent } from "react";
import { Bot, MessageSquareQuote, Trash2, X } from "lucide-react";
import { MarkdownContent } from "@/components/MarkdownContent";
import { useTutor } from "@/lib/hooks/useTutor";

const quickQuestions = ["解释得更简单", "给我一个具体例子", "展示推导过程", "质疑这段内容"];

type TutorPanelProps = {
  tutor: ReturnType<typeof useTutor>;
  onClose: () => void;
};

export function TutorPanel({ tutor, onClose }: TutorPanelProps) {
  const { active, target, answering, annotations } = tutor;
  const inConversation = Boolean(active || target);

  const targetLabel = active
    ? active.selectedText ?? "整章泛问"
    : target?.scope === "anchored"
      ? target.selectedText
      : "整章泛问";

  function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem("question") as HTMLInputElement;
    void tutor.ask(input.value);
    input.value = "";
  }

  return (
    <aside className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <Bot size={14} className="text-primary" />
          <span className="font-mono text-[11px] font-medium text-primary uppercase tracking-wider">导师终端</span>
        </div>
        <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:text-foreground">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
        {inConversation ? (
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-2">
              <button
                onClick={tutor.clear}
                className="font-mono text-[10px] text-muted-foreground hover:text-foreground"
              >
                ← 历史
              </button>
            </div>
            <div className="border-l-2 border-primary pl-3">
              <p className="font-mono text-[10px] text-muted-foreground mb-1">TARGET_TEXT</p>
              <div className="text-sm leading-relaxed text-foreground italic line-clamp-4">&quot;{targetLabel}&quot;</div>
            </div>

            <div className="space-y-4">
              {active?.messages.map((message) => (
                <div key={message.id} className="flex flex-col gap-1">
                  <span className={`font-mono text-[10px] ${message.role === "user" ? "text-primary" : "text-muted-foreground"}`}>
                    {message.role === "user" ? "> USER" : "> TUTOR_AI"}
                  </span>
                  <div className={`prose prose-invert prose-sm max-w-none ${message.role === "user" ? "text-foreground" : "text-muted-foreground"}`}>
                    <MarkdownContent content={message.content} />
                  </div>
                </div>
              ))}
              {answering && (
                <button onClick={tutor.stop} className="font-mono text-[10px] text-primary animate-pulse hover:underline">
                  处理中... 点击停止
                </button>
              )}
              {!answering && active && active.messages.some((m) => m.role === "assistant") && (
                <button onClick={() => void tutor.regenerateLast()} className="font-mono text-[10px] text-muted-foreground hover:text-primary">
                  ↻ 重答
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <button
              onClick={tutor.startGeneral}
              className="w-full border border-primary/40 bg-primary/5 px-3 py-2 font-mono text-[11px] text-primary transition-colors hover:bg-primary/10"
            >
              + 针对整章提问（泛问）
            </button>
            <div className="font-mono text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              本章讨论档案 · {annotations.length}
            </div>
            {annotations.length === 0 ? (
              <div className="flex flex-col items-center justify-center pt-12 text-center text-muted-foreground">
                <MessageSquareQuote size={28} className="mb-3 opacity-50" />
                <p className="font-mono text-xs leading-relaxed max-w-[200px]">选中正文 → 选「问导师」，或点上方泛问本章</p>
              </div>
            ) : (
              <div className="space-y-1">
                {annotations.map((annotation) => (
                  <div key={annotation.id} className="group flex items-start gap-1">
                    <button
                      onClick={() => tutor.openThread(annotation)}
                      className="flex-1 px-2 py-2 text-left text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
                    >
                      <div className="text-xs line-clamp-1 font-medium">{annotation.question || annotation.title || "（无标题）"}</div>
                      <div className="mt-0.5 text-[10px] line-clamp-1 text-muted-foreground/70">
                        {annotation.selectedText ?? annotation.summary ?? "整章泛问"}
                      </div>
                      <div className="mt-0.5 font-mono text-[9px] text-muted-foreground/50">{formatTime(annotation.createdAt)}</div>
                    </button>
                    <button
                      onClick={() => void tutor.deleteThread(annotation.id)}
                      className="mt-2 rounded p-1 text-muted-foreground/40 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                      title="删除对话"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {inConversation && (
        <div className="border-t border-border bg-card p-4">
          <div className="mb-3 flex flex-wrap gap-2">
            {quickQuestions.map((q) => (
              <button
                key={q}
                onClick={() => void tutor.ask(q)}
                disabled={answering}
                className="rounded border border-border bg-background px-2 py-1 font-mono text-[10px] text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
          <form onSubmit={submitQuestion} className="relative flex items-center">
            <span className="absolute left-3 font-mono text-[12px] text-primary">{">"}</span>
            <input
              name="question"
              placeholder="输入问题..."
              autoComplete="off"
              disabled={answering}
              className="w-full bg-background border border-border py-2 pl-7 pr-3 font-mono text-[12px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-50"
            />
          </form>
        </div>
      )}
    </aside>
  );
}

function formatTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
