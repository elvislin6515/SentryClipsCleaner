import {
  parseClipFolderName,
  parseEventLocation,
  type Clip,
  type ClipKind,
  type ClipLocation,
} from "@/lib/clips";
import { parseClipEvent, type ClipEventMeta } from "@/lib/clip-videos";
import { CodedError } from "@/lib/coded-error";
import {
  loadLastDirectoryHandle,
  saveLastDirectoryHandle,
} from "@/lib/last-folder";

export type DirectoryHandleLike = {
  name: string;
  kind: "directory";
  entries(): AsyncIterableIterator<[string, HandleLike]>;
  getDirectoryHandle(name: string): Promise<DirectoryHandleLike>;
  getFileHandle?(name: string): Promise<FileHandleLike>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  queryPermission?(descriptor?: {
    mode?: "read" | "readwrite";
  }): Promise<PermissionState>;
  requestPermission?(descriptor?: {
    mode?: "read" | "readwrite";
  }): Promise<PermissionState>;
};

type FileHandleLike = {
  name: string;
  kind: "file";
  getFile(): Promise<File>;
};

type HandleLike = DirectoryHandleLike | FileHandleLike;

const BUCKETS = new Set<ClipKind>([
  "SentryClips",
  "RecentClips",
  "SavedClips",
]);

export type ScanProgress = {
  current: number;
  total: number;
};

export type LoadedLibrary = {
  clips: Clip[];
  label: string;
  canDelete: boolean;
  directory: DirectoryHandleLike | null;
  parents: Map<string, DirectoryHandleLike>;
};

function isDirectory(handle: HandleLike): handle is DirectoryHandleLike {
  return handle.kind === "directory";
}

export function canPickDirectory(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export async function pickClipDirectory(): Promise<DirectoryHandleLike> {
  const picker = (
    window as Window & {
      showDirectoryPicker?: (options?: {
        id?: string;
        mode?: "read" | "readwrite";
        startIn?: FileSystemHandle | "desktop" | "documents" | "downloads";
      }) => Promise<DirectoryHandleLike>;
    }
  ).showDirectoryPicker;
  if (!picker) {
    throw new CodedError("picker_unsupported");
  }

  const last = await loadLastDirectoryHandle();
  const options: {
    id: string;
    mode: "read";
    startIn?: FileSystemHandle;
  } = {
    id: "sentryclips-root",
    mode: "read",
  };
  if (last) options.startIn = last;

  let directory: DirectoryHandleLike;
  try {
    directory = await picker(options);
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === "AbortError";
    if (!last || aborted) throw error;
    directory = await picker({ id: "sentryclips-root", mode: "read" });
  }

  await saveLastDirectoryHandle(
    directory as unknown as FileSystemDirectoryHandle,
  ).catch(() => undefined);
  return directory;
}

export async function ensurePermission(
  directory: DirectoryHandleLike,
  mode: "read" | "readwrite",
): Promise<boolean> {
  const descriptor = { mode };
  if (directory.queryPermission) {
    const current = await directory.queryPermission(descriptor);
    if (current === "granted") return true;
  }
  if (directory.requestPermission) {
    return (await directory.requestPermission(descriptor)) === "granted";
  }
  return mode === "read";
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      () => {
        window.clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

async function measureHandle(
  directory: DirectoryHandleLike,
  slow: { skip: boolean },
): Promise<{ size: number; fileCount: number }> {
  if (slow.skip) return { size: 0, fileCount: 0 };

  let size = 0;
  let fileCount = 0;
  let timeouts = 0;
  try {
    for await (const [, entry] of directory.entries()) {
      if (slow.skip) break;
      if (entry.kind !== "file") continue;
      const file = await withTimeout(
        (entry as FileHandleLike).getFile(),
        400,
      );
      if (!file) {
        timeouts += 1;
        if (timeouts >= 3) {
          slow.skip = true;
          break;
        }
        continue;
      }
      size += file.size;
      fileCount += 1;
    }
  } catch {
    return { size, fileCount };
  }
  return { size, fileCount };
}

async function readLocationFromHandle(
  directory: DirectoryHandleLike,
): Promise<ClipLocation | undefined> {
  try {
    const handle = directory.getFileHandle
      ? await directory.getFileHandle("event.json").catch(() => null)
      : null;
    const file = handle
      ? await withTimeout(handle.getFile(), 800)
      : null;
    if (!file) return undefined;
    const text = await withTimeout(file.text(), 800);
    if (!text) return undefined;
    return parseEventLocation(JSON.parse(text));
  } catch {
    return undefined;
  }
}

async function readClipFolders(
  directory: DirectoryHandleLike,
  kind: ClipKind,
  parents: Map<string, DirectoryHandleLike>,
  onProgress?: (progress: ScanProgress) => void,
  slow: { skip: boolean } = { skip: false },
): Promise<Clip[]> {
  const folders: Array<[string, DirectoryHandleLike]> = [];
  for await (const [name, entry] of directory.entries()) {
    if (isDirectory(entry) && parseClipFolderName(name)) {
      folders.push([name, entry]);
    }
  }

  const clips: Clip[] = [];
  for (let i = 0; i < folders.length; i++) {
    const [name, handle] = folders[i];
    onProgress?.({ current: i + 1, total: folders.length });
    const timestamp = parseClipFolderName(name);
    if (!timestamp) continue;
    const [stats, location, hasThumb] = await Promise.all([
      measureHandle(handle, slow),
      readLocationFromHandle(handle),
      hasThumbHandle(handle),
    ]);
    parents.set(name, directory);
    clips.push({
      id: `${kind}:${name}`,
      name,
      timestamp,
      size: stats.size,
      fileCount: stats.fileCount,
      kind,
      location,
      hasThumb,
    });
  }
  return clips;
}

export async function loadLibraryFromDirectory(
  root: DirectoryHandleLike,
  onProgress?: (progress: ScanProgress) => void,
): Promise<LoadedLibrary> {
  const parents = new Map<string, DirectoryHandleLike>();
  const clips: Clip[] = [];
  const slow = { skip: false };

  if (BUCKETS.has(root.name as ClipKind)) {
    clips.push(
      ...(await readClipFolders(
        root,
        root.name as ClipKind,
        parents,
        onProgress,
        slow,
      )),
    );
  } else {
    const nestedBuckets: Array<[ClipKind, DirectoryHandleLike]> = [];
    const loose: Array<[string, DirectoryHandleLike]> = [];

    for await (const [name, entry] of root.entries()) {
      if (!isDirectory(entry)) continue;
      if (BUCKETS.has(name as ClipKind)) {
        nestedBuckets.push([name as ClipKind, entry]);
      } else if (parseClipFolderName(name)) {
        loose.push([name, entry]);
      }
    }

    if (nestedBuckets.length > 0) {
      for (const [kind, handle] of nestedBuckets) {
        clips.push(
          ...(await readClipFolders(handle, kind, parents, onProgress, slow)),
        );
      }
    } else {
      const total = loose.length;
      for (let i = 0; i < loose.length; i++) {
        const [name, handle] = loose[i];
        onProgress?.({ current: i + 1, total });
        const timestamp = parseClipFolderName(name);
        if (!timestamp) continue;
        const [stats, location, hasThumb] = await Promise.all([
          measureHandle(handle, slow),
          readLocationFromHandle(handle),
          hasThumbHandle(handle),
        ]);
        parents.set(name, root);
        clips.push({
          id: `unknown:${name}`,
          name,
          timestamp,
          size: stats.size,
          fileCount: stats.fileCount,
          kind: "unknown",
          location,
          hasThumb,
        });
      }
    }
  }

  if (clips.length === 0) {
    const timestamp = parseClipFolderName(root.name);
    if (timestamp) {
      const [stats, location, hasThumb] = await Promise.all([
        measureHandle(root, slow),
        readLocationFromHandle(root),
        hasThumbHandle(root),
      ]);
      clips.push({
        id: `unknown:${root.name}`,
        name: root.name,
        timestamp,
        size: stats.size,
        fileCount: stats.fileCount,
        kind: "unknown",
        location,
        hasThumb,
      });
    }
  }

  return {
    clips,
    label: root.name,
    canDelete: true,
    directory: root,
    parents,
  };
}

export function loadLibraryFromFileList(files: File[]): LoadedLibrary {
  const buckets = new Map<
    string,
    { size: number; fileCount: number; kind: ClipKind; hasThumb: boolean }
  >();

  for (const file of files) {
    const parts = (file.webkitRelativePath || file.name).split(/[/\\]/);
    let kind: ClipKind = "unknown";
    let clipName: string | null = null;

    for (const part of parts) {
      if (BUCKETS.has(part as ClipKind)) {
        kind = part as ClipKind;
      }
      if (!clipName && parseClipFolderName(part)) {
        clipName = part;
      }
    }

    if (!clipName) continue;
    const existing = buckets.get(clipName) ?? {
      size: 0,
      fileCount: 0,
      kind: kind === "unknown" ? "SentryClips" : kind,
      hasThumb: false,
    };
    existing.size += file.size;
    existing.fileCount += 1;
    if (kind !== "unknown") existing.kind = kind;
    if (parts[parts.length - 1]?.toLowerCase() === "thumb.png") {
      existing.hasThumb = true;
    }
    buckets.set(clipName, existing);
  }

  const clips: Clip[] = [];
  for (const [name, info] of buckets) {
    const timestamp = parseClipFolderName(name);
    if (!timestamp) continue;
    clips.push({
      id: `${info.kind}:${name}`,
      name,
      timestamp,
      size: info.size,
      fileCount: info.fileCount,
      kind: info.kind,
      hasThumb: info.hasThumb,
    });
  }

  const top = files[0]?.webkitRelativePath.split(/[/\\]/)[0] ?? "SentryClips";
  return {
    clips,
    label: top,
    canDelete: false,
    directory: null,
    parents: new Map(),
  };
}

async function hasThumbHandle(
  directory: DirectoryHandleLike,
): Promise<boolean> {
  if (!directory.getFileHandle) return false;
  try {
    await directory.getFileHandle("thumb.png");
    return true;
  } catch {
    return false;
  }
}

export async function resolveClipDirectory(
  directory: DirectoryHandleLike,
  clipName: string,
): Promise<DirectoryHandleLike | null> {
  if (directory.name === clipName) return directory;
  try {
    return await directory.getDirectoryHandle(clipName);
  } catch {
    return null;
  }
}

export async function readClipEvent(
  directory: DirectoryHandleLike,
): Promise<ClipEventMeta | null> {
  if (!directory.getFileHandle) return null;
  try {
    const handle = await directory.getFileHandle("event.json");
    const file = await handle.getFile();
    return parseClipEvent(JSON.parse(await file.text()));
  } catch {
    return null;
  }
}

export async function listVideoFileNames(
  directory: DirectoryHandleLike,
): Promise<string[]> {
  const names: string[] = [];
  for await (const [name, handle] of directory.entries()) {
    if (handle.kind === "file" && /\.mp4$/i.test(name)) names.push(name);
  }
  names.sort();
  return names;
}

export async function readVideoObjectUrl(
  directory: DirectoryHandleLike,
  fileName: string,
): Promise<string> {
  if (!directory.getFileHandle) {
    throw new CodedError("videos_unsupported");
  }
  if (!/^[^\\/]+\.mp4$/i.test(fileName)) {
    throw new CodedError("mp4_only");
  }
  const handle = await directory.getFileHandle(fileName);
  const file = await handle.getFile();
  return URL.createObjectURL(file);
}

export async function deleteClipFolders(
  names: string[],
  parents: Map<string, DirectoryHandleLike>,
): Promise<{ deleted: string[]; failed: Array<{ name: string; error: string }> }> {
  const deleted: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];

  for (const name of names) {
    const parent = parents.get(name);
    if (!parent) {
      failed.push({ name, error: "parent_missing" });
      continue;
    }
    try {
      const writable = await ensurePermission(parent, "readwrite");
      if (!writable) {
        failed.push({ name, error: "write_denied" });
        continue;
      }
      await parent.removeEntry(name, { recursive: true });
      deleted.push(name);
    } catch (error) {
      failed.push({
        name,
        error: error instanceof CodedError ? error.message : "delete_failed",
      });
    }
  }

  return { deleted, failed };
}
