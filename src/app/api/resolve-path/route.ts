import { NextResponse } from "next/server";

import { resolveClipRoot, resolveSelectedFolderPath } from "@/lib/local-scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    folderName?: unknown;
    sampleNames?: unknown;
    hintPath?: unknown;
  } | null;

  const folderName = typeof body?.folderName === "string" ? body.folderName : "";
  const hintPath = typeof body?.hintPath === "string" ? body.hintPath : "";
  const sampleNames = Array.isArray(body?.sampleNames)
    ? body.sampleNames.filter((name): name is string => typeof name === "string")
    : [];

  const path = resolveSelectedFolderPath({
    folderName,
    sampleNames,
    hintPath,
  });
  const clipRoot = resolveClipRoot(path, sampleNames);

  return NextResponse.json({ path, clipRoot });
}
