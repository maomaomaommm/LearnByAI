export function isMockMode() {
  return !process.env.NEXT_PUBLIC_ENABLE_TUTOR_AGENT;
}

export async function callAgent(
  _agent: string,
  _systemPrompt: string,
  userPrompt: string,
) {
  try {
    const response = await fetch("/api/annotations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: "LearnByAI",
        selectedText: "",
        question: userPrompt,
        history: [],
      }),
    });

    if (!response.ok) throw new Error(await response.text());
    const data = (await response.json()) as { answer?: string };
    return { content: data.answer ?? "", error: "" };
  } catch (error) {
    return {
      content: "",
      error: error instanceof Error ? error.message : "Unknown tutor agent error",
    };
  }
}
