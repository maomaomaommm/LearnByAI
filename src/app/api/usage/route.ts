import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/apiAuth";
import { listServerUsageEvents } from "@/lib/serverStore";
import { UsageEvent } from "@/lib/types";

const usageActions = new Set<UsageEvent["action"]>([
  "create_course",
  "generate_chapter",
  "ask_tutor",
  "export",
  "revise",
]);

export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");
  if (action && !usageActions.has(action as UsageEvent["action"])) {
    return NextResponse.json({ error: "Invalid usage action" }, { status: 400 });
  }

  const events = await listServerUsageEvents(
    request,
    action ? (action as UsageEvent["action"]) : undefined,
  );

  return NextResponse.json({
    usage: events,
    totals: events.reduce<Record<string, number>>((accumulator, event) => {
      accumulator[event.action] = (accumulator[event.action] ?? 0) + 1;
      return accumulator;
    }, {}),
  });
}
