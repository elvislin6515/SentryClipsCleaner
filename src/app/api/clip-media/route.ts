import { mediaErrorMessage, openClipVideo } from "@/lib/clip-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const root = url.searchParams.get("root") ?? "";
  const name = url.searchParams.get("name") ?? "";
  const file = url.searchParams.get("file") ?? "";
  try {
    return await openClipVideo(root, name, file, request.headers.get("range"));
  } catch (error) {
    return Response.json(mediaErrorMessage(error), { status: 404 });
  }
}
