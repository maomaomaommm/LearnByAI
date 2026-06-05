export type ChatMessage = {
  id: string;
  courseId: number | string;
  chapterId: number | string | null;
  role: "user" | "assistant";
  content: string;
  contextText: string | null;
  createdAt: string;
};

const MESSAGE_KEY = "learnbyai:tutor-sidebar-messages";

function readMessages() {
  if (typeof window === "undefined") return [];
  return JSON.parse(localStorage.getItem(MESSAGE_KEY) ?? "[]") as ChatMessage[];
}

function writeMessages(messages: ChatMessage[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(MESSAGE_KEY, JSON.stringify(messages));
}

function sameContext(
  message: ChatMessage,
  courseId: number | string,
  chapterId?: number | string,
) {
  return (
    String(message.courseId) === String(courseId) &&
    String(message.chapterId ?? "") === String(chapterId ?? "")
  );
}

export const messageDB = {
  getHistory(courseId: number | string, chapterId?: number | string) {
    return readMessages().filter((message) => sameContext(message, courseId, chapterId));
  },

  create(message: Omit<ChatMessage, "id" | "createdAt">) {
    const next: ChatMessage = {
      ...message,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    writeMessages([...readMessages(), next]);
    return next;
  },

  clearHistory(courseId: number | string, chapterId?: number | string) {
    writeMessages(readMessages().filter((message) => !sameContext(message, courseId, chapterId)));
  },
};
