import { existsSync, readdirSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";

import {
  parseClipFolderName,
  parseEventLocation,
  type ClipKind,
  type ClipLocation,
} from "@/lib/clips";
import { DEFAULT_SENTRY_ROOT } from "@/lib/export-script";

const BUCKETS = new Set<ClipKind>([
  "SentryClips",
  "RecentClips",
  "SavedClips",
]);

export type ScannedFolder = {
  name: string;
  kind: ClipKind;
  size: number;
  fileCount: number;
  location?: ClipLocation;
  hasThumb?: boolean;
};

export type LocalScanResult = {
  label: string;
  root: string;
  clipRoot: string;
  folders: ScannedFolder[];
};

async function listDirectories(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

async function measureFolder(
  path: string,
): Promise<{ size: number; fileCount: number }> {
  let size = 0;
  let fileCount = 0;
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return { size: 0, fileCount: 0 };
  }

  for (const entry of entries) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) {
      const nested = await measureFolder(full);
      size += nested.size;
      fileCount += nested.fileCount;
      continue;
    }
    try {
      const info = await stat(full);
      size += info.size;
      fileCount += 1;
    } catch {
      // OneDrive 佔位檔若暫時讀不到就略過該檔
    }
  }
  return { size, fileCount };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile();
  } catch {
    return false;
  }
}

async function readEventLocation(
  dir: string,
): Promise<ClipLocation | undefined> {
  try {
    const raw = await readFile(join(dir, "event.json"), "utf8");
    return parseEventLocation(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

async function withSizes(
  folders: Array<{ name: string; kind: ClipKind; dir: string }>,
): Promise<ScannedFolder[]> {
  const measured: ScannedFolder[] = new Array(folders.length);
  let cursor = 0;
  const workers = Math.min(12, Math.max(1, folders.length));

  async function worker() {
    while (cursor < folders.length) {
      const index = cursor;
      cursor += 1;
      const folder = folders[index];
      const [stats, location, hasThumb] = await Promise.all([
        measureFolder(folder.dir),
        readEventLocation(folder.dir),
        fileExists(join(folder.dir, "thumb.png")),
      ]);
      measured[index] = {
        name: folder.name,
        kind: folder.kind,
        size: stats.size,
        fileCount: stats.fileCount,
        location,
        hasThumb,
      };
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  return measured;
}

function clipRootFrom(dirs: string[], fallback: string): string {
  const parents = [...new Set(dirs.map((dir) => dirname(dir)))];
  const sentry = parents.find((parent) => /[\\/]SentryClips$/i.test(parent));
  if (sentry) return sentry;
  if (parents.length === 1) return parents[0];
  return fallback;
}

export async function scanLocalClipPath(rawPath: string): Promise<LocalScanResult> {
  const target = rawPath.trim();
  if (!target) {
    throw new Error("請輸入資料夾路徑");
  }
  if (!isAbsolute(target)) {
    throw new Error("請輸入完整路徑，例如 C:\\Users\\...\\SentryClips");
  }

  const info = await stat(target).catch(() => null);
  if (!info) {
    throw new Error(`找不到資料夾：${target}`);
  }
  if (!info.isDirectory()) {
    throw new Error("這不是資料夾");
  }

  const rootName = basename(target);
  const dirs = await listDirectories(target);

  if (BUCKETS.has(rootName as ClipKind)) {
    const pending = dirs
      .filter((name) => parseClipFolderName(name))
      .map((name) => ({
        name,
        kind: rootName as ClipKind,
        dir: join(target, name),
      }));
    return {
      label: rootName,
      root: target,
      clipRoot: clipRootFrom(
        pending.map((folder) => folder.dir),
        target,
      ),
      folders: await withSizes(pending),
    };
  }

  const buckets = dirs.filter((name) => BUCKETS.has(name as ClipKind));
  if (buckets.length > 0) {
    const pending: Array<{ name: string; kind: ClipKind; dir: string }> = [];
    for (const bucket of buckets) {
      const children = await listDirectories(join(target, bucket));
      const kind = bucket as ClipKind;
      for (const name of children) {
        if (parseClipFolderName(name)) {
          pending.push({ name, kind, dir: join(target, bucket, name) });
        }
      }
    }
    return {
      label: rootName,
      root: target,
      clipRoot: clipRootFrom(
        pending.map((folder) => folder.dir),
        target,
      ),
      folders: await withSizes(pending),
    };
  }

  const loose = dirs.filter((name) => parseClipFolderName(name));
  if (loose.length > 0) {
    const looseFolders = loose.map((name) => ({
      name,
      kind: "unknown" as const,
      dir: join(target, name),
    }));
    return {
      label: rootName,
      root: target,
      clipRoot: clipRootFrom(
        looseFolders.map((folder) => folder.dir),
        target,
      ),
      folders: await withSizes(looseFolders),
    };
  }

  if (parseClipFolderName(rootName)) {
    return {
      label: rootName,
      root: target,
      clipRoot: dirname(target),
      folders: await withSizes([
        { name: rootName, kind: "SentryClips", dir: target },
      ]),
    };
  }

  return { label: rootName, root: target, clipRoot: target, folders: [] };
}

export function resolveClipRoot(
  folderPath: string | null,
  sampleNames: string[],
): string | null {
  if (!folderPath) return null;
  const trimmed = folderPath.replace(/[\\/]+$/, "");
  const samples = sampleNames.filter(Boolean).slice(0, 8);
  if (containsAny(trimmed, samples) > 0) return trimmed;
  const nested = join(trimmed, "SentryClips");
  if (containsAny(nested, samples) > 0) return nested;
  if (samples.length === 0 && existsSync(trimmed)) {
    return /[\\/]SentryClips$/i.test(trimmed) ? trimmed : nested;
  }
  return null;
}

function windowsDrives(): string[] {
  const drives: string[] = [];
  for (const letter of "CDEFGHIJKLMNOPQRSTUVWXYZ") {
    const root = `${letter}:\\`;
    if (existsSync(root)) drives.push(root);
  }
  return drives;
}

function containsAny(dir: string, names: string[]): number {
  return names.reduce(
    (count, name) => count + (existsSync(join(dir, name)) ? 1 : 0),
    0,
  );
}

export function resolveSelectedFolderPath(options: {
  folderName: string;
  sampleNames: string[];
  hintPath?: string;
}): string | null {
  const folderName = options.folderName.trim();
  if (!folderName) return null;
  const samples = options.sampleNames.filter(Boolean).slice(0, 8);

  const hints: string[] = [];
  if (options.hintPath?.trim()) hints.push(options.hintPath.trim());
  hints.push(DEFAULT_SENTRY_ROOT);
  const home = homedir();
  const oneDrive = join(home, "OneDrive");
  if (existsSync(oneDrive)) {
    for (const name of readdirSync(oneDrive)) {
      if (!/tesla|cam/i.test(name)) continue;
      hints.push(join(oneDrive, name, "SentryClips"), join(oneDrive, name));
    }
  }
  for (const drive of windowsDrives()) {
    hints.push(
      join(drive, "TeslaCam", "SentryClips"),
      join(drive, "TeslaCam"),
      join(drive, "TeslausbCam", "SentryClips"),
      join(drive, "TeslausbCam"),
      join(drive, "TeslausbCamModelX", "SentryClips"),
      join(drive, "TeslausbCamModelX"),
      join(drive, "SentryClips"),
    );
  }

  const candidates = new Set<string>();
  for (const hint of hints) {
    candidates.add(hint);
    candidates.add(join(hint, folderName));
    candidates.add(dirname(hint));
    candidates.add(join(dirname(hint), folderName));
  }

  const matches: string[] = [];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    if (basename(candidate).toLowerCase() !== folderName.toLowerCase()) continue;

    const direct = containsAny(candidate, samples);
    const nested = containsAny(join(candidate, "SentryClips"), samples);
    if (samples.length === 0 || direct > 0 || nested > 0) {
      matches.push(candidate);
    }
  }

  if (matches.length === 0) return null;
  matches.sort((left, right) => {
    const score = (path: string) => {
      let value = containsAny(path, samples);
      value += containsAny(join(path, "SentryClips"), samples);
      if (/SentryClips$/i.test(path)) value += 10;
      return value;
    };
    return score(right) - score(left);
  });
  return matches[0];
}
