import type { ModelOverrides } from "./modelOverrides";

export type EntityStatus = "pending" | "queued" | "generating" | "draft_ready" | "quality_failed" | "ready" | "failed";

export type JobStatus = "pending" | "queued" | "running" | "retrying" | "succeeded" | "failed";

export type AgentName = "ASSISTANT" | "ARCHITECT" | "AUTHOR" | "POLISHER" | "REVIEWER" | "TUTOR" | "REVISER";

export type QualityStatus = "passed" | "warning" | "failed";

export type CourseDifficulty = "intro" | "intermediate" | "research";

export type ChapterDepthWeight = "core" | "normal" | "light";

export type GenerationProfile = "fast" | "deep";

export type ExplanationStyle = "intuition" | "example" | "rigor" | "analogy" | "code";

export type LearningMode = "standard" | "project" | "exercise" | "case";

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
  depthWeight?: ChapterDepthWeight;
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
  preference?: string;
  styles: ExplanationStyle[];
  learningMode: LearningMode;
  chapterCount: number;
  difficulty: CourseDifficulty;
  generationProfile?: GenerationProfile;
  includeRecentResearch?: boolean;
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
  /** Admin marked this failed report as handled; drops it from the attention badge/list. */
  acknowledgedAt?: string;
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
  /** Set when an admin cancels the job — distinguishes an intentional cancel from a real failure. */
  cancelledByAdmin?: boolean;
  /** Admin marked this failed job as handled; drops it from the attention badge/list. */
  acknowledgedAt?: string;
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
  action: "create_course" | "generate_chapter" | "ask_tutor" | "export" | "revise";
  createdAt: string;
};

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export type AnnotationScope = "anchored" | "chapter";

export type Annotation = {
  id: string;
  userId?: string;
  courseId?: string;
  chapterId: string;
  sectionId?: string;
  /** Absent is treated as "anchored" for backward compatibility. */
  scope?: AnnotationScope;
  /** Optional for chapter-level (泛问) threads that are not anchored to a span. */
  selectedText?: string;
  /** Short label for the history list when there is no anchored selectedText. */
  title?: string;
  /** Optional one-line summary for the history list. */
  summary?: string;
  question: string;
  messages: Message[];
  createdAt: string;
};

export type RevisionMode = "fix" | "rewrite";

export type RevisionScope = "selection" | "paragraph" | "section" | "chapter";

export type RevisionStatus = "proposed" | "applied" | "reverted" | "failed";

/**
 * A single local-revision or whole-chapter-regen record, used to power the
 * Revise panel's history + undo. Two recovery semantics live here, keyed by
 * `scope` (see docs/tutor-revise-decoupling-plan.md §4 C1):
 *  - local scopes (selection/paragraph/section): `beforeText`/`afterText`,
 *    reverted by a targeted exact-once text swap that touches only that span.
 *    Applied revisions may also carry chapter snapshots so undo can recover if
 *    the exact span was normalized or overwritten after application.
 *  - chapter scope (regen rollback): `beforeChapter` snapshot, reverted by
 *    restoring the whole chapter verbatim.
 */
export type Revision = {
  id: string;
  userId?: string;
  courseId: string;
  chapterId: string;
  sectionId?: string;
  mode: RevisionMode;
  scope: RevisionScope;
  intent: string;
  status: RevisionStatus;
  // local scopes
  beforeText?: string;
  afterText?: string;
  // whole-chapter scope (regen rollback)
  beforeChapter?: Chapter;
  afterChapter?: Chapter;
  // optional diagnostics carried from the proposal for the UI
  diagnosis?: string;
  confidence?: "low" | "medium" | "high";
  createdAt: string;
  appliedAt?: string;
  revertedAt?: string;
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
