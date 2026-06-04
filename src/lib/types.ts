export type Chapter = {
  id: string;
  title: string;
  description: string;
  minutes: number;
  content?: string;
};

export type Course = {
  id: string;
  topic: string;
  goal: string;
  background: string;
  preference: string;
  weeklyHours: number;
  profile: string;
  chapters: Chapter[];
  createdAt: string;
};

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export type Annotation = {
  id: string;
  chapterId: string;
  selectedText: string;
  question: string;
  messages: Message[];
  createdAt: string;
};
