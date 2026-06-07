import { NextResponse } from "next/server";
import { AuthRequiredError } from "./authCore";
import { resolveUserId } from "./supabase/server";

export async function requireApiUser(request: Request) {
  try {
    return { userId: await resolveUserId(request) };
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return {
        response: NextResponse.json({ error: "Authentication required" }, { status: 401 }),
      };
    }
    throw error;
  }
}
