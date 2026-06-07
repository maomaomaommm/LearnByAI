"use client";

import { useState } from "react";
import { Bot, PanelRightClose, Quote, Send, Trash2, User } from "lucide-react";
import { apiFetch } from "@/lib/clientApi";
import { publicSafeErrorMessage } from "@/lib/publicSafeError";
import { MarkdownContent } from "./MarkdownContent";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

interface TutorSidebarProps {
  courseId: string;
  chapterId?: string;
  topic?: string;
  selectedText?: string;
  onClearSelection?: () => void;
  onToggleCollapse?: () => void;
}

export function TutorSidebar({
  topic = "当前课程",
  selectedText,
  onClearSelection,
  onToggleCollapse,
}: TutorSidebarProps) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  async function handleSend() {
    if (!input.trim()) return;

    const question = input.trim();
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: question,
    };

    setInput("");
    setMessages((current) => [...current, userMessage]);
    setLoading(true);

    try {
      const response = await apiFetch("/api/annotations", {
        method: "POST",
        body: JSON.stringify({
          topic,
          selectedText: selectedText || topic,
          question,
          history: messages,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Tutor request failed.");
      }
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.answer ?? "暂时无法回答，请稍后重试。",
        },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: publicSafeErrorMessage(error, "Tutor request failed."),
        },
      ]);
    } finally {
      setLoading(false);
      onClearSelection?.();
    }
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Bot size={18} className="text-primary" />
          <span className="text-sm font-semibold">AI 导师</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMessages([])}
            className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="清空会话"
          >
            <Trash2 size={14} />
          </button>
          <button
            onClick={onToggleCollapse}
            className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="收起"
          >
            <PanelRightClose size={14} />
          </button>
        </div>
      </div>

      {selectedText && (
        <div className="mx-3 mt-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div className="mb-1 flex items-center gap-1 text-xs text-primary">
            <Quote size={12} />
            <span>选中内容</span>
          </div>
          <p className="line-clamp-3 text-xs text-muted-foreground">{selectedText}</p>
          <button onClick={onClearSelection} className="mt-1 text-xs text-primary hover:underline">
            清除引用
          </button>
        </div>
      )}

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Bot size={32} className="mb-3 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              选中教材内容或输入问题
              <br />
              向 AI 导师提问
            </p>
          </div>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex gap-2 ${message.role === "user" ? "flex-row-reverse" : "flex-row"}`}
          >
            <div
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                message.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              {message.role === "user" ? <User size={14} /> : <Bot size={14} />}
            </div>
            <div className="max-w-[80%] rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
              <MarkdownContent content={message.content} />
            </div>
          </div>
        ))}
        {loading && <p className="text-xs text-muted-foreground">导师正在回答...</p>}
      </div>

      <div className="border-t border-border p-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入问题..."
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
