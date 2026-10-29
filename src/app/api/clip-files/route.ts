import { listClipVideoSegments, mediaErrorMessage } from "@/lib/clip-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const root = url.searchParams.get("root") ?? "";
  const name = url.searchParams.get("name") ?? "";
  try {
    const listed = await listClipVideoSegments(root, name);
    return Response.json(listed);
  } catch (error) {
    return Response.json({ error: mediaErrorMessage(error) }, { status: 404 });
  }
}
