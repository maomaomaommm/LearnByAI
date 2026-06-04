# LearnByAI

一份会根据学习者目标与基础生成，并允许在原文位置展开独立讨论的个人教材 MVP。

## 本地运行

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`。

未配置模型密钥时，应用使用内置示例内容，完整交互仍可运行。复制 `.env.example` 为
`.env.local` 并填写 `AI_API_KEY` 后，课程、教材和原文问答会切换为 Gemini 生成。

应用在代码层锁定使用 `gemini-3.1-pro-preview`，不会自动回退到其他模型。

## 当前范围

- 根据目标、基础与偏好生成课程目录
- 按章节生成并审核 Markdown + LaTeX 教材
- 三栏稳定阅读界面
- 选中文字或双击段落，在右侧展开多轮讨论
- 本地保存课程、教材与原文讨论
