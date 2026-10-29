import type { Locale } from "../i18n/locale";

export const CAMERA_ORDER = [
  "front",
  "back",
  "left_repeater",
  "right_repeater",
  "left_pillar",
  "right_pillar",
] as const;

export type CameraId = (typeof CAMERA_ORDER)[number];

const VIDEO_NAME =
  /^(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})-(front|back|left_repeater|right_repeater|left_pillar|right_pillar)\.mp4$/i;

export type ClipVideoFile = {
  name: string;
  camera: CameraId;
  size?: number;
};

export type ClipVideoSegment = {
  id: string;
  files: ClipVideoFile[];
};

export function parseClipVideoName(
  fileName: string,
): { segmentId: string; camera: CameraId } | null {
  const match = fileName.match(VIDEO_NAME);
  if (!match) return null;
  return {
    segmentId: match[1],
    camera: match[2].toLowerCase() as CameraId,
  };
}

export function groupClipVideos(
  files: Array<{ name: string; size?: number }>,
): ClipVideoSegment[] {
  const groups = new Map<string, ClipVideoFile[]>();
  for (const file of files) {
    const parsed = parseClipVideoName(file.name);
    if (!parsed) continue;
    const list = groups.get(parsed.segmentId) ?? [];
    list.push({
      name: file.name,
      camera: parsed.camera,
      size: file.size,
    });
    groups.set(parsed.segmentId, list);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, grouped]) => ({
      id,
      files: grouped.sort(
        (left, right) =>
          CAMERA_ORDER.indexOf(left.camera) - CAMERA_ORDER.indexOf(right.camera),
      ),
    }));
}

const CAMERA_LABELS: Record<Locale, Record<CameraId, string>> = {
  en: {
    front: "Front",
    back: "Rear",
    left_repeater: "Left",
    right_repeater: "Right",
    left_pillar: "Left pillar",
    right_pillar: "Right pillar",
  },
  "zh-Hant": {
    front: "前方",
    back: "後方",
    left_repeater: "左方",
    right_repeater: "右方",
    left_pillar: "左 B 柱",
    right_pillar: "右 B 柱",
  },
};

const REASON_LABELS: Record<
  Locale,
  {
    object: string;
    shake: string;
    handle: string;
    honk: string;
    manual: string;
    interaction: string;
  }
> = {
  en: {
    object: "Object detected",
    shake: "Vehicle shaken",
    handle: "Door handle pulled",
    honk: "Horn",
    manual: "Saved manually",
    interaction: "Manual action",
  },
  "zh-Hant": {
    object: "偵測到物體",
    shake: "車輛晃動",
    handle: "拉動門把",
    honk: "按喇叭",
    manual: "手動儲存",
    interaction: "手動操作",
  },
};

export function cameraLabel(camera: CameraId, locale: Locale = "en"): string {
  return CAMERA_LABELS[locale][camera];
}

export function segmentClock(segmentId: string): string {
  const match = segmentId.match(/_(\d{2})-(\d{2})-(\d{2})$/);
  if (!match) return segmentId;
  return `${match[1]}:${match[2]}:${match[3]}`;
}

export function segmentStartMs(segmentId: string): number | null {
  return parseTeslaTimestamp(
    segmentId.replace(/_(\d{2})-(\d{2})-(\d{2})$/, "T$1:$2:$3"),
  );
}

/** Tesla event.json camera index. 0 front, 3/4 repeaters, 5/6 pillars, 7 rear. */
const CAMERA_BY_INDEX: Record<string, CameraId> = {
  "0": "front",
  "1": "front",
  "2": "front",
  "3": "left_repeater",
  "4": "right_repeater",
  "5": "left_pillar",
  "6": "right_pillar",
  "7": "back",
};

export type ClipEventMeta = {
  timestamp: string | null;
  reason: string | null;
  camera: CameraId | null;
  lat: number | null;
  lon: number | null;
};

export function eventCameraId(raw: unknown): CameraId | null {
  const text =
    typeof raw === "number" && Number.isFinite(raw)
      ? String(raw)
      : typeof raw === "string"
        ? raw.trim().toLowerCase()
        : "";
  if (!text) return null;
  if ((CAMERA_ORDER as readonly string[]).includes(text)) return text as CameraId;
  if (text === "left") return "left_repeater";
  if (text === "right") return "right_repeater";
  if (text === "rear" || text === "rear_view") return "back";
  return CAMERA_BY_INDEX[text] ?? null;
}

export function eventReasonLabel(reason: string | null, locale: Locale = "en"): string {
  if (!reason) return "";
  const copy = REASON_LABELS[locale];
  if (reason === "sentry_aware_object_detection") return copy.object;
  if (reason === "sentry_aware_accel" || reason.startsWith("sentry_aware_accel")) {
    return copy.shake;
  }
  if (reason === "sentry_locked_handle_pulled") return copy.handle;
  if (reason === "user_interaction_honk") return copy.honk;
  if (
    reason === "user_interaction_dashcam_icon_tapped" ||
    reason === "user_interaction_dashcam_panel_save" ||
    reason === "user_interaction_dashcam_launcher_action_tapped"
  ) {
    return copy.manual;
  }
  if (reason.startsWith("user_interaction")) return copy.interaction;
  return reason;
}

export function parseClipEvent(raw: unknown): ClipEventMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const timestamp = typeof data.timestamp === "string" ? data.timestamp : null;
  const reason =
    typeof data.reason === "string" && data.reason.trim()
      ? data.reason.trim()
      : null;
  const camera = eventCameraId(data.camera);
  const lat = Number.parseFloat(String(data.est_lat ?? data.latitude ?? ""));
  const lon = Number.parseFloat(
    String(data.est_lon ?? data.est_lng ?? data.longitude ?? ""),
  );
  const hasCoord =
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    !(Math.abs(lat) < 0.001 && Math.abs(lon) < 0.001);
  if (!timestamp && !reason && camera == null && !hasCoord) return null;
  return {
    timestamp,
    reason,
    camera,
    lat: hasCoord ? lat : null,
    lon: hasCoord ? lon : null,
  };
}

export const DEFAULT_SEGMENT_SECONDS = 60;

export type ClipTimelineSpan = {
  id: string;
  startMs: number;
  endMs: number;
};

export type ClipTimeline = {
  startMs: number;
  endMs: number;
  spans: ClipTimelineSpan[];
};

export function buildClipTimeline(
  segmentIds: string[],
  includeMs?: number,
): ClipTimeline | null {
  const starts = segmentIds
    .map((id) => {
      const startMs = segmentStartMs(id);
      return startMs == null ? null : { id, startMs };
    })
    .filter((item): item is { id: string; startMs: number } => item !== null)
    .sort((left, right) => left.startMs - right.startMs);
  if (starts.length === 0) return null;

  const spans = starts.map((item, index) => {
    const next = starts[index + 1];
    return {
      id: item.id,
      startMs: item.startMs,
      endMs: next ? next.startMs : item.startMs + DEFAULT_SEGMENT_SECONDS * 1000,
    };
  });
  let endMs = spans[spans.length - 1].endMs;
  if (includeMs != null && includeMs > endMs) {
    endMs = includeMs;
    spans[spans.length - 1] = { ...spans[spans.length - 1], endMs };
  }
  return { startMs: spans[0].startMs, endMs, spans };
}

export function ratioOnTimeline(timeline: ClipTimeline, timeMs: number): number {
  const span = timeline.endMs - timeline.startMs;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (timeMs - timeline.startMs) / span));
}

export function seekOnTimeline(
  timeline: ClipTimeline,
  ratio: number,
): { segmentId: string; seconds: number } | null {
  if (timeline.spans.length === 0) return null;
  const clamped = Math.min(1, Math.max(0, ratio));
  const timeMs =
    timeline.startMs + clamped * (timeline.endMs - timeline.startMs);
  let hit = timeline.spans[0];
  for (const span of timeline.spans) {
    if (span.startMs <= timeMs) hit = span;
  }
  const length = Math.max((hit.endMs - hit.startMs) / 1000, 0);
  return {
    segmentId: hit.id,
    seconds: Math.min(Math.max(0, (timeMs - hit.startMs) / 1000), length),
  };
}

export function parseTeslaTimestamp(raw: string): number | null {
  const match = raw
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[T_ ](\d{2})[:-](\d{2})[:-](\d{2})/);
  if (!match) return null;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

export function formatTeslaClock(timeMs: number): string {
  const date = new Date(timeMs);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

const SAME_SIDE: Record<CameraId, readonly CameraId[]> = {
  front: ["front"],
  back: ["back"],
  left_repeater: ["left_repeater", "left_pillar"],
  left_pillar: ["left_repeater", "left_pillar"],
  right_repeater: ["right_repeater", "right_pillar"],
  right_pillar: ["right_repeater", "right_pillar"],
};

/** Open the triggered side by default (two cameras). Without a trigger, open the front camera. `all` opens every camera in that minute. */
export function camerasToOpen(
  available: readonly CameraId[],
  trigger: CameraId | null,
  all: boolean,
): CameraId[] {
  const present = CAMERA_ORDER.filter((camera) => available.includes(camera));
  if (present.length === 0) return [];
  if (all) return present;
  const side = trigger ? SAME_SIDE[trigger] : ["front" as const];
  const picked = present.filter((camera) => side.includes(camera));
  if (picked.length > 0) return picked;
  if (present.includes("front")) return ["front"];
  return [present[0]];
}

export function locateEventTime(
  segmentIds: string[],
  eventMs: number,
): { segmentId: string; seconds: number } | null {
  const starts = segmentIds
    .map((id) => {
      const start = segmentStartMs(id);
      return start == null ? null : { id, start };
    })
    .filter((item): item is { id: string; start: number } => item !== null)
    .sort((left, right) => left.start - right.start);
  if (starts.length === 0) return null;

  let hit = starts[0];
  for (const item of starts) {
    if (item.start <= eventMs) hit = item;
  }
  return {
    segmentId: hit.id,
    seconds: Math.max(0, (eventMs - hit.start) / 1000),
  };
}
