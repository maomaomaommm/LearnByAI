# LearnByAI Development Guide

This document is for collaborators who want to run, understand, and extend the project.

## 1. Product Summary

LearnByAI is a personalized textbook generator.

The core idea is not just to generate a course outline. The system should create a coherent learning path, generate rich textbook-style chapters, and let users ask questions anchored to the exact place where confusion happens.

Current MVP capabilities:

- Generate a Course Bible.
- Generate a course outline with chapter dependencies.
- Automatically generate the first chapter.
- Generate later chapters on demand.
- Render Markdown and LaTeX with KaTeX.
- Support anchored AI discussion in the right sidebar.
- Store courses and annotations locally in the browser.

## 2. Tech Stack

- Framework: Next.js App Router
- Language: TypeScript
- UI: plain CSS in `src/app/globals.css`
- Markdown rendering: `react-markdown`
- Math rendering: `remark-math` + `rehype-katex`
- AI provider: OpenAI-compatible chat completions endpoint
- Current model: `gemini-3.1-pro-preview`
- Storage: browser `localStorage`

## 3. Setup

Install dependencies:

```bash
npm install
```

Create local environment file:

```bash
cp .env.example .env.local
```

Example `.env.local`:

```env
AI_API_KEY=your_api_key
AI_API_BASE_URL=https://api.yzccc.cloud/v1
```

Run in development:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

Run a production-style local test:

```bash
npm run build
npm run start
```

Important: avoid running `npm run build` while `npm run dev` is still running. It can corrupt `.next` dev cache and cause missing chunk errors. If the UI starts showing strange Next.js runtime errors, stop the server, delete `.next`, rebuild, and restart.

## 4. Useful Commands

```bash
npm run lint
npm run build
npm run dev
npm run start
```

On this Windows workspace, if the system `node` is unavailable, use the bundled Node runtime already downloaded under:

```powershell
$nodeDir = Resolve-Path '.tools\node-v24.16.0-win-x64'
$env:Path = "$nodeDir;$env:Path"
& "$nodeDir\npm.cmd" run dev
```

## 5. Project Structure

```text
src/
  app/
    page.tsx
    courses/[id]/page.tsx
    courses/[id]/chapters/[chapterId]/page.tsx
    api/
      courses/route.ts
      chapters/route.ts
      annotations/route.ts
    globals.css
    layout.tsx
  components/
    MarkdownContent.tsx
  lib/
    ai.ts
    mock.ts
    storage.ts
    time.ts
    types.ts
```

Key files:

- `src/lib/ai.ts`: AI provider wrapper. The model is locked to `gemini-3.1-pro-preview`.
- `src/app/api/courses/route.ts`: creates Course Bible, outline, and first chapter.
- `src/app/api/chapters/route.ts`: generates later chapters on demand.
- `src/app/api/annotations/route.ts`: answers anchored questions.
- `src/components/MarkdownContent.tsx`: shared Markdown/LaTeX renderer.
- `src/lib/storage.ts`: localStorage persistence and old-course migration.
- `src/lib/types.ts`: core data types.

## 6. Core Data Model

### Course

```ts
type Course = {
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
```

### CourseBible

The Course Bible is the global contract for a course. It prevents chapters from becoming disconnected essays.

```ts
type CourseBible = {
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
```

### Chapter

```ts
type Chapter = {
  id: string;
  title: string;
  description: string;
  purpose?: string;
  connectionFromPrevious?: string;
  setupForNext?: string;
  time: StudyTime;
  status?: "pending" | "generating" | "ready" | "failed";
  content?: string;
  review?: string;
};
```

### StudyTime

```ts
type StudyTime = {
  readingMinutes: number;
  exerciseMinutes: number;
  practiceMinutes: number;
  extensionMinutes: number;
};
```

## 7. Current User Flow

### Course Creation

File: `src/app/page.tsx`

1. User fills out the course form.
2. UI shows an estimated progress bar.
3. `POST /api/courses` is called.
4. The API generates Course Bible and outline.
5. The API generates the first chapter immediately.
6. The frontend saves the course to `localStorage`.
7. User is redirected to `/courses/[id]`.

Note: this is currently a single long request. It can take several minutes. The progress bar is estimated, not server-driven.

### Course Page

File: `src/app/courses/[id]/page.tsx`

Shows:

- Learning strategy.
- Course Bible.
- Final outcomes.
- Prerequisites.
- Chapter list.
- Chapter status.
- Estimated study time.
- Chapter-to-chapter connection.

### Reader Page

File: `src/app/courses/[id]/chapters/[chapterId]/page.tsx`

Shows:

- Left course navigation.
- Center textbook reader.
- Right anchored discussion sidebar.

If a chapter has no content, opening it triggers `POST /api/chapters`.

## 8. AI Generation Rules

The important prompts live in:

- `src/lib/prompts/textbookSkill.ts`
- `src/lib/prompts/forbiddenPhrases.ts`
- `src/lib/prompts/coursePlanner.ts`
- `src/lib/prompts/chapterWriter.ts`
- `src/lib/prompts/chapterReviewer.ts`
- `src/lib/prompts/annotationTutor.ts`

API routes should call prompt builders instead of embedding long prompts inline:

```ts
const prompt = buildCoursePlannerPrompt(input);
const prompt = buildChapterWriterPrompt(course, chapter);
const prompt = buildAnnotationTutorPrompt(input);
```

Current generation constraints:

- Use Markdown.
- Use LaTeX for math.
- Complex formulas must use block math.
- Block math must be separated by blank lines.
- Avoid putting Chinese text, headings, or list items on the same line as `$$`.
- Generate textbook-style chapters, not blog posts.
- Each chapter must connect to previous and next chapters.
- Each chapter should include intuition, definitions, formulas, examples, common mistakes, exercises, and a project task.

### Textbook Skill

`textbookSkill.ts` is the central product skill. It defines:

- textbook writing principles,
- language style rules,
- forbidden AI-flavored phrases,
- chapter structure,
- chapter continuity requirements,
- Markdown and LaTeX formatting rules,
- content depth standards,
- reviewer rubric.

When changing how textbooks should sound or be structured, start there.

### Style Guide

The product should avoid marketing, motivational, and exaggerated language. The target voice is a careful graduate-level instructor: specific, calm, and direct.

Forbidden phrases are listed in:

```text
src/lib/prompts/forbiddenPhrases.ts
```

Examples of discouraged style:

- "revolutionary"
- "unlock"
- "change the world"
- "are you ready"
- "I will accompany you"
- "ultimate guide"

The model should explain why something matters instead of simply calling it important.

## 9. Markdown and Math Rendering

File: `src/components/MarkdownContent.tsx`

This component renders both textbook content and sidebar answers.

It includes lightweight normalization:

- Converts `\[` and `\]` to `$$`.
- Converts `\(` and `\)` to `$`.
- Adds line breaks around block math.
- Uses KaTeX with `throwOnError: false`.

This prevents one bad formula from corrupting a whole paragraph.

## 10. Known Limitations

These are real product issues, not bugs:

- Course creation is slow because the first chapter is generated inside the same request.
- There is no backend database yet.
- All data is stored in browser localStorage.
- No login or user accounts.
- No true background job queue.
- Progress bar is estimated.
- Existing generated content may still contain formatting issues.
- No formal reviewer agent yet.
- No PDF or TeX export yet.
- No rate limits or user quotas.

## 11. Recommended Next Milestones

### Milestone A: Background Generation

Goal: do not block the course creation page for several minutes.

Suggested approach:

- `POST /api/courses` generates Course Bible and outline only.
- Create a generation job for chapter 1.
- Course page shows job status.
- Reader page streams or polls status.

### Milestone B: Better Content Structure

Goal: move from one Markdown blob per chapter to structured sections.

Potential model:

```ts
type Section = {
  id: string;
  chapterId: string;
  title: string;
  purpose: string;
  content: string;
  status: "pending" | "generating" | "ready" | "failed";
};
```

### Milestone C: Database

Recommended:

- Supabase Auth
- Supabase Postgres
- Tables: users, courses, chapters, sections, annotations, annotation_messages, generation_jobs

### Milestone D: Reviewer Agents

Add separate review stages:

- Continuity reviewer
- Fact and formula reviewer
- Markdown/LaTeX renderer reviewer
- Exercise quality reviewer

## 12. Git Workflow

The repository is:

```text
https://github.com/maomaomaommm/LearnByAI
```

Recommended collaboration flow:

```bash
git pull
git checkout -b feature/short-name
```

After changes:

```bash
npm run lint
npm run build
git add .
git commit -m "Describe the change"
git push -u origin feature/short-name
```

Then open a pull request.

For very small solo changes, committing directly to `main` is acceptable during the MVP phase, but using feature branches will become safer once both developers are active.

## 13. Security Notes

Never commit:

- `.env.local`
- API keys
- local logs
- `.tools`
- `.next`
- `node_modules`

The `.gitignore` already excludes these.

The API key was once shared in chat during development, so it should be rotated before any public or semi-public launch.

## 14. Testing Checklist

Before pushing:

```bash
npm run lint
npm run build
```

Manual checks:

- Home page loads.
- Clicking "generate" shows progress.
- Course page shows Course Bible.
- First chapter is ready after generation.
- Opening a pending chapter triggers generation.
- Reader renders Markdown and formulas.
- Sidebar answers render Markdown, formulas, and code.
- Refreshing does not lose course data.

## 15. Current Design Principle

Do not optimize for generating the biggest possible textbook.

Optimize for:

- coherent course structure,
- trustworthy explanations,
- anchored learning discussion,
- user-adjustable content,
- and eventually background generation.

The product should feel like a textbook that understands where the learner is, not just a chatbot that writes long articles.
