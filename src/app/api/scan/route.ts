import { NextResponse } from "next/server";

import { scanLocalClipPath } from "@/lib/local-scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { path?: unknown }
    | null;
  const path = typeof body?.path === "string" ? body.path : "";

  try {
    const result = await scanLocalClipPath(path);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "掃描失敗";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
