import type { ModelOverrides } from "./modelOverrides";

export type EntityStatus = "pending" | "queued" | "generating" | "draft_ready" | "quality_failed" | "ready" | "failed";

export type JobStatus = "pending" | "queued" | "running" | "retrying" | "succeeded" | "failed";

export type AgentName = "ASSISTANT" | "ARCHITECT" | "AUTHOR" | "POLISHER" | "REVIEWER" | "TUTOR";

export type QualityStatus = "passed" | "warning" | "failed";

export type ChapterLength = "short" | "medium" | "long";

export type GenerationProfile = "fast" | "standard" | "deep";

export type Chapter = {
  id: string;
  title: string;
  description: string;
  minutes?: number;
  purpose?: string;
  connectionFromPrevious?: string;
  setupForNext?: string;
  contract?: ChapterContract;
  time: StudyTime;
  status?: EntityStatus;
  content?: string;
  review?: string;
  sections?: Section[];
  qualityReport?: QualityReport;
  generationJobId?: string;
};

export type Section = {
  id: string;
  chapterId: string;
  title: string;
  purpose: string;
  content: string;
  status: EntityStatus;
  order: number;
  qualityReport?: QualityReport;
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
  chapterContracts?: ChapterContract[];
};

export type ChapterContract = {
  chapterTitle: string;
  requiredTopics: string[];
  bridgeFromPrevious: string;
  bridgeToNext: string;
  forbiddenEarlyTopics: string[];
  requiredExamples: string[];
  requiredFormulas: string[];
  summaryForNext?: string;
};

export type Course = {
  id: string;
  userId?: string;
  topic: string;
  goal: string;
  background: string;
  preference: string;
  weeklyHours: number;
  chapterLength?: ChapterLength;
  generationProfile?: GenerationProfile;
  profile: string;
  courseBible: CourseBible;
  chapters: Chapter[];
  createdAt: string;
  updatedAt?: string;
  generationJobId?: string;
};

export type QualityIssue = {
  check: string;
  severity: "info" | "warning" | "error";
  message: string;
  suggestion?: string;
  source?: "TQH" | "REVIEWER";
};

export type QualityReport = {
  id: string;
  targetType: "course" | "chapter" | "section" | "answer";
  targetId: string;
  score: number;
  status: QualityStatus;
  issues: QualityIssue[];
  createdAt: string;
};

export type AgentEvent = {
  id: string;
  agent: AgentName;
  status: JobStatus;
  message: string;
  createdAt: string;
};

export type GenerationJob = {
  id: string;
  userId?: string;
  courseId?: string;
  chapterId?: string;
  type: "course" | "chapter" | "annotation" | "export";
  mode?: "generate" | "review_draft";
  status: JobStatus;
  activeAgent?: AgentName;
  events: AgentEvent[];
  error?: string;
  resultId?: string;
  lockedBy?: string;
  lockedUntil?: string;
  attempts?: number;
  modelOverrides?: ModelOverrides;
  createdAt: string;
  updatedAt: string;
};

export type ExportJob = {
  id: string;
  userId?: string;
  courseId: string;
  format: "pdf" | "tex";
  status: JobStatus;
  fileName?: string;
  storagePath?: string;
  storageProvider?: "local" | "supabase";
  content?: string;
  contentType?: string;
  encoding?: "utf8" | "base64";
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type UsageEvent = {
  id: string;
  userId?: string;
  action: "create_course" | "generate_chapter" | "ask_tutor" | "export";
  createdAt: string;
};

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export type Annotation = {
  id: string;
  userId?: string;
  courseId?: string;
  chapterId: string;
  sectionId?: string;
  selectedText: string;
  question: string;
  messages: Message[];
  createdAt: string;
};

export type CourseCreateResponse = {
  course: Course;
  job?: GenerationJob;
};

export type ChapterGenerateResponse = {
  content: string;
  sections: Section[];
  review: string;
  qualityReport: QualityReport;
  job?: GenerationJob;
};
