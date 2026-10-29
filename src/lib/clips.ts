export type ClipKind = "SentryClips" | "RecentClips" | "SavedClips" | "unknown";
export type KeepPolicy = "first" | "last" | "middle" | "spaced";

export type ClipLocation = {
  street?: string;
  city?: string;
  lat?: number;
  lon?: number;
};

export type Clip = {
  id: string;
  name: string;
  timestamp: Date;
  size: number;
  fileCount: number;
  kind: ClipKind;
  location?: ClipLocation;
  hasThumb?: boolean;
};

export type ClipCluster = {
  id: string;
  clips: Clip[];
  start: Date;
  end: Date;
  spanMs: number;
  dense: boolean;
};

const TESLA_FOLDER =
  /^(\d{4})-(\d{2})-(\d{2})[_T](\d{2})-(\d{2})-(\d{2})$/;
const TESLA_COMPACT = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/;
const CAMERA_SUFFIX =
  /-(front|back|left_repeater|right_repeater|left_pillar|right_pillar)$/i;

export function normalizeClipName(raw: string): string {
  return raw
    .trim()
    .replace(/[/\\]+$/, "")
    .split(/[/\\]/)
    .pop()!
    .replace(/\.(mp4|mov|jpg|png|json)$/i, "")
    .replace(CAMERA_SUFFIX, "");
}

export function parseClipFolderName(raw: string): Date | null {
  const name = normalizeClipName(raw);
  const dashed = name.match(TESLA_FOLDER);
  if (dashed) {
    return localDate(
      dashed[1],
      dashed[2],
      dashed[3],
      dashed[4],
      dashed[5],
      dashed[6],
    );
  }
  const compact = name.match(TESLA_COMPACT);
  if (compact) {
    return localDate(
      compact[1],
      compact[2],
      compact[3],
      compact[4],
      compact[5],
      compact[6],
    );
  }
  return null;
}

function localDate(
  y: string,
  mo: string,
  d: string,
  h: string,
  mi: string,
  s: string,
): Date | null {
  const date = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parsePastedNames(text: string, kind: ClipKind = "SentryClips"): Clip[] {
  const found = new Set<string>();
  const clips: Clip[] = [];
  const pattern =
    /\b(\d{4}-\d{2}-\d{2}[_T]\d{2}-\d{2}-\d{2}|\d{8}_\d{6})\b/g;
  for (const match of text.matchAll(pattern)) {
    const name = match[1];
    if (found.has(name)) continue;
    const timestamp = parseClipFolderName(name);
    if (!timestamp) continue;
    found.add(name);
    clips.push({
      id: name,
      name,
      timestamp,
      size: 0,
      fileCount: 0,
      kind,
    });
  }
  return sortClips(clips);
}

export function parseEventLocation(raw: unknown): ClipLocation | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const data = raw as Record<string, unknown>;
  const street = typeof data.street === "string" ? data.street.trim() : "";
  const city = typeof data.city === "string" ? data.city.trim() : "";
  const lat = Number.parseFloat(String(data.est_lat ?? data.latitude ?? ""));
  const lon = Number.parseFloat(
    String(data.est_lon ?? data.est_lng ?? data.longitude ?? ""),
  );
  const hasCoord =
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    !(Math.abs(lat) < 0.001 && Math.abs(lon) < 0.001);
  if (!street && !city && !hasCoord) return undefined;
  return {
    street: street || undefined,
    city: city || undefined,
    lat: hasCoord ? lat : undefined,
    lon: hasCoord ? lon : undefined,
  };
}

export function formatClipLocation(location?: ClipLocation): string {
  if (!location) return "";
  return [location.street, location.city].filter(Boolean).join(" · ");
}

export function mapsUrl(location?: ClipLocation): string | null {
  if (location?.lat == null || location.lon == null) return null;
  return `https://www.google.com/maps?q=${location.lat},${location.lon}`;
}

export function sharedLocationLabel(clips: Clip[]): string {
  const labels = [
    ...new Set(
      clips.map((clip) => formatClipLocation(clip.location)).filter(Boolean),
    ),
  ];
  if (labels.length === 1) return labels[0];
  if (labels.length > 1) return "多個地點";
  return "";
}

export type LocationStat = {
  key: string;
  label: string;
  count: number;
  bytes: number;
};

export function locationKey(location?: ClipLocation): string {
  const named = formatClipLocation(location);
  if (named) return named;
  if (location?.lat != null && location.lon != null) {
    return `${location.lat.toFixed(3)},${location.lon.toFixed(3)}`;
  }
  return "";
}

export function locationLabel(location?: ClipLocation): string {
  return locationKey(location);
}

export function locationStats(clips: Clip[]): LocationStat[] {
  const grouped = new Map<string, LocationStat>();
  for (const clip of clips) {
    const key = locationKey(clip.location);
    if (!key) continue;
    const current = grouped.get(key);
    if (current) {
      current.count += 1;
      current.bytes += clip.size;
    } else {
      grouped.set(key, {
        key,
        label: locationLabel(clip.location),
        count: 1,
        bytes: clip.size,
      });
    }
  }
  return [...grouped.values()].sort(
    (left, right) =>
      right.count - left.count || left.label.localeCompare(right.label, "zh-Hant"),
  );
}

export function namesAtLocations(
  clips: Clip[],
  keys: Iterable<string>,
): string[] {
  const wanted = new Set([...keys].filter(Boolean));
  if (wanted.size === 0) return [];
  return clips
    .filter((clip) => wanted.has(locationKey(clip.location)))
    .map((clip) => clip.name);
}

export function clipsFromNamedFolders(
  items: Array<{
    name: string;
    kind: ClipKind;
    size?: number;
    fileCount?: number;
    location?: ClipLocation;
    hasThumb?: boolean;
  }>,
): Clip[] {
  const clips: Clip[] = [];
  for (const item of items) {
    const timestamp = parseClipFolderName(item.name);
    if (!timestamp) continue;
    clips.push({
      id: `${item.kind}:${item.name}`,
      name: item.name,
      timestamp,
      size: item.size ?? 0,
      fileCount: item.fileCount ?? 0,
      kind: item.kind,
      location: item.location,
      hasThumb: item.hasThumb,
    });
  }
  return sortClips(clips);
}

export function sortClips(clips: Clip[]): Clip[] {
  return [...clips].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime() || a.name.localeCompare(b.name),
  );
}

export function clusterClips(clips: Clip[], gapMs: number): ClipCluster[] {
  const sorted = sortClips(clips);
  if (sorted.length === 0) return [];

  const groups: Clip[][] = [];
  let current: Clip[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const previous = current[current.length - 1];
    const next = sorted[i];
    if (next.timestamp.getTime() - previous.timestamp.getTime() <= gapMs) {
      current.push(next);
    } else {
      groups.push(current);
      current = [next];
    }
  }
  groups.push(current);

  return groups.map((group, index) => {
    const start = group[0].timestamp;
    const end = group[group.length - 1].timestamp;
    return {
      id: `${index}-${group[0].name}`,
      clips: group,
      start,
      end,
      spanMs: end.getTime() - start.getTime(),
      dense: false,
    };
  });
}

export function withDensity(
  clusters: ClipCluster[],
  minClusterSize: number,
): ClipCluster[] {
  return clusters.map((cluster) => ({
    ...cluster,
    dense: cluster.clips.length >= minClusterSize,
  }));
}

export function namesToKeep(
  clips: Clip[],
  policy: KeepPolicy,
  spacedGapMs: number,
): string[] {
  if (clips.length === 0) return [];
  if (policy === "first") return [clips[0].name];
  if (policy === "last") return [clips[clips.length - 1].name];
  if (policy === "middle") {
    return [clips[Math.floor((clips.length - 1) / 2)].name];
  }

  const kept: Clip[] = [clips[0]];
  for (const clip of clips.slice(1)) {
    const last = kept[kept.length - 1];
    if (clip.timestamp.getTime() - last.timestamp.getTime() >= spacedGapMs) {
      kept.push(clip);
    }
  }
  return kept.map((clip) => clip.name);
}

export function applyClusterKeep(
  current: Iterable<string>,
  names: string[],
  mode: "all" | "first",
): Set<string> {
  const next = new Set(current);
  names.forEach((name, index) => {
    if (mode === "all" || index === 0) next.delete(name);
    else next.add(name);
  });
  return next;
}

export function suggestedDeleteNames(
  clusters: ClipCluster[],
  policy: KeepPolicy,
  minClusterSize: number,
  spacedGapMs: number,
): Set<string> {
  const names = new Set<string>();
  for (const cluster of clusters) {
    if (cluster.clips.length < minClusterSize) continue;
    const keep = new Set(namesToKeep(cluster.clips, policy, spacedGapMs));
    for (const clip of cluster.clips) {
      if (!keep.has(clip.name)) names.add(clip.name);
    }
  }
  return names;
}

export function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("zh-TW", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatClock(date: Date): string {
  return new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours} 小時 ${minutes} 分`;
  if (minutes > 0) return seconds ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分鐘`;
  return `${seconds} 秒`;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "大小未知";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 10 || unit === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

export function formatGapMinutes(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  return remain === 0 ? `${minutes} 分鐘` : `${minutes} 分 ${remain} 秒`;
}

export function clipKindLabel(kind: ClipKind): string {
  if (kind === "SentryClips") return "SentryClips";
  if (kind === "RecentClips") return "RecentClips";
  if (kind === "SavedClips") return "SavedClips";
  return "未分類";
}

export function summarize(clips: Clip[], selected: Set<string>) {
  const selectedClips = clips.filter((clip) => selected.has(clip.name));
  const totalBytes = clips.reduce((sum, clip) => sum + clip.size, 0);
  const selectedBytes = selectedClips.reduce((sum, clip) => sum + clip.size, 0);
  return {
    total: clips.length,
    selectedCount: selectedClips.length,
    totalBytes,
    selectedBytes,
    knownBytes: clips.some((clip) => clip.size > 0),
  };
}
