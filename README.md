# LearnByAI

LearnByAI is an MVP for generating personalized, coherent learning materials.

The current product flow is:

1. The learner enters a topic, goal, background, preferred teaching style, and weekly study time.
2. The system generates a Course Bible and a course outline.
3. The first chapter is generated automatically.
4. The learner reads the chapter in a stable reader.
5. The learner can select text or double-click a paragraph and ask AI questions in the right sidebar.

The project is intentionally small and local-first right now. Course data and annotations are stored in browser `localStorage`.

## Quick Start

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

For a stable test run after building:

```bash
npm run build
npm run start
```

## Environment

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Set:

```env
AI_API_KEY=your_api_key
AI_API_BASE_URL=https://api.yzccc.cloud/v1
```

The model is locked in code to:

```text
kimi-k2.6-full
```

Never commit `.env.local`.

## More Docs

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the development guide, architecture, API routes, data flow, and collaboration workflow.
