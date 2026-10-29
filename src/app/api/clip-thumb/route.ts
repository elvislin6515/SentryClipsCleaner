import { mediaErrorMessage, openClipThumb } from "@/lib/clip-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const root = url.searchParams.get("root") ?? "";
  const name = url.searchParams.get("name") ?? "";
  try {
    return await openClipThumb(root, name);
  } catch (error) {
    return Response.json(mediaErrorMessage(error), { status: 404 });
  }
}
