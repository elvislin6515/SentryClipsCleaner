"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Camera,
  Check,
  Download,
  FolderOpen,
  HardDrive,
  LoaderCircle,
  MapPin,
  Play,
  ShieldAlert,
  Trash2,
} from "lucide-react";

import { ClipViewer } from "@/components/clip-viewer";
import { useI18n } from "@/i18n/provider";
import { explain } from "@/i18n/messages";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  applyClusterKeep,
  clipKindLabel,
  clipsFromNamedFolders,
  clusterClips,
  formatBytes,
  formatClipLocation,
  formatClock,
  formatDateTime,
  formatDuration,
  formatGapMinutes,
  locationKey,
  locationStats,
  mapsUrl,
  namesAtLocations,
  parsePastedNames,
  sharedLocationLabel,
  sortClips,
  suggestedDeleteNames,
  summarize,
  withDensity,
  type Clip,
  type ClipKind,
  type ClipLocation,
  type KeepPolicy,
} from "@/lib/clips";
import { createDemoClips } from "@/lib/demo-data";
import {
  buildFolderList,
  buildPowerShellScript,
  buildRunCommand,
  buildScriptFileName,
  DEFAULT_SENTRY_ROOT,
  downloadTextFile,
} from "@/lib/export-script";
import {
  canPickDirectory,
  deleteClipFolders,
  loadLibraryFromDirectory,
  loadLibraryFromFileList,
  pickClipDirectory,
  type DirectoryHandleLike,
} from "@/lib/fs-access";
import { CodedError } from "@/lib/coded-error";
import { readLastLocalPath, writeLastLocalPath } from "@/lib/last-folder";

const KIND_OPTIONS: Array<ClipKind | "all"> = [
  "all",
  "SentryClips",
  "RecentClips",
  "SavedClips",
  "unknown",
];

export function SentryCleaner() {
  const { locale, setLocale, m } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [label, setLabel] = useState("");
  const [isDemo, setIsDemo] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [parents, setParents] = useState<Map<string, DirectoryHandleLike>>(
    new Map(),
  );
  const [scan, setScan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [gapSeconds, setGapSeconds] = useState(180);
  const [minClusterSize, setMinClusterSize] = useState(2);
  const [keepPolicy, setKeepPolicy] = useState<KeepPolicy>("first");
  const [kindFilter, setKindFilter] = useState<ClipKind | "all">("SentryClips");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [scriptOpen, setScriptOpen] = useState(false);
  const [scriptCopied, setScriptCopied] = useState(false);
  const [scriptFileName, setScriptFileName] = useState("clean-sentryclips.ps1");
  const runCommand = buildRunCommand(scriptFileName);
  const [localPath, setLocalPath] = useState(DEFAULT_SENTRY_ROOT);
  const [scriptRoot, setScriptRoot] = useState(DEFAULT_SENTRY_ROOT);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [hasDirectoryPicker, setHasDirectoryPicker] = useState(false);
  const [locationKeys, setLocationKeys] = useState<Set<string>>(new Set());
  const [showAllLocations, setShowAllLocations] = useState(false);
  const [watching, setWatching] = useState<Clip | null>(null);

  useEffect(() => {
    setHasDirectoryPicker(canPickDirectory());
    const remembered = readLastLocalPath(DEFAULT_SENTRY_ROOT);
    setLocalPath(remembered);
    setScriptRoot(remembered);
  }, []);

  const kindsPresent = useMemo(
    () => new Set(clips.map((clip) => clip.kind)),
    [clips],
  );

  const kindClips = useMemo(() => {
    const filtered =
      kindFilter === "all"
        ? clips
        : clips.filter((clip) => clip.kind === kindFilter);
    return sortClips(filtered);
  }, [clips, kindFilter]);

  const placeStats = useMemo(() => locationStats(kindClips), [kindClips]);
  const shownPlaces = showAllLocations ? placeStats : placeStats.slice(0, 8);

  const visibleClips = useMemo(() => {
    if (locationKeys.size === 0) return kindClips;
    return kindClips.filter((clip) =>
      locationKeys.has(locationKey(clip.location)),
    );
  }, [kindClips, locationKeys]);

  const clusters = useMemo(() => {
    return withDensity(
      clusterClips(visibleClips, gapSeconds * 1000),
      minClusterSize,
    );
  }, [visibleClips, gapSeconds, minClusterSize]);

  const denseClusters = clusters.filter((cluster) => cluster.dense);
  const isolatedCount = clusters
    .filter((cluster) => !cluster.dense)
    .reduce((sum, cluster) => sum + cluster.clips.length, 0);
  const stats = summarize(visibleClips, selected);

  function toggleLocation(key: string) {
    setLocationKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectVisibleClips() {
    if (visibleClips.length === 0) return;
    setSelected((current) => {
      const next = new Set(current);
      for (const clip of visibleClips) next.add(clip.name);
      return next;
    });
  }

  function clearSelectedClips() {
    setSelected(new Set());
  }

  function selectFilteredLocations() {
    const names = namesAtLocations(kindClips, locationKeys);
    if (names.length === 0) return;
    setSelected((current) => {
      const next = new Set(current);
      for (const name of names) next.add(name);
      return next;
    });
    setNotice(m.placesChecked(names.length));
  }

  function applySuggestion(nextClips = visibleClips) {
    const nextClusters = withDensity(
      clusterClips(nextClips, gapSeconds * 1000),
      minClusterSize,
    );
    setSelected(
      suggestedDeleteNames(
        nextClusters,
        keepPolicy,
        minClusterSize,
        gapSeconds * 1000,
      ),
    );
  }

  function replaceLibrary(
    nextClips: Clip[],
    nextLabel: string,
    options: {
      demo?: boolean;
      canDelete?: boolean;
      parents?: Map<string, DirectoryHandleLike>;
    } = {},
  ) {
    const kinds = new Set(nextClips.map((clip) => clip.kind));
    const nextFilter = kinds.has("SentryClips")
      ? "SentryClips"
      : kinds.size === 1
        ? [...kinds][0]
        : "all";
    const filtered =
      nextFilter === "all"
        ? nextClips
        : nextClips.filter((clip) => clip.kind === nextFilter);

    setClips(nextClips);
    setLabel(nextLabel);
    setIsDemo(Boolean(options.demo));
    setCanDelete(Boolean(options.canDelete));
    setParents(options.parents ?? new Map());
    setKindFilter(nextFilter);
    setLocationKeys(new Set());
    setShowAllLocations(false);
    setError(null);
    setNotice(null);
    setSelected(
      suggestedDeleteNames(
        withDensity(
          clusterClips(filtered, gapSeconds * 1000),
          minClusterSize,
        ),
        keepPolicy,
        minClusterSize,
        gapSeconds * 1000,
      ),
    );
  }

  async function handlePickDirectory() {
    setError(null);
    setNotice(null);
    try {
      setScan(m.openingPicker);
      const directory = await pickClipDirectory();
      setScan(m.scanningName(directory.name));
      const library = await loadLibraryFromDirectory(directory, (progress) => {
        setScan(m.readingFolder(progress.current, progress.total));
      });
      if (library.clips.length === 0) {
        setError(m.noTimestamp(library.label));
        setClips([]);
        setLabel("");
        return;
      }
      let nextClips = library.clips;
      setScan(m.matchingPath);
      const sampleNames = nextClips.map((clip) => clip.name);
      const clipRoot = await resolvePickedClipRoot(
        directory.name,
        sampleNames,
        localPath,
      );
      if (clipRoot) {
        setLocalPath(clipRoot);
        setScriptRoot(clipRoot);
        writeLastLocalPath(clipRoot);
      } else {
        rememberPickedFolder(directory.name, localPath);
      }

      const missingSizes = nextClips.some((clip) => clip.size <= 0);
      const sizePath = clipRoot ?? pathIfFolderMatches(localPath, directory.name);
      if (missingSizes && sizePath) {
        setScan(m.fillingSizes);
        const sized = await fetchLocalScan(sizePath);
        if (sized?.folders.length) {
          nextClips = mergeFolderSizes(nextClips, sized.folders);
        }
      }
      replaceLibrary(nextClips, library.label, {
        canDelete: library.canDelete,
        parents: library.parents,
      });
      if (
        library.clips.length === 1 &&
        library.clips[0].name === library.label
      ) {
        setNotice(m.singleEvent);
      } else {
        const total = nextClips.reduce((sum, clip) => sum + clip.size, 0);
        const located = nextClips.filter((clip) => clip.location).length;
        const pathNote = clipRoot ? m.pathUpdated(clipRoot) : m.pathMissing;
        const locationNote = located > 0 ? m.locatedCount(located) : "";
        setNotice(
          total > 0
            ? m.readWithSize(nextClips.length, formatBytes(total, locale), locationNote, pathNote)
            : m.readNamesOnly(nextClips.length, locationNote, pathNote),
        );
      }
    } catch (err) {
      if (isAbort(err)) return;
      setError(explain(err, m, m.errors.read_folder));
    } finally {
      setScan(null);
    }
  }

  function handleBrowseFallback() {
    fileInputRef.current?.click();
  }

  function handleFileList(files: FileList | null) {
    if (!files || files.length === 0) return;
    const library = loadLibraryFromFileList(Array.from(files));
    if (library.clips.length === 0) {
      setError(m.browseNoTimestamp);
      return;
    }
    replaceLibrary(library.clips, library.label, { canDelete: false });
    setNotice(m.browseAnalyzeOnly);
  }

  function handleDemo() {
    replaceLibrary(createDemoClips(), m.demoLabel, { demo: true });
    setNotice(m.demoNotice);
  }

  async function handleLocalScan() {
    setError(null);
    setNotice(null);
    setScan(m.scanningLocal);
    try {
      const data = await fetchLocalScan(localPath);
      if (!data) {
        throw new Error("scan_failed");
      }
      const next = clipsFromNamedFolders(data.folders);
      if (next.length === 0) {
        setError(m.noTimestamp(data.label ?? localPath));
        setClips([]);
        setLabel("");
        return;
      }
      replaceLibrary(next, data.label ?? localPath, { canDelete: false });
      const clipRoot = (data.clipRoot || data.root || "").replace(/[\\/]+$/, "");
      if (clipRoot) {
        setLocalPath(clipRoot);
        setScriptRoot(clipRoot);
        writeLastLocalPath(clipRoot);
      } else {
        writeLastLocalPath(localPath);
      }
      const total = next.reduce((sum, clip) => sum + clip.size, 0);
      const located = next.filter((clip) => clip.location).length;
      const locationNote =
        located > 0 ? m.locatedCount(located) : m.noLocationFiles;
      const pathNote = clipRoot ? m.pathUpdated(clipRoot) : "";
      setNotice(
        total > 0
          ? m.localWithSize(next.length, formatBytes(total, locale), locationNote, pathNote)
          : m.localNamesOnly(next.length, locationNote, pathNote),
      );
    } catch (err) {
      setError(explain(err, m, m.errors.scan_local));
    } finally {
      setScan(null);
    }
  }

  async function openScriptDialog() {
    setScriptFileName(buildScriptFileName());
    const samples = clips.map((clip) => clip.name);
    if (samples.length > 0) {
      const clipRoot = await resolvePickedClipRoot(
        "SentryClips",
        samples,
        localPath,
      );
      if (clipRoot) {
        setLocalPath(clipRoot);
        setScriptRoot(clipRoot);
        writeLastLocalPath(clipRoot);
      }
    }
    setScriptOpen(true);
  }

  async function copyCommand(command: string) {
    try {
      await navigator.clipboard.writeText(command);
      setScriptCopied(true);
    } catch {
      setScriptCopied(false);
      setNotice(m.clipboardFailed);
    }
  }

  async function copyRunCommand() {
    await copyCommand(runCommand);
  }

  function downloadDeleteScript() {
    downloadTextFile(
      scriptFileName,
      buildPowerShellScript(selectedNames, scriptRoot, locale),
    );
    void copyCommand(runCommand);
  }

  function handlePaste() {
    const next = parsePastedNames(pasteText);
    if (next.length === 0) {
      setError(m.pasteEmpty);
      return;
    }
    replaceLibrary(next, m.pastedLabel(next.length), {
      canDelete: false,
    });
    setPasteOpen(false);
    setNotice(m.pastedNotice);
  }

  function toggleName(name: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(name);
      else next.delete(name);
      return next;
    });
  }

  function keepCluster(names: string[], mode: "all" | "first") {
    setSelected((current) => applyClusterKeep(current, names, mode));
  }

  async function confirmDelete() {
    const names = [...selected];
    if (names.length === 0) return;
    setDeleting(true);
    setError(null);
    try {
      if (isDemo || !canDelete) {
        setClips((current) => current.filter((clip) => !selected.has(clip.name)));
        setSelected(new Set());
        setDeleteOpen(false);
        setNotice(
          isDemo
            ? m.demoRemoved(names.length)
            : m.useScript,
        );
        return;
      }
      const result = await deleteClipFolders(names, parents);
      if (result.deleted.length > 0) {
        const gone = new Set(result.deleted);
        setClips((current) => current.filter((clip) => !gone.has(clip.name)));
        setSelected(new Set(result.failed.map((item) => item.name)));
      }
      setDeleteOpen(false);
      if (result.failed.length > 0) {
        setError(
          m.deletePartial(
            result.deleted.length,
            result.failed.length,
            result.failed
              .slice(0, 3)
              .map((item) => `${item.name} (${explain(item.error, m, item.error)})`)
              .join(", "),
          ),
        );
      } else {
        setNotice(m.deletedDisk(result.deleted.length));
      }
    } finally {
      setDeleting(false);
    }
  }

  const selectedNames = visibleClips
    .filter((clip) => selected.has(clip.name))
    .map((clip) => clip.name);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sentry">
            <Camera className="size-5" />
            <p className="text-xs font-medium tracking-[0.18em] uppercase">
              {m.brand}
            </p>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {m.title}
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            {m.intro}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-border p-0.5" role="group" aria-label={m.lang.label}>
            <Button
              size="sm"
              variant={locale === "en" ? "secondary" : "ghost"}
              onClick={() => setLocale("en")}
            >
              {m.lang.en}
            </Button>
            <Button
              size="sm"
              variant={locale === "zh-Hant" ? "secondary" : "ghost"}
              onClick={() => setLocale("zh-Hant")}
            >
              {m.lang.zh}
            </Button>
          </div>
          {label ? (
            <Badge variant="secondary" className="w-fit max-w-full truncate">
              {label}
            </Badge>
          ) : null}
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{m.readTitle}</CardTitle>
          <CardDescription>
            {m.readBodyBefore}
            <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-foreground">
              TeslaCam\SentryClips
            </code>
            {m.readBodyMid}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button
              size="lg"
              onClick={
                hasDirectoryPicker ? handlePickDirectory : handleBrowseFallback
              }
              disabled={Boolean(scan)}
            >
              {scan ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <FolderOpen />
              )}
              {scan ?? m.pickFolder}
            </Button>
            {hasDirectoryPicker ? (
              <Button
                size="lg"
                variant="outline"
                onClick={handleBrowseFallback}
                disabled={Boolean(scan)}
              >
                {m.browseFallback}
              </Button>
            ) : null}
            <Button
              size="lg"
              variant="outline"
              onClick={() => setPasteOpen(true)}
              disabled={Boolean(scan)}
            >
              {m.pasteNames}
            </Button>
            <Button
              size="lg"
              variant="secondary"
              onClick={handleLocalScan}
              disabled={Boolean(scan)}
            >
              {scan ? <LoaderCircle className="animate-spin" /> : <HardDrive />}
              {m.scanLocal}
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={handleDemo}
              disabled={Boolean(scan)}
            >
              {m.tryDemo}
            </Button>
          </div>
          <div className="space-y-2">
            <Label htmlFor="local-path">{m.localPath}</Label>
            <Input
              id="local-path"
              value={localPath}
              placeholder={m.pathPlaceholder}
              onChange={(event) => setLocalPath(event.target.value)}
              onBlur={() => writeLastLocalPath(localPath)}
              className="font-mono text-xs"
              disabled={Boolean(scan)}
            />
          </div>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            multiple
            onChange={(event) => {
              handleFileList(event.target.files);
              event.target.value = "";
            }}
            {...{ webkitdirectory: "", directory: "" }}
          />
          <p className="text-xs leading-5 text-muted-foreground">
            {m.privacy}
          </p>
        </CardContent>
      </Card>

      {error ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>{m.problemTitle}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {notice ? (
        <Alert>
          <Check />
          <AlertTitle>{m.statusTitle}</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      {visibleClips.length === 0 && !scan ? (
        <EmptyState onDemo={handleDemo} />
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label={m.visibleEvents}
              value={String(stats.total)}
              hint={
                locationKeys.size > 0
                  ? m.filteredPlaces(locationKeys.size)
                  : stats.knownBytes
                    ? m.totalSize(formatBytes(stats.totalBytes, locale))
                    : m.filteredBySource
              }
            />
            <StatCard
              label={m.denseGroups}
              value={String(denseClusters.length)}
              hint={m.gapAtMost(formatGapMinutes(gapSeconds, locale))}
              tone="warn"
            />
            <StatCard
              label={m.suggestedDelete}
              value={String(stats.selectedCount)}
              hint={
                stats.knownBytes
                  ? m.canFree(formatBytes(stats.selectedBytes, locale))
                  : m.sizeUnread
              }
              tone="danger"
            />
            <StatCard
              label={m.isolated}
              value={String(isolatedCount)}
              hint={m.isolatedHint}
            />
          </section>

          <Card>
            <CardHeader>
              <CardTitle>{m.rulesTitle}</CardTitle>
              <CardDescription>{m.rulesBody}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 lg:grid-cols-2">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="gap">{m.gapLabel}</Label>
                  <span className="font-mono text-sm">
                    {formatGapMinutes(gapSeconds, locale)}
                  </span>
                </div>
                <Slider
                  id="gap"
                  min={30}
                  max={900}
                  step={30}
                  value={[gapSeconds]}
                  onValueChange={(value) => {
                    const next = Array.isArray(value) ? value[0] : value;
                    setGapSeconds(Number(next ?? 180));
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  {m.gapHint}
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={m.minCount}>
                  <Select
                    value={String(minClusterSize)}
                    onValueChange={(value) =>
                      setMinClusterSize(Number(value ?? 2))
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[2, 3, 4, 5].map((value) => (
                        <SelectItem key={value} value={String(value)}>
                          {m.minCountValue(value)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={m.keepLabel}>
                  <Select
                    value={keepPolicy}
                    onValueChange={(value) =>
                      setKeepPolicy((value as KeepPolicy | null) ?? "first")
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="first">{m.keepFirst}</SelectItem>
                      <SelectItem value="last">{m.keepLast}</SelectItem>
                      <SelectItem value="middle">{m.keepMiddle}</SelectItem>
                      <SelectItem value="spaced">
                        {m.keepEvery(formatGapMinutes(gapSeconds, locale))}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {kindsPresent.size > 1 ? (
                  <Field label={m.sourceLabel}>
                    <Select
                      value={kindFilter}
                      onValueChange={(value) =>
                        setKindFilter((value as ClipKind | "all" | null) ?? "all")
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {KIND_OPTIONS.filter(
                          (kind) => kind === "all" || kindsPresent.has(kind),
                        ).map((kind) => (
                          <SelectItem key={kind} value={kind}>
                            {kind === "all" ? m.allSources : clipKindLabel(kind, locale)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                ) : null}
                <div className="flex items-end">
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => applySuggestion()}
                  >
                    {m.reapply}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {placeStats.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>{m.placesTitle}</CardTitle>
                <CardDescription>{m.placesBody}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {shownPlaces.map((place) => {
                    const active = locationKeys.has(place.key);
                    return (
                      <Button
                        key={place.key}
                        size="sm"
                        variant={active ? "default" : "outline"}
                        title={m.placeCount(
                          place.count,
                          place.bytes > 0 ? formatBytes(place.bytes, locale) : "",
                        )}
                        onClick={() => toggleLocation(place.key)}
                      >
                        <MapPin />
                        {place.label}
                        <span className="font-mono text-[11px] opacity-80">
                          {place.count}
                          {place.bytes > 0 ? ` · ${formatBytes(place.bytes, locale)}` : ""}
                        </span>
                      </Button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={visibleClips.length === 0}
                    onClick={selectVisibleClips}
                  >
                    {m.selectAllPlaces}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={selected.size === 0}
                    onClick={clearSelectedClips}
                  >
                    {m.clearPlaces}
                  </Button>
                  {locationKeys.size > 0 ? (
                    <>
                      <Button
                        variant="outline"
                        onClick={selectFilteredLocations}
                      >
                        {m.checkThesePlaces}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => setLocationKeys(new Set())}
                      >
                        {m.clearPlaceFilter}
                      </Button>
                    </>
                  ) : null}
                  {placeStats.length > 8 ? (
                    <Button
                      variant="ghost"
                      onClick={() => setShowAllLocations((value) => !value)}
                    >
                      {showAllLocations
                        ? m.topPlacesOnly
                        : m.showAllPlaces(placeStats.length)}
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {kindFilter === "SavedClips" ? (
            <Alert variant="destructive">
              <ShieldAlert />
              <AlertTitle>{m.savedTitle}</AlertTitle>
              <AlertDescription>{m.savedBody}</AlertDescription>
            </Alert>
          ) : null}

          <Timeline clips={visibleClips} selected={selected} gapSeconds={gapSeconds} />

          <Tabs defaultValue="clusters">
            <TabsList className="w-full sm:w-auto">
              <TabsTrigger value="clusters">
                {m.tabDense(denseClusters.length)}
              </TabsTrigger>
              <TabsTrigger value="all">{m.tabAll(visibleClips.length)}</TabsTrigger>
              <TabsTrigger value="selected">
                {m.tabDelete(stats.selectedCount)}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="clusters" className="space-y-3 pt-3 pb-28">
              {denseClusters.length === 0 ? (
                <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
                  {m.noDense}
                </p>
              ) : (
                denseClusters.map((cluster, index) => (
                  <ClusterCard
                    key={cluster.id}
                    index={index + 1}
                    names={cluster.clips.map((clip) => clip.name)}
                    clips={cluster.clips}
                    selected={selected}
                    spanLabel={formatDuration(cluster.spanMs, locale)}
                    onToggle={toggleName}
                    onToggleCluster={keepCluster}
                    onWatch={setWatching}
                    thumbRoot={isDemo ? "" : localPath}
                  />
                ))
              )}
            </TabsContent>
            <TabsContent value="all" className="pt-3 pb-28">
              <ClipTable
                clips={visibleClips}
                selected={selected}
                onToggle={toggleName}
                onWatch={setWatching}
                thumbRoot={isDemo ? "" : localPath}
              />
            </TabsContent>
            <TabsContent value="selected" className="pt-3 pb-28">
              {stats.selectedCount === 0 ? (
                <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
                  {m.noneChecked}
                </p>
              ) : (
                <ClipTable
                  clips={visibleClips.filter((clip) => selected.has(clip.name))}
                  selected={selected}
                  onToggle={toggleName}
                  onWatch={setWatching}
                  thumbRoot={isDemo ? "" : localPath}
                />
              )}
            </TabsContent>
          </Tabs>

          <div className="pointer-events-none sticky bottom-3 z-20 flex flex-col gap-2 rounded-2xl border bg-background p-3 shadow-lg sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {m.checkedLead}{" "}
              <span className="text-foreground">{stats.selectedCount}</span>{" "}
              {m.checkedMid}
              {stats.knownBytes
                ? m.checkedSize(formatBytes(stats.selectedBytes, locale))
                : ""}
              {m.checkedTail}
            </p>
            <div className="pointer-events-auto flex flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                disabled={visibleClips.length === 0}
                onClick={selectVisibleClips}
              >
                {m.selectVisible}
              </Button>
              <Button
                variant="ghost"
                disabled={selected.size === 0}
                onClick={clearSelectedClips}
              >
                {m.clearChecks}
              </Button>
              <Button
                variant="outline"
                disabled={stats.selectedCount === 0}
                onClick={() => void openScriptDialog()}
              >
                <Download />
                {m.downloadScript}
              </Button>
              <Button
                variant="destructive"
                disabled={stats.selectedCount === 0}
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 />
                {isDemo ? m.removeDemo : canDelete ? m.deleteChecked : m.cannotDelete}
              </Button>
            </div>
          </div>
        </>
      )}

      <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{m.pasteTitle}</DialogTitle>
            <DialogDescription>
              {m.pasteBodyBefore}
              <code className="mx-1">dir</code>
              {m.pasteBodyAfter}
              <code className="mx-1">2026-08-20_22-14-02</code>
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
            placeholder={"2026-08-20_22-14-02\n2026-08-20_22-14-41"}
            className="min-h-40 font-mono text-xs"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasteOpen(false)}>
              {m.cancel}
            </Button>
            <Button onClick={handlePaste}>{m.analyze}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={scriptOpen}
        onOpenChange={(open) => {
          setScriptOpen(open);
          if (!open) setScriptCopied(false);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{m.scriptTitle}</DialogTitle>
            <DialogDescription>{m.scriptBody}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="root">{m.scriptPath}</Label>
            <Input
              id="root"
              value={scriptRoot}
              onChange={(event) => setScriptRoot(event.target.value)}
              className="font-mono text-xs"
            />
          </div>
          <p className="max-h-32 overflow-auto rounded-lg bg-muted p-2 font-mono text-xs">
            {selectedNames.slice(0, 12).join("\n") || m.noneCheckedList}
            {selectedNames.length > 12 ? m.moreNames(selectedNames.length - 12) : ""}
          </p>
          <div className="space-y-2 rounded-lg border p-3 text-sm">
            <p className="font-medium">{m.afterDownload}</p>
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>{m.stepDownload}</li>
              <li>{m.stepOpen}</li>
              <li>{m.stepPaste}</li>
            </ol>
            <p className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs">
              {runCommand}
            </p>
            <p className="text-xs text-muted-foreground">
              {m.scriptFileNote(scriptFileName)}
            </p>
            {scriptCopied ? (
              <p className="text-xs text-foreground">{m.copied}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => copyRunCommand()}
            >
              {m.copyAgain}
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                downloadTextFile(
                  "sentryclips-delete-list.txt",
                  buildFolderList(selectedNames),
                )
              }
            >
              {m.downloadList}
            </Button>
            <Button onClick={() => downloadDeleteScript()}>
              {m.downloadPs1}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {isDemo ? m.confirmDemo : m.confirmReal}
            </DialogTitle>
            <DialogDescription>
              {isDemo
                ? m.confirmDemoBody
                : canDelete
                  ? m.confirmRealBody
                  : m.confirmBlocked}
            </DialogDescription>
          </DialogHeader>
          <p className="max-h-40 overflow-auto rounded-lg bg-muted p-2 font-mono text-xs">
            {selectedNames.join("\n")}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              {m.notYet}
            </Button>
            <Button
              variant="destructive"
              disabled={deleting || (!canDelete && !isDemo)}
              onClick={confirmDelete}
            >
              {deleting ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
              {isDemo ? m.removeDemoItems : m.deleteCount(selectedNames.length)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ClipViewer
        clip={watching}
        root={localPath}
        folder={watching ? (parents.get(watching.name) ?? null) : null}
        demo={isDemo}
        onClose={() => setWatching(null)}
      />
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "warn" | "danger";
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle
          className={
            tone === "danger"
              ? "text-2xl text-sentry"
              : tone === "warn"
                ? "text-2xl text-amber-500"
                : "text-2xl"
          }
        >
          {value}
        </CardTitle>
        <CardDescription>{hint}</CardDescription>
      </CardHeader>
    </Card>
  );
}

function EmptyState({ onDemo }: { onDemo: () => void }) {
  const { m } = useI18n();
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-3 px-6 py-14 text-center">
        <FolderOpen className="size-8 text-muted-foreground" />
        <div className="space-y-1">
          <p className="font-medium">{m.emptyTitle}</p>
          <p className="max-w-md text-sm text-muted-foreground">{m.emptyBody}</p>
        </div>
        <Button variant="secondary" onClick={onDemo}>
          {m.loadDemo}
        </Button>
      </CardContent>
    </Card>
  );
}

function Timeline({
  clips,
  selected,
  gapSeconds,
}: {
  clips: Clip[];
  selected: Set<string>;
  gapSeconds: number;
}) {
  const { locale, m } = useI18n();
  if (clips.length === 0) return null;
  const start = clips[0].timestamp.getTime();
  const end = clips[clips.length - 1].timestamp.getTime();
  const span = Math.max(end - start, 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{m.timelineTitle}</CardTitle>
        <CardDescription>{m.timelineBody}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="relative h-12 overflow-hidden rounded-lg bg-muted">
          {clips.map((clip, index) => {
            const left = ((clip.timestamp.getTime() - start) / span) * 100;
            const prev = clips[index - 1];
            const tight =
              prev &&
              clip.timestamp.getTime() - prev.timestamp.getTime() <=
                gapSeconds * 1000;
            return (
              <span
                key={clip.id}
                title={`${clip.name} · ${formatDateTime(clip.timestamp, locale)}${
                  formatClipLocation(clip.location)
                    ? ` · ${formatClipLocation(clip.location)}`
                    : ""
                }`}
                className={`absolute top-3 size-2 -translate-x-1/2 rounded-full ${
                  selected.has(clip.name)
                    ? "bg-sentry"
                    : tight
                      ? "bg-amber-400"
                      : "bg-foreground/40"
                }`}
                style={{ left: `${left}%` }}
              />
            );
          })}
        </div>
        <div className="mt-2 flex justify-between font-mono text-[11px] text-muted-foreground">
          <span>{formatDateTime(clips[0].timestamp, locale)}</span>
          <span>{formatDateTime(clips[clips.length - 1].timestamp, locale)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function ClusterCard({
  index,
  names,
  clips,
  selected,
  spanLabel,
  onToggle,
  onToggleCluster,
  onWatch,
  thumbRoot,
}: {
  index: number;
  names: string[];
  clips: Clip[];
  selected: Set<string>;
  spanLabel: string;
  onToggle: (name: string, checked: boolean) => void;
  onToggleCluster: (names: string[], mode: "all" | "first") => void;
  onWatch: (clip: Clip) => void;
  thumbRoot: string;
}) {
  const { locale, m } = useI18n();
  const selectedInCluster = names.filter((name) => selected.has(name)).length;
  const bytes = clips.reduce((sum, clip) => sum + clip.size, 0);
  const keepCount = names.length - selectedInCluster;

  return (
    <Card className="overflow-visible border-l-4 border-l-sentry">
      <CardHeader className="sticky top-0 z-30 border-b bg-card">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>{m.groupMeta(index, clips.length, spanLabel)}</CardTitle>
            <CardDescription>
              {m.groupRange(
                formatDateTime(clips[0].timestamp, locale),
                formatClock(clips[clips.length - 1].timestamp, locale),
              )}
              {sharedLocationLabel(clips, locale)
                ? ` · ${sharedLocationLabel(clips, locale)}`
                : ""}
              {bytes > 0 ? m.groupSize(formatBytes(bytes, locale)) : ""}
            </CardDescription>
          </div>
          <div className="relative z-30 flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onToggleCluster(names, "all")}
            >
              {m.keepAll}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onToggleCluster(names, "first")}
            >
              {m.keepOnlyFirst}
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {m.willDeleteCount(selectedInCluster, keepCount)}
        </p>
      </CardHeader>
      <CardContent className="pt-3">
        <ClipRows
          clips={clips}
          selected={selected}
          onToggle={onToggle}
          onWatch={onWatch}
          thumbRoot={thumbRoot}
        />
      </CardContent>
    </Card>
  );
}

function ClipTable({
  clips,
  selected,
  onToggle,
  onWatch,
  thumbRoot,
}: {
  clips: Clip[];
  selected: Set<string>;
  onToggle: (name: string, checked: boolean) => void;
  onWatch: (clip: Clip) => void;
  thumbRoot: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <ClipRows
          clips={clips}
          selected={selected}
          onToggle={onToggle}
          onWatch={onWatch}
          thumbRoot={thumbRoot}
        />
      </CardContent>
    </Card>
  );
}

function ClipRows({
  clips,
  selected,
  onToggle,
  onWatch,
  thumbRoot,
}: {
  clips: Clip[];
  selected: Set<string>;
  onToggle: (name: string, checked: boolean) => void;
  onWatch: (clip: Clip) => void;
  thumbRoot: string;
}) {
  const { locale, m } = useI18n();
  return (
    <ul className="divide-y">
      {clips.map((clip, index) => {
        const prev = clips[index - 1];
        const gap = prev
          ? clip.timestamp.getTime() - prev.timestamp.getTime()
          : null;
        const checked = selected.has(clip.name);
        return (
          <li
            key={clip.id}
            className="flex flex-col gap-2 py-3"
          >
            {thumbRoot && clip.hasThumb ? (
              <ClipThumb root={thumbRoot} name={clip.name} />
            ) : null}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex min-w-0 items-start gap-3">
              <Checkbox
                checked={checked}
                onCheckedChange={(value) => onToggle(clip.name, value === true)}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block font-mono text-sm">{clip.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {formatDateTime(clip.timestamp, locale)}
                  {gap !== null
                    ? m.gapFromPrevious(formatDuration(gap, locale))
                    : m.groupStart}
                </span>
                <ClipLocationLine location={clip.location} />
              </span>
            </label>
            <div className="flex items-center gap-2 pl-7 sm:pl-0">
              {clip.kind !== "SentryClips" ? (
                <Badge variant="outline">{clipKindLabel(clip.kind, locale)}</Badge>
              ) : null}
              <Button size="sm" variant="outline" onClick={() => onWatch(clip)}>
                <Play />
                {m.watch}
              </Button>
              <Badge variant={checked ? "destructive" : "secondary"}>
                {checked ? m.willDelete : m.keep}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {clip.fileCount > 0
                  ? m.fileSummary(clip.fileCount, formatBytes(clip.size, locale))
                  : formatBytes(clip.size, locale)}
              </span>
            </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ClipThumb({ root, name }: { root: string; name: string }) {
  const { m } = useI18n();
  const [failed, setFailed] = useState(false);
  if (!root || failed) return null;
  const params = new URLSearchParams({ root, name });
  return (
    <img
      alt={m.thumbAlt}
      src={`/api/clip-thumb?${params.toString()}`}
      className="h-48 w-auto max-w-full self-start rounded-lg"
      onError={() => setFailed(true)}
    />
  );
}

function ClipLocationLine({ location }: { location?: ClipLocation }) {
  const { m } = useI18n();
  const label = formatClipLocation(location);
  const href = mapsUrl(location);
  if (!label && !href) return null;
  return (
    <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
      <MapPin className="size-3 shrink-0" />
      <span>{label || m.hasCoordinates}</span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2 hover:text-foreground"
          onClick={(event) => event.stopPropagation()}
        >
          {m.map}
        </a>
      ) : null}
    </span>
  );
}

type ScannedFolderPayload = {
  name: string;
  kind: ClipKind;
  size?: number;
  fileCount?: number;
  location?: ClipLocation;
  hasThumb?: boolean;
};

async function fetchLocalScan(path: string): Promise<{
  folders: ScannedFolderPayload[];
  label?: string;
  root?: string;
  clipRoot?: string;
} | null> {
  const response = await fetch("/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  const data = (await response.json()) as {
    folders?: ScannedFolderPayload[];
    label?: string;
    root?: string;
    clipRoot?: string;
    error?: string;
    detail?: string;
  };
  if (!response.ok) {
    throw new CodedError(data.error ?? "scan_failed", data.detail ?? "");
  }
  return {
    folders: data.folders ?? [],
    label: data.label,
    root: data.root,
    clipRoot: data.clipRoot,
  };
}

function mergeFolderSizes(clips: Clip[], folders: ScannedFolderPayload[]): Clip[] {
  const sizes = new Map(folders.map((folder) => [folder.name, folder]));
  return clips.map((clip) => {
    const hit = sizes.get(clip.name);
    if (!hit) return clip;
    return {
      ...clip,
      size: hit.size ?? clip.size,
      fileCount: hit.fileCount ?? clip.fileCount,
      location: hit.location ?? clip.location,
      hasThumb: hit.hasThumb ?? clip.hasThumb,
    };
  });
}

function pathIfFolderMatches(currentPath: string, folderName: string): string | null {
  const trimmed = currentPath.replace(/[\\/]+$/, "");
  const base = trimmed.split(/[\\/]/).pop() ?? "";
  return base.toLowerCase() === folderName.toLowerCase() ? trimmed : null;
}

function rememberPickedFolder(folderName: string, currentPath: string) {
  const matched = pathIfFolderMatches(currentPath, folderName);
  if (matched) writeLastLocalPath(matched);
}

async function resolvePickedClipRoot(
  folderName: string,
  sampleNames: string[],
  hintPath: string,
): Promise<string | null> {
  try {
    const response = await fetch("/api/resolve-path", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folderName,
        sampleNames: sampleNames.slice(0, 8),
        hintPath,
      }),
    });
    const data = (await response.json()) as {
      path?: string | null;
      clipRoot?: string | null;
    };
    return data.clipRoot ?? data.path ?? null;
  } catch {
    return null;
  }
}

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}
