import { useState } from "react";
import { messageDB, type ChatMessage } from "@/lib/client-db";
import { callAgent, isMockMode } from "@/lib/llm-client";
import { Send, Trash2, PanelRightClose, Bot, User, Quote } from "lucide-react";

interface TutorSidebarProps {
  courseId: number;
  chapterId?: number;
  selectedText?: string;
  onClearSelection?: () => void;
  onToggleCollapse?: () => void;
}

const MOCK_RESPONSE = `这是一个很好的问题！让我来详细解释一下。

从**直觉层面**理解，你可以把这个概念想象成搭积木——从基础块开始，逐步构建更复杂的结构。

**正式定义**上：

$$\\theta^* = \\arg\\min_\\theta \\frac{1}{m} \\sum_{i=1}^{m} L(f_\\theta(x^{(i)}), y^{(i)})$$

其中 $L$ 是损失函数。

希望这能帮助你理解！`;

const TUTOR_PROMPT = `你是一位专业的 AI 导师。你的任务是帮助学生理解学习内容。

## 教学原则
1. 先给出直觉理解，再给出正式解释
2. 使用类比和生活化的例子
3. 鼓励学生思考，而不是直接给答案
4. 适时使用 LaTeX 公式说明数学概念
5. 如果涉及代码，给出清晰的代码示例

用中文回答，使用 Markdown 格式。`;

export function TutorSidebar({
  courseId,
  chapterId,
  selectedText,
  onClearSelection,
  onToggleCollapse,
}: TutorSidebarProps) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    messageDB.getHistory(courseId, chapterId)
  );

  const refreshMessages = () => {
    setMessages(messageDB.getHistory(courseId, chapterId));
  };

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMsg = input.trim();
    setInput("");

    // Save user message
    messageDB.create({
      courseId,
      chapterId: chapterId || null,
      role: "user",
      content: userMsg,
      contextText: selectedText || null,
    });
    refreshMessages();
    onClearSelection?.();

    // Get AI response
    let response = "";
    if (isMockMode()) {
      response = MOCK_RESPONSE;
    } else {
      const userPrompt = selectedText
        ? `学生问题：${userMsg}\n\n引用教材内容：${selectedText}\n\n请基于教材内容回答。`
        : userMsg;

      const result = await callAgent("TUTOR", TUTOR_PROMPT, userPrompt);
      response = result.error ? MOCK_RESPONSE : result.content;
    }

    // Save AI message
    messageDB.create({
      courseId,
      chapterId: chapterId || null,
      role: "assistant",
      content: response,
      contextText: null,
    });
    refreshMessages();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClear = () => {
    messageDB.clearHistory(courseId, chapterId);
    refreshMessages();
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Bot size={18} className="text-primary" />
          <span className="text-sm font-semibold">AI 导师</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={handleClear} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="清空会话">
            <Trash2 size={14} />
          </button>
          <button onClick={onToggleCollapse} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="收起">
            <PanelRightClose size={14} />
          </button>
        </div>
      </div>

      {/* Selected text context */}
      {selectedText && (
        <div className="mx-3 mt-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div className="mb-1 flex items-center gap-1 text-xs text-primary">
            <Quote size={12} /><span>选中内容</span>
          </div>
          <p className="line-clamp-3 text-xs text-muted-foreground">{selectedText}</p>
          <button onClick={onClearSelection} className="mt-1 text-xs text-primary hover:underline">清除引用</button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Bot size={32} className="mb-3 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">选中教材内容或输入问题<br />向AI导师提问</p>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
            <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
              msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}>
              {msg.role === "user" ? <User size={14} /> : <Bot size={14} />}
            </div>
            <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
              msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}>
              {msg.contextText && msg.role === "user" && (
                <div className="mb-2 rounded border border-primary/20 bg-primary/10 px-2 py-1 text-xs opacity-80">
                  引用: {msg.contextText.slice(0, 80)}...
                </div>
              )}
              <div className="whitespace-pre-wrap">{msg.content}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="border-t border-border p-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入问题..."
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
