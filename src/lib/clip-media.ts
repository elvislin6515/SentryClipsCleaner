import { createReadStream } from "node:fs";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { Readable } from "node:stream";

import { CodedError } from "@/lib/coded-error";
import { parseClipFolderName } from "@/lib/clips";
import {
  groupClipVideos,
  parseClipEvent,
  parseClipVideoName,
  type ClipEventMeta,
  type ClipVideoSegment,
} from "@/lib/clip-videos";

export async function listClipVideoSegments(
  root: string,
  clipName: string,
): Promise<{
  segments: ClipVideoSegment[];
  eventAt: string | null;
  event: ClipEventMeta | null;
}> {
  const folder = await resolveClipFolder(root, clipName);
  const entries = await readdir(folder, { withFileTypes: true });
  const files: Array<{ name: string; size?: number }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !parseClipVideoName(entry.name)) continue;
    try {
      const info = await stat(join(folder, entry.name));
      files.push({ name: entry.name, size: info.size });
    } catch {
      files.push({ name: entry.name });
    }
  }
  const event = await readClipEventFile(folder);
  return {
    segments: groupClipVideos(files),
    eventAt: event?.timestamp ?? null,
    event,
  };
}

async function readClipEventFile(folder: string): Promise<ClipEventMeta | null> {
  try {
    const raw = await readFile(join(folder, "event.json"), "utf8");
    return parseClipEvent(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function openClipThumb(
  root: string,
  clipName: string,
): Promise<Response> {
  const folder = await resolveClipFolder(root, clipName);
  const filePath = join(folder, "thumb.png");
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) {
    return jsonError("no_thumb", 404);
  }
  const bytes = await readFile(filePath);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, max-age=86400",
    },
  });
}

export async function openClipVideo(
  root: string,
  clipName: string,
  fileName: string,
  rangeHeader: string | null,
): Promise<Response> {
  if (!parseClipVideoName(fileName)) {
    return jsonError("mp4_only", 400);
  }
  const folder = await resolveClipFolder(root, clipName);
  const filePath = resolve(folder, fileName);
  const rel = relative(folder, filePath);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return jsonError("path_denied", 400);
  }

  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) {
    return jsonError("video_missing", 404);
  }
  const realFile = await realpath(filePath);
  const realFolder = await realpath(folder);
  const realRel = relative(realFolder, realFile);
  if (realRel.startsWith("..") || isAbsolute(realRel)) {
    return jsonError("path_denied", 400);
  }

  const size = info.size;
  const range = rangeHeader ? parseByteRange(rangeHeader, size) : null;
  if (rangeHeader && !range) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${size}` },
    });
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? size - 1;
  const stream = Readable.toWeb(
    createReadStream(realFile, { start, end }),
  ) as ReadableStream;
  const headers = new Headers({
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Content-Length": String(end - start + 1),
    "Cache-Control": "private, no-store",
  });
  if (range) {
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  }
  return new Response(stream, { status: range ? 206 : 200, headers });
}

async function resolveClipFolder(root: string, clipName: string): Promise<string> {
  if (!root.trim() || !isAbsolute(root)) {
    throw new MediaError("root_required");
  }
  if (
    !parseClipFolderName(clipName) ||
    clipName !== clipName.trim() ||
    /[\\/]/.test(clipName)
  ) {
    throw new MediaError("bad_clip_name");
  }
  const folder = resolve(root, clipName);
  const rel = relative(resolve(root), folder);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new MediaError("path_denied");
  }
  const info = await stat(folder).catch(() => null);
  if (!info?.isDirectory()) {
    throw new MediaError("folder_missing", clipName);
  }
  return folder;
}

function parseByteRange(
  header: string,
  size: number,
): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || size <= 0) return null;
  if (!match[1] && match[2]) {
    const suffix = Number(match[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    return { start: Math.max(size - suffix, 0), end: size - 1 };
  }
  if (!match[1]) return null;
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || start >= size || end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}

class MediaError extends CodedError {}

function jsonError(code: string, status: number, detail = ""): Response {
  return Response.json({ error: code, detail }, { status });
}

export function mediaErrorMessage(error: unknown): {
  error: string;
  detail: string;
} {
  if (error instanceof CodedError) {
    return { error: error.message, detail: error.detail };
  }
  return { error: "read_video_failed", detail: "" };
}
