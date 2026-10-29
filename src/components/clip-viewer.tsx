"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, Pause, Play, SkipForward } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  buildClipTimeline,
  cameraLabel,
  camerasToOpen,
  eventReasonLabel,
  formatTeslaClock,
  groupClipVideos,
  locateEventTime,
  parseTeslaTimestamp,
  ratioOnTimeline,
  seekOnTimeline,
  segmentStartMs,
  type CameraId,
  type ClipEventMeta,
  type ClipTimeline,
  type ClipVideoSegment,
} from "@/lib/clip-videos";
import { formatBytes, formatClipLocation, mapsUrl, type Clip } from "@/lib/clips";
import {
  listVideoFileNames,
  readClipEvent,
  readVideoObjectUrl,
  resolveClipDirectory,
  type DirectoryHandleLike,
} from "@/lib/fs-access";
import { cn } from "@/lib/utils";

const CAMERA_LAYOUT: CameraId[] = [
  "front",
  "left_repeater",
  "right_repeater",
  "left_pillar",
  "right_pillar",
  "back",
];

type ClipViewerProps = {
  clip: Clip | null;
  root: string;
  folder: DirectoryHandleLike | null;
  demo: boolean;
  onClose: () => void;
};

export function ClipViewer({
  clip,
  root,
  folder,
  demo,
  onClose,
}: ClipViewerProps) {
  const [segments, setSegments] = useState<ClipVideoSegment[]>([]);
  const [segmentId, setSegmentId] = useState<string | null>(null);
  const [mediaDir, setMediaDir] = useState<DirectoryHandleLike | null>(null);
  const [event, setEvent] = useState<ClipEventMeta | null>(null);
  const [sourcesFor, setSourcesFor] = useState<string | null>(null);
  const [sources, setSources] = useState<Partial<Record<CameraId, string>>>({});
  const [playheadMs, setPlayheadMs] = useState<number | null>(null);
  const [allCameras, setAllCameras] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videos = useRef(new Map<CameraId, HTMLVideoElement>());
  const blobUrls = useRef<string[]>([]);
  const sourcesRef = useRef<Partial<Record<CameraId, string>>>({});
  const sourcesForRef = useRef<string | null>(null);
  const pendingSeek = useRef<{ segmentId: string; seconds: number } | null>(null);

  const segment = segments.find((item) => item.id === segmentId) ?? null;

  useEffect(() => {
    videos.current.clear();
    sourcesRef.current = {};
    sourcesForRef.current = null;
    setSources({});
    setSourcesFor(null);
    setEvent(null);
    setMediaDir(null);
    setPlayheadMs(null);
    setAllCameras(false);
    setSegments([]);
    setSegmentId(null);
    pendingSeek.current = null;
    revokeBlobs(blobUrls.current);
    blobUrls.current = [];
    if (!clip) {
      setSegments([]);
      setSegmentId(null);
      setStatus(null);
      setError(null);
      return;
    }
    if (demo) {
      setSegments([]);
      setSegmentId(null);
      setStatus(null);
      setError("示範資料沒有影片。請掃描本機 SentryClips 後再觀看。");
      return;
    }

    let cancelled = false;
    setStatus("正在讀取這個資料夾的鏡頭…");
    setError(null);
    void loadSegments(clip.name, root, folder)
      .then((next) => {
        if (cancelled) return;
        setMediaDir(next.directory);
        setEvent(next.event);
        setSegments(next.segments);
        const ids = next.segments.map((item) => item.id);
        const parsed = next.event?.timestamp
          ? parseTeslaTimestamp(next.event.timestamp)
          : null;
        const jump =
          ids.length > 0
            ? locateEventTime(ids, parsed ?? clip.timestamp.getTime())
            : null;
        pendingSeek.current = jump;
        setSegmentId(jump?.segmentId ?? ids[0] ?? null);
        if (jump) {
          const start = segmentStartMs(jump.segmentId);
          if (start != null) setPlayheadMs(start + jump.seconds * 1000);
        }
        setStatus(null);
        if (next.segments.length === 0) {
          setError("這個資料夾裡沒有可播放的 mp4。");
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setSegments([]);
        setSegmentId(null);
        setStatus(null);
        setError(err instanceof Error ? err.message : "無法讀取影片");
      });
    return () => {
      cancelled = true;
    };
  }, [clip, demo, folder, root]);

  useEffect(() => {
    if (!clip || !segment || demo) {
      revokeBlobs(blobUrls.current);
      blobUrls.current = [];
      sourcesRef.current = {};
      sourcesForRef.current = null;
      setSources({});
      setSourcesFor(null);
      return;
    }

    const wanted = camerasToOpen(
      segment.files.map((file) => file.camera),
      allCameras ? null : (event?.camera ?? null),
      allCameras,
    );
    const files = segment.files.filter((file) => wanted.includes(file.camera));
    const sameSegment = sourcesForRef.current === segment.id;
    const keep: Partial<Record<CameraId, string>> = {};
    if (sameSegment) {
      for (const file of files) {
        const url = sourcesRef.current[file.camera];
        if (url) keep[file.camera] = url;
      }
    }
    const keptBlobs = new Set(
      Object.values(keep).map((url) => blobIdentity(url)),
    );
    revokeBlobs(blobUrls.current.filter((url) => !keptBlobs.has(url)));
    blobUrls.current = blobUrls.current.filter((url) => keptBlobs.has(url));

    const missing = files.filter((file) => !keep[file.camera]);
    const pendingStart =
      pendingSeek.current?.segmentId === segment.id
        ? pendingSeek.current.seconds
        : null;
    const startAt = pendingStart ?? leadSeconds(videos.current);
    if (missing.length === 0) {
      sourcesRef.current = keep;
      sourcesForRef.current = segment.id;
      setSources(keep);
      setSourcesFor(segment.id);
      return;
    }

    let cancelled = false;
    if (!mediaDir) {
      const next = {
        ...keep,
        ...Object.fromEntries(
          missing.map((file) => [
            file.camera,
            withStart(clipMediaUrl(root, clip.name, file.name), startAt),
          ]),
        ),
      };
      sourcesRef.current = next;
      sourcesForRef.current = segment.id;
      setSources(next);
      setSourcesFor(segment.id);
      return;
    }

    if (Object.keys(keep).length === 0) setStatus("正在開啟影片…");
    else {
      sourcesRef.current = keep;
      setSources(keep);
    }
    void Promise.all(
      missing.map(async (file) => ({
        camera: file.camera,
        url: await readVideoObjectUrl(mediaDir, file.name),
      })),
    )
      .then((opened) => {
        if (cancelled) {
          revokeBlobs(opened.map((item) => item.url));
          return;
        }
        blobUrls.current = [
          ...blobUrls.current,
          ...opened.map((item) => item.url),
        ];
        const next = {
          ...keep,
          ...Object.fromEntries(
            opened.map((item) => [item.camera, withStart(item.url, startAt)]),
          ),
        };
        sourcesRef.current = next;
        sourcesForRef.current = segment.id;
        setSources(next);
        setSourcesFor(segment.id);
        setStatus(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus(null);
        setError(err instanceof Error ? err.message : "無法開啟影片");
      });
    return () => {
      cancelled = true;
    };
  }, [allCameras, clip, demo, event?.camera, mediaDir, root, segment]);

  useEffect(() => {
    const pending = pendingSeek.current;
    if (pending && sourcesFor === pending.segmentId) {
      pendingSeek.current = null;
      seekAll(pending.seconds);
      return;
    }
    const lead = [...videos.current.values()].find(
      (video) => video.readyState >= 1 && video.currentTime > 1,
    );
    if (!lead) return;
    for (const video of videos.current.values()) {
      if (video === lead || video.currentTime > 1) continue;
      const seconds = lead.currentTime;
      const apply = () => {
        const limit = Number.isFinite(video.duration)
          ? Math.max(video.duration - 0.05, 0)
          : seconds;
        video.currentTime = Math.min(seconds, limit);
        if (!lead.paused) void video.play().catch(() => undefined);
      };
      if (video.readyState >= 1) apply();
      else video.addEventListener("loadedmetadata", apply, { once: true });
    }
  }, [sources, sourcesFor]);

  useEffect(() => {
    return () => revokeBlobs(blobUrls.current);
  }, []);

  function seekAll(seconds: number) {
    for (const video of videos.current.values()) {
      const apply = () => {
        const limit = Number.isFinite(video.duration)
          ? Math.max(video.duration - 0.05, 0)
          : seconds;
        video.currentTime = Math.min(Math.max(seconds, 0), limit);
        void video.play().catch(() => undefined);
      };
      if (video.readyState >= 1) apply();
      else video.addEventListener("loadedmetadata", apply, { once: true });
    }
  }

  function jumpTo(nextSegmentId: string, seconds: number) {
    const start = segmentStartMs(nextSegmentId);
    if (start != null) setPlayheadMs(start + seconds * 1000);
    if (nextSegmentId === segmentId && sourcesFor === segmentId) {
      seekAll(seconds);
      return;
    }
    pendingSeek.current = { segmentId: nextSegmentId, seconds };
    setSegmentId(nextSegmentId);
  }

  function jumpToEvent() {
    if (!eventJump) return;
    jumpTo(eventJump.segmentId, eventJump.seconds);
  }

  function scrubTimeline(ratio: number) {
    if (!timeline) return;
    const hit = seekOnTimeline(timeline, ratio);
    if (!hit) return;
    jumpTo(hit.segmentId, hit.seconds);
  }

  function noteTime(video: HTMLVideoElement, camera: CameraId) {
    if (!segment) return;
    const front = videos.current.get("front");
    if (camera !== "front" && sources.front && front && front.readyState >= 1) {
      return;
    }
    const start = segmentStartMs(segment.id);
    if (start == null) return;
    setPlayheadMs(start + video.currentTime * 1000);
  }

  const eventMs = useMemo(() => {
    if (event?.timestamp) {
      const parsed = parseTeslaTimestamp(event.timestamp);
      if (parsed != null) return parsed;
    }
    return clip?.timestamp.getTime() ?? null;
  }, [clip, event]);

  const eventJump = useMemo(() => {
    if (eventMs == null || segments.length === 0) return null;
    return locateEventTime(
      segments.map((item) => item.id),
      eventMs,
    );
  }, [eventMs, segments]);

  const timeline = useMemo(
    () =>
      buildClipTimeline(
        segments.map((item) => item.id),
        eventMs ?? undefined,
      ),
    [eventMs, segments],
  );

  function playAll(play: boolean) {
    for (const video of videos.current.values()) {
      if (play) void video.play().catch(() => undefined);
      else video.pause();
    }
  }

  const place = clip ? formatClipLocation(clip.location) : "";
  const reasonLabel = eventReasonLabel(event?.reason ?? null);
  const triggerLabel = event?.camera ? cameraLabel(event.camera) : "";
  const map =
    event?.lat != null && event.lon != null
      ? mapsUrl({ lat: event.lat, lon: event.lon })
      : null;
  const present = new Set(segment?.files.map((file) => file.camera) ?? []);
  const wantedCameras = camerasToOpen(
    segment?.files.map((file) => file.camera) ?? [],
    allCameras ? null : (event?.camera ?? null),
    allCameras,
  );
  const audible =
    wantedCameras.length === 1
      ? wantedCameras[0]
      : wantedCameras.includes("front")
        ? "front"
        : (event?.camera ?? wantedCameras[0]);

  return (
    <Dialog open={clip !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[min(92vh,960px)] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="font-mono">{clip?.name}</DialogTitle>
          <DialogDescription>
            {place ? `${place} · ` : ""}
            {reasonLabel ? `${reasonLabel} · ` : ""}
            鏡頭只在這台電腦播放，不會上傳。
            {segment && !allCameras && segment.files.length > 1
              ? " 先只載入同一側的鏡頭。"
              : ""}
            {segments.length > 1
              ? ` 這個資料夾有 ${segments.length} 段。`
              : ""}
          </DialogDescription>
        </DialogHeader>

        {status ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            {status}
          </p>
        ) : null}
        {error ? <p className="text-sm text-sentry">{error}</p> : null}

        {event && (reasonLabel || triggerLabel || map) ? (
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-40 space-y-1 text-sm">
              {reasonLabel ? <p>原因：{reasonLabel}</p> : null}
              {triggerLabel ? <p>觸發鏡頭：{triggerLabel}</p> : null}
              {map ? (
                <a
                  className="text-xs text-muted-foreground underline"
                  href={map}
                  target="_blank"
                  rel="noreferrer"
                >
                  在 Google 地圖開啟
                </a>
              ) : null}
            </div>
            {event.lat != null && event.lon != null ? (
              <iframe
                title="事件位置"
                className="h-36 w-56 rounded-lg border border-foreground/10"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                src={osmEmbed(event.lat, event.lon)}
              />
            ) : null}
          </div>
        ) : null}

        {timeline ? (
          <ClipTimelineBar
            timeline={timeline}
            playheadMs={playheadMs}
            eventMs={eventMs}
            onScrub={scrubTimeline}
            onJumpEvent={jumpToEvent}
          />
        ) : null}

        {segment ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => playAll(true)}>
                <Play />
                一起播放
              </Button>
              <Button size="sm" variant="outline" onClick={() => playAll(false)}>
                <Pause />
                全部暫停
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={jumpToEvent}
                disabled={!eventJump}
              >
                <SkipForward />
                跳到事件
                {eventMs != null ? ` ${formatTeslaClock(eventMs)}` : ""}
              </Button>
              {segment.files.length > 1 ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setAllCameras((current) => !current)}
                >
                  {allCameras
                    ? "只留這一側"
                    : `載入全部鏡頭（${segment.files.length}）`}
                </Button>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {CAMERA_LAYOUT.filter(
                (camera) => wantedCameras.includes(camera) && present.has(camera),
              ).map((camera) => {
                  const file = segment.files.find((item) => item.camera === camera);
                  if (!file) return null;
                  const wide =
                    wantedCameras.length === 1 ||
                    camera === "front" ||
                    camera === "back";
                  const triggered = event?.camera === camera;
                  return (
                    <figure
                      key={file.name}
                      className={cn("space-y-1", wide && "col-span-2")}
                    >
                      <figcaption className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>
                          {cameraLabel(file.camera)}
                          {triggered ? (
                            <span className="ml-2 rounded bg-sentry/15 px-1.5 py-0.5 text-sentry">
                              觸發
                            </span>
                          ) : null}
                        </span>
                        <span>{file.size ? formatBytes(file.size) : file.name}</span>
                      </figcaption>
                      {sources[file.camera] ? (
                        <video
                          key={sources[file.camera]}
                          ref={(node) => {
                            if (node) videos.current.set(file.camera, node);
                            else videos.current.delete(file.camera);
                          }}
                          className={cn(
                            "w-full rounded-lg bg-black",
                            wide ? "max-h-[42vh] object-contain" : "aspect-video",
                            triggered && "ring-2 ring-sentry",
                          )}
                          controls
                          playsInline
                          preload="metadata"
                          muted={file.camera !== audible}
                          src={sources[file.camera]}
                          onTimeUpdate={(node) =>
                            noteTime(node.currentTarget, file.camera)
                          }
                        />
                      ) : (
                        <div
                          className={cn(
                            "w-full rounded-lg bg-black",
                            wide ? "h-[42vh]" : "aspect-video",
                          )}
                        />
                      )}
                    </figure>
                  );
                })}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ClipTimelineBar({
  timeline,
  playheadMs,
  eventMs,
  onScrub,
  onJumpEvent,
}: {
  timeline: ClipTimeline;
  playheadMs: number | null;
  eventMs: number | null;
  onScrub: (ratio: number) => void;
  onJumpEvent: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const span = Math.max(timeline.endMs - timeline.startMs, 1);
  const playhead =
    playheadMs == null ? 0 : ratioOnTimeline(timeline, playheadMs);
  const eventRatio =
    eventMs == null ? null : ratioOnTimeline(timeline, eventMs);

  function ratioFromClientX(clientX: number) {
    const rect = track.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }

  return (
    <div className="space-y-1">
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label="播放時間"
        aria-valuemin={0}
        aria-valuemax={Math.round(span / 1000)}
        aria-valuenow={Math.round(playhead * (span / 1000))}
        className="relative h-8 cursor-pointer touch-none"
        onPointerDown={(node) => {
          node.currentTarget.setPointerCapture(node.pointerId);
          onScrub(ratioFromClientX(node.clientX));
        }}
        onPointerMove={(node) => {
          if (!node.currentTarget.hasPointerCapture(node.pointerId)) return;
          onScrub(ratioFromClientX(node.clientX));
        }}
        onKeyDown={(node) => {
          if (node.key !== "ArrowLeft" && node.key !== "ArrowRight") return;
          node.preventDefault();
          const step = node.key === "ArrowRight" ? 2 : -2;
          onScrub(playhead + (step * 1000) / span);
        }}
      >
        <div className="absolute top-3.5 right-0 left-0 h-1.5 rounded-full bg-foreground/15" />
        {timeline.spans.slice(1).map((item) => (
          <span
            key={item.id}
            className="absolute top-3 h-2.5 w-px bg-foreground/30"
            style={{ left: `${((item.startMs - timeline.startMs) / span) * 100}%` }}
          />
        ))}
        <span
          className="pointer-events-none absolute top-2 h-4 w-0.5 -translate-x-1/2 bg-foreground"
          style={{ left: `${playhead * 100}%` }}
        />
        {eventRatio != null ? (
          <button
            type="button"
            className="absolute top-2.5 size-3.5 -translate-x-1/2 rounded-full bg-sentry ring-2 ring-popover"
            style={{ left: `${eventRatio * 100}%` }}
            title={
              eventMs != null ? `事件 ${formatTeslaClock(eventMs)}` : "事件"
            }
            aria-label="跳到事件"
            onPointerDown={(node) => node.stopPropagation()}
            onClick={(node) => {
              node.stopPropagation();
              onJumpEvent();
            }}
          />
        ) : null}
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>{formatTeslaClock(timeline.startMs)}</span>
        <span>
          {playheadMs != null ? formatTeslaClock(playheadMs) : ""}
          {eventMs != null ? ` · 事件 ${formatTeslaClock(eventMs)}` : ""}
        </span>
        <span>{formatTeslaClock(timeline.endMs)}</span>
      </div>
    </div>
  );
}

async function loadSegments(
  clipName: string,
  root: string,
  folder: DirectoryHandleLike | null,
): Promise<{
  segments: ClipVideoSegment[];
  directory: DirectoryHandleLike | null;
  event: ClipEventMeta | null;
}> {
  if (folder) {
    const clipDir = await resolveClipDirectory(folder, clipName);
    if (clipDir) {
      const names = await listVideoFileNames(clipDir);
      const segments = groupClipVideos(names.map((name) => ({ name })));
      if (segments.length > 0) {
        return {
          segments,
          directory: clipDir,
          event: await readClipEvent(clipDir),
        };
      }
    }
  }
  if (!root.trim()) {
    throw new Error("還沒有本機路徑。請先按「掃描本機路徑」，或選擇 SentryClips 資料夾。");
  }
  const response = await fetch(
    `/api/clip-files?root=${encodeURIComponent(root)}&name=${encodeURIComponent(clipName)}`,
  );
  const data = (await response.json()) as {
    segments?: ClipVideoSegment[];
    event?: ClipEventMeta | null;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(data.error ?? "無法讀取這個資料夾");
  }
  return {
    segments: data.segments ?? [],
    directory: null,
    event: data.event ?? null,
  };
}

function clipMediaUrl(root: string, clipName: string, fileName: string): string {
  const params = new URLSearchParams({
    root,
    name: clipName,
    file: fileName,
  });
  return `/api/clip-media?${params.toString()}`;
}

function osmEmbed(lat: number, lon: number): string {
  const bbox = [lon - 0.004, lat - 0.003, lon + 0.004, lat + 0.003].join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${lat}%2C${lon}`;
}

function leadSeconds(videos: Map<CameraId, HTMLVideoElement>): number | null {
  const lead = [...videos.values()].find(
    (video) => video.readyState >= 1 && video.currentTime > 0.5,
  );
  return lead ? lead.currentTime : null;
}

function withStart(url: string, seconds: number | null): string {
  if (seconds == null || seconds < 0.5) return url;
  const base = url.split("#")[0];
  return `${base}#t=${seconds.toFixed(2)}`;
}

function blobIdentity(url: string): string {
  return url.startsWith("blob:") ? url.split("#")[0] : url;
}

function revokeBlobs(urls: string[]) {
  for (const url of urls) URL.revokeObjectURL(blobIdentity(url));
}
