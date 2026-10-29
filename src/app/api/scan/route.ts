import { NextResponse } from "next/server";

import { CodedError } from "@/lib/coded-error";
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
    if (error instanceof CodedError) {
      return NextResponse.json(
        { error: error.message, detail: error.detail },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "scan_failed" }, { status: 400 });
  }
}
