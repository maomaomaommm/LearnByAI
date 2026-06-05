export type Chapter = {
  id: string;
  title: string;
  description: string;
  minutes?: number;
  purpose?: string;
  connectionFromPrevious?: string;
  setupForNext?: string;
  time: StudyTime;
  status?: "pending" | "generating" | "ready" | "failed";
  content?: string;
  review?: string;
};

export type StudyTime = {
  readingMinutes: number;
  exerciseMinutes: number;
  practiceMinutes: number;
  extensionMinutes: number;
};

export type CourseBible = {
  targetLearner: string;
  finalOutcomes: string[];
  teachingStyle: string;
  prerequisites: string[];
  globalNarrative: string;
  terminology: {
    term: string;
    definition: string;
    introducedIn: string;
  }[];
  chapterDependencies: {
    chapterTitle: string;
    dependsOn: string[];
    introduces: string[];
    preparesFor: string[];
  }[];
};

export type Course = {
  id: string;
  topic: string;
  goal: string;
  background: string;
  preference: string;
  weeklyHours: number;
  profile: string;
  courseBible: CourseBible;
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
