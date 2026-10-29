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
import { createDemoClips, DEMO_FOLDER_LABEL } from "@/lib/demo-data";
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
import { readLastLocalPath, writeLastLocalPath } from "@/lib/last-folder";

const KIND_OPTIONS: Array<ClipKind | "all"> = [
  "all",
  "SentryClips",
  "RecentClips",
  "SavedClips",
  "unknown",
];

export function SentryCleaner() {
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
    setNotice(
      `已把 ${names.length} 筆指定地點的哨兵加入勾選。孤立事件也會被勾，確認後再刪。`,
    );
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
      setScan("正在開啟資料夾選擇器…");
      const directory = await pickClipDirectory();
      setScan(`正在掃描 ${directory.name}…`);
      const library = await loadLibraryFromDirectory(directory, (progress) => {
        setScan(`正在讀取資料夾 ${progress.current} / ${progress.total}`);
      });
      if (library.clips.length === 0) {
        setError(
          `在「${library.label}」裡找不到 Tesla 時間戳資料夾（例如 2026-08-20_22-14-02）。請選 SentryClips，或上一層的 TeslausbCamModelX。`,
        );
        setClips([]);
        setLabel("");
        return;
      }
      let nextClips = library.clips;
      setScan("正在對應本機路徑…");
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
        setScan("正在用本機路徑補算大小…");
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
        setNotice(
          "你選到的是單一事件資料夾。若要分析整批哨兵，請改選上一層的 SentryClips。",
        );
      } else {
        const total = nextClips.reduce((sum, clip) => sum + clip.size, 0);
        const located = nextClips.filter((clip) => clip.location).length;
        const pathNote = clipRoot
          ? `刪除腳本路徑已改成 ${clipRoot}。`
          : "沒有對到本機路徑，刪除腳本可能會指到舊資料夾。請改按「掃描本機路徑」。";
        const locationNote =
          located > 0 ? `其中 ${located} 筆有路名或座標。` : "";
        setNotice(
          total > 0
            ? `已讀取 ${nextClips.length} 個資料夾，合計 ${formatBytes(total)}。${locationNote}${pathNote}`
            : `已讀取 ${nextClips.length} 個資料夾名稱。${locationNote}${pathNote || "若要看大小，請改用「掃描本機路徑」。"}`,
        );
      }
    } catch (err) {
      if (isAbort(err)) return;
      setError(err instanceof Error ? err.message : "無法讀取資料夾");
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
      setError(
        "選到的內容裡沒有 Tesla 時間戳資料夾。請直接選 SentryClips，或含有 2026-08-20_22-14-02 這種名稱的資料夾。",
      );
      return;
    }
    replaceLibrary(library.clips, library.label, { canDelete: false });
    setNotice(
      "這個選法只能分析，不能直接刪除。確認清單後，請下載 PowerShell 腳本在電腦上清理。",
    );
  }

  function handleDemo() {
    replaceLibrary(createDemoClips(), DEMO_FOLDER_LABEL, { demo: true });
    setNotice(
      "這是一週的示範哨兵紀錄：夜間行人、凌晨樹影、賣場停車都有連續觸發。正式清理請改選你的 SentryClips。",
    );
  }

  async function handleLocalScan() {
    setError(null);
    setNotice(null);
    setScan("正在掃描本機資料夾並計算大小…");
    try {
      const data = await fetchLocalScan(localPath);
      if (!data) {
        throw new Error("無法掃描這個路徑");
      }
      const next = clipsFromNamedFolders(data.folders);
      if (next.length === 0) {
        setError(
          `在「${data.label ?? localPath}」裡找不到 Tesla 時間戳資料夾。請填 SentryClips，或上一層的 TeslausbCamModelX。`,
        );
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
        located > 0 ? `其中 ${located} 筆有路名或座標。` : "這些資料夾沒有 event.json，所以沒有位置。";
      const pathNote = clipRoot ? `刪除腳本路徑已改成 ${clipRoot}。` : "";
      setNotice(
        total > 0
          ? `已從本機路徑讀取 ${next.length} 個資料夾，合計 ${formatBytes(total)}。${locationNote}${pathNote}沒有下載任何影片。`
          : `已從本機路徑讀取 ${next.length} 個資料夾名稱。${locationNote}${pathNote}確認清單後請下載 PowerShell 腳本刪除。`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "無法掃描本機路徑");
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
      setNotice("無法寫入剪貼簿，請手動複製對話框裡的命令。");
    }
  }

  async function copyRunCommand() {
    await copyCommand(runCommand);
  }

  function downloadDeleteScript() {
    downloadTextFile(
      scriptFileName,
      buildPowerShellScript(selectedNames, scriptRoot),
    );
    void copyCommand(runCommand);
  }

  function handlePaste() {
    const next = parsePastedNames(pasteText);
    if (next.length === 0) {
      setError("貼上的文字裡找不到時間戳資料夾名稱。");
      return;
    }
    replaceLibrary(next, `貼上的 ${next.length} 個資料夾名稱`, {
      canDelete: false,
    });
    setPasteOpen(false);
    setNotice("已從名稱清單分析。這種方式沒有檔案大小，也無法直接刪除。");
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
            ? `示範模式已從清單拿掉 ${names.length} 個資料夾，實際硬碟沒有更動。`
            : "這個來源不能直接刪除。請改下載 PowerShell 腳本。",
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
          `已刪 ${result.deleted.length} 個，但有 ${result.failed.length} 個失敗：${result.failed
            .slice(0, 3)
            .map((item) => `${item.name}（${item.error}）`)
            .join("、")}`,
        );
      } else {
        setNotice(`已從磁碟刪除 ${result.deleted.length} 個資料夾。`);
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
              Tesla USB · Model X
            </p>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            SentryClips 密集事件清理
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            哨兵模式常被行人、樹影或風連續觸發。選取
            <span className="text-foreground"> SentryClips </span>
            後，工具會依資料夾名稱的時間戳找出間隔太近的事件，讓你留下代表片段、清掉太密的那些。
          </p>
        </div>
        {label ? (
          <Badge variant="secondary" className="w-fit max-w-full truncate">
            {label}
          </Badge>
        ) : null}
      </header>

      <Card>
        <CardHeader>
          <CardTitle>讀取資料夾</CardTitle>
          <CardDescription>
            分析只讀資料夾名稱，不會下載 OneDrive 裡的影片。請選
            <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-foreground">
              TeslausbCamModelX\SentryClips
            </code>
            ，或直接掃描下面的本機路徑。
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
              {scan ?? "選擇 SentryClips 資料夾"}
            </Button>
            {hasDirectoryPicker ? (
              <Button
                size="lg"
                variant="outline"
                onClick={handleBrowseFallback}
                disabled={Boolean(scan)}
              >
                改用瀏覽資料夾
              </Button>
            ) : null}
            <Button
              size="lg"
              variant="outline"
              onClick={() => setPasteOpen(true)}
              disabled={Boolean(scan)}
            >
              貼上資料夾名稱
            </Button>
            <Button
              size="lg"
              variant="secondary"
              onClick={handleLocalScan}
              disabled={Boolean(scan)}
            >
              {scan ? <LoaderCircle className="animate-spin" /> : <HardDrive />}
              掃描本機路徑
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={handleDemo}
              disabled={Boolean(scan)}
            >
              先用示範資料看看
            </Button>
          </div>
          <div className="space-y-2">
            <Label htmlFor="local-path">本機 SentryClips 路徑</Label>
            <Input
              id="local-path"
              value={localPath}
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
            分析時不會上傳，也不會把整批影片抓下來。每一筆可按「觀看」，只讀那一個資料夾。雲端檔第一次播放會等 OneDrive 下載。SavedClips
            預設不會列入，避免誤刪你手動保存的片段。
          </p>
        </CardContent>
      </Card>

      {error ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>讀取或刪除時發生問題</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {notice ? (
        <Alert>
          <Check />
          <AlertTitle>目前狀態</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      {visibleClips.length === 0 && !scan ? (
        <EmptyState onDemo={handleDemo} />
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="可見事件"
              value={String(stats.total)}
              hint={
                locationKeys.size > 0
                  ? `已過濾 ${locationKeys.size} 個地點`
                  : stats.knownBytes
                    ? `合計 ${formatBytes(stats.totalBytes)}`
                    : "依來源篩選後"
              }
            />
            <StatCard
              label="密集群組"
              value={String(denseClusters.length)}
              hint={`間隔 ≤ ${formatGapMinutes(gapSeconds)}`}
              tone="warn"
            />
            <StatCard
              label="建議刪除"
              value={String(stats.selectedCount)}
              hint={
                stats.knownBytes
                  ? `可清出 ${formatBytes(stats.selectedBytes)}`
                  : "尚未讀到檔案大小"
              }
              tone="danger"
            />
            <StatCard
              label="孤立事件"
              value={String(isolatedCount)}
              hint="間隔夠遠，預設保留"
            />
          </section>

          <Card>
            <CardHeader>
              <CardTitle>判斷條件</CardTitle>
              <CardDescription>
                連續兩筆間隔小於閾值會收成同一群。群組達到最少筆數後，依保留策略勾選多餘的資料夾。
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 lg:grid-cols-2">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="gap">視為接近的間隔</Label>
                  <span className="font-mono text-sm">
                    {formatGapMinutes(gapSeconds)}
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
                  Tesla 哨兵常 30–90 秒再觸發一次。3 分鐘通常能抓到「同一波」干擾。
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="最少幾筆才算太密">
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
                          {value} 筆以上
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="每個密集群組保留">
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
                      <SelectItem value="first">第一筆</SelectItem>
                      <SelectItem value="last">最後一筆</SelectItem>
                      <SelectItem value="middle">中間那筆</SelectItem>
                      <SelectItem value="spaced">
                        每隔 {formatGapMinutes(gapSeconds)} 留一筆
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {kindsPresent.size > 1 ? (
                  <Field label="資料夾來源">
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
                            {kind === "all" ? "全部來源" : clipKindLabel(kind)}
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
                    依目前條件重算勾選
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {placeStats.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>常出現的地點</CardTitle>
                <CardDescription>
                  依哨兵資料夾裡的路名統計。選住家或公司後，下面清單只會留下那些地點；再按「勾選這些地點全部」就能一次清掉。
                </CardDescription>
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
                        title={
                          place.bytes > 0
                            ? `${place.count} 筆 · ${formatBytes(place.bytes)}`
                            : `${place.count} 筆`
                        }
                        onClick={() => toggleLocation(place.key)}
                      >
                        <MapPin />
                        {place.label}
                        <span className="font-mono text-[11px] opacity-80">
                          {place.count}
                          {place.bytes > 0 ? ` · ${formatBytes(place.bytes)}` : ""}
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
                    全選
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={selected.size === 0}
                    onClick={clearSelectedClips}
                  >
                    全部取消
                  </Button>
                  {locationKeys.size > 0 ? (
                    <>
                      <Button
                        variant="outline"
                        onClick={selectFilteredLocations}
                      >
                        勾選這些地點全部
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => setLocationKeys(new Set())}
                      >
                        取消地點過濾
                      </Button>
                    </>
                  ) : null}
                  {placeStats.length > 8 ? (
                    <Button
                      variant="ghost"
                      onClick={() => setShowAllLocations((value) => !value)}
                    >
                      {showAllLocations
                        ? "只顯示最常出現的"
                        : `顯示全部 ${placeStats.length} 個地點`}
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {kindFilter === "SavedClips" ? (
            <Alert variant="destructive">
              <ShieldAlert />
              <AlertTitle>這是 SavedClips</AlertTitle>
              <AlertDescription>
                這些通常是你手動保存的片段。請再確認一次，不要把重要事件清掉。
              </AlertDescription>
            </Alert>
          ) : null}

          <Timeline clips={visibleClips} selected={selected} gapSeconds={gapSeconds} />

          <Tabs defaultValue="clusters">
            <TabsList className="w-full sm:w-auto">
              <TabsTrigger value="clusters">
                密集群組（{denseClusters.length}）
              </TabsTrigger>
              <TabsTrigger value="all">全部時間軸（{visibleClips.length}）</TabsTrigger>
              <TabsTrigger value="selected">
                將刪除（{stats.selectedCount}）
              </TabsTrigger>
            </TabsList>
            <TabsContent value="clusters" className="space-y-3 pt-3 pb-28">
              {denseClusters.length === 0 ? (
                <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
                  以目前間隔來看，沒有太密集的群組。可把閾值調大，或把「最少筆數」降到 2。
                </p>
              ) : (
                denseClusters.map((cluster, index) => (
                  <ClusterCard
                    key={cluster.id}
                    index={index + 1}
                    names={cluster.clips.map((clip) => clip.name)}
                    clips={cluster.clips}
                    selected={selected}
                    spanLabel={formatDuration(cluster.spanMs)}
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
                  還沒有勾選要刪的資料夾。
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
              已勾選 <span className="text-foreground">{stats.selectedCount}</span>{" "}
              個
              {stats.knownBytes
                ? `，可清出 ${formatBytes(stats.selectedBytes)}`
                : ""}
              。孤立事件不會被自動勾選。
            </p>
            <div className="pointer-events-auto flex flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                disabled={visibleClips.length === 0}
                onClick={selectVisibleClips}
              >
                全選
              </Button>
              <Button
                variant="ghost"
                disabled={selected.size === 0}
                onClick={clearSelectedClips}
              >
                全部取消
              </Button>
              <Button
                variant="outline"
                disabled={stats.selectedCount === 0}
                onClick={() => void openScriptDialog()}
              >
                <Download />
                下載刪除腳本
              </Button>
              <Button
                variant="destructive"
                disabled={stats.selectedCount === 0}
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 />
                {isDemo ? "從示範清單移除" : canDelete ? "刪除勾選的資料夾" : "無法直接刪除"}
              </Button>
            </div>
          </div>
        </>
      )}

      <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>貼上資料夾名稱</DialogTitle>
            <DialogDescription>
              可貼 Windows 的
              <code className="mx-1">dir</code>
              結果，或一行一個
              <code className="mx-1">2026-08-20_22-14-02</code>
              。
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
              取消
            </Button>
            <Button onClick={handlePaste}>開始分析</Button>
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
            <DialogTitle>下載 PowerShell 刪除腳本</DialogTitle>
            <DialogDescription>
              腳本只會刪下面清單裡的子資料夾。下載後 Windows 會擋未簽章的 .ps1，請用下面這行命令執行。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="root">這次要刪除的 SentryClips 路徑</Label>
            <Input
              id="root"
              value={scriptRoot}
              onChange={(event) => setScriptRoot(event.target.value)}
              className="font-mono text-xs"
            />
          </div>
          <p className="max-h-32 overflow-auto rounded-lg bg-muted p-2 font-mono text-xs">
            {selectedNames.slice(0, 12).join("\n") || "（沒有勾選）"}
            {selectedNames.length > 12
              ? `\n…還有 ${selectedNames.length - 12} 個`
              : ""}
          </p>
          <div className="space-y-2 rounded-lg border p-3 text-sm">
            <p className="font-medium">下載後這樣執行</p>
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>按「下載 .ps1」，命令會同時複製到剪貼簿。</li>
              <li>打開 PowerShell，不用先切到下載資料夾。</li>
              <li>貼上後按 Enter。腳本會立刻刪除清單裡的資料夾。</li>
            </ol>
            <p className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs">
              {runCommand}
            </p>
            <p className="text-xs text-muted-foreground">
              檔名是 {scriptFileName}，預設在「下載」資料夾。時間戳讓這次的檔不會蓋掉以前下載的腳本。若瀏覽器存到別的地方，把命令裡的 Downloads 改成實際路徑。
            </p>
            {scriptCopied ? (
              <p className="text-xs text-foreground">命令已放到剪貼簿，到 PowerShell 貼上即可。</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => copyRunCommand()}
            >
              再複製命令
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
              只下載清單
            </Button>
            <Button onClick={() => downloadDeleteScript()}>
              下載 .ps1
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {isDemo ? "從示範清單移除這些資料夾？" : "確定刪除這些資料夾？"}
            </DialogTitle>
            <DialogDescription>
              {isDemo
                ? "示範模式只改畫面上的清單，不會動到你的 OneDrive。"
                : canDelete
                  ? "這個動作無法復原。被勾選的哨兵資料夾會從磁碟移除。"
                  : "目前這個來源不能由瀏覽器直接刪除，請改下載腳本。"}
            </DialogDescription>
          </DialogHeader>
          <p className="max-h-40 overflow-auto rounded-lg bg-muted p-2 font-mono text-xs">
            {selectedNames.join("\n")}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              先不要
            </Button>
            <Button
              variant="destructive"
              disabled={deleting || (!canDelete && !isDemo)}
              onClick={confirmDelete}
            >
              {deleting ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
              {isDemo ? "移除示範項目" : `刪除 ${selectedNames.length} 個資料夾`}
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
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-3 px-6 py-14 text-center">
        <FolderOpen className="size-8 text-muted-foreground" />
        <div className="space-y-1">
          <p className="font-medium">還沒有可分析的哨兵資料夾</p>
          <p className="max-w-md text-sm text-muted-foreground">
            選本機的 SentryClips，或先載入示範資料，看夜間連續觸發會長什麼樣子。
          </p>
        </div>
        <Button variant="secondary" onClick={onDemo}>
          載入示範的一週紀錄
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
  if (clips.length === 0) return null;
  const start = clips[0].timestamp.getTime();
  const end = clips[clips.length - 1].timestamp.getTime();
  const span = Math.max(end - start, 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle>時間分布</CardTitle>
        <CardDescription>
          紅點是勾選要刪的；灰點會保留。越擠的區段代表觸發越密。
        </CardDescription>
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
                title={`${clip.name} · ${formatDateTime(clip.timestamp)}${
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
          <span>{formatDateTime(clips[0].timestamp)}</span>
          <span>{formatDateTime(clips[clips.length - 1].timestamp)}</span>
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
  const selectedInCluster = names.filter((name) => selected.has(name)).length;
  const bytes = clips.reduce((sum, clip) => sum + clip.size, 0);
  const keepCount = names.length - selectedInCluster;

  return (
    <Card className="overflow-visible border-l-4 border-l-sentry">
      <CardHeader className="sticky top-0 z-30 border-b bg-card">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>
              群組 {index} · {clips.length} 筆 · 橫跨 {spanLabel}
            </CardTitle>
            <CardDescription>
              {formatDateTime(clips[0].timestamp)} 到{" "}
              {formatClock(clips[clips.length - 1].timestamp)}
              {sharedLocationLabel(clips)
                ? ` · ${sharedLocationLabel(clips)}`
                : ""}
              {bytes > 0 ? ` · 這群共 ${formatBytes(bytes)}` : ""}
            </CardDescription>
          </div>
          <div className="relative z-30 flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onToggleCluster(names, "all")}
            >
              全保留
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onToggleCluster(names, "first")}
            >
              只留第一筆
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          將刪 {selectedInCluster} 筆，保留 {keepCount} 筆
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
                  {formatDateTime(clip.timestamp)}
                  {gap !== null ? ` · 距上一筆 ${formatDuration(gap)}` : " · 群組起點"}
                </span>
                <ClipLocationLine location={clip.location} />
              </span>
            </label>
            <div className="flex items-center gap-2 pl-7 sm:pl-0">
              {clip.kind !== "SentryClips" ? (
                <Badge variant="outline">{clipKindLabel(clip.kind)}</Badge>
              ) : null}
              <Button size="sm" variant="outline" onClick={() => onWatch(clip)}>
                <Play />
                觀看
              </Button>
              <Badge variant={checked ? "destructive" : "secondary"}>
                {checked ? "將刪除" : "保留"}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {clip.fileCount > 0
                  ? `${clip.fileCount} 個檔 · ${formatBytes(clip.size)}`
                  : formatBytes(clip.size)}
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
  const [failed, setFailed] = useState(false);
  if (!root || failed) return null;
  const params = new URLSearchParams({ root, name });
  return (
    <img
      alt="哨兵自動截圖"
      src={`/api/clip-thumb?${params.toString()}`}
      className="h-48 w-auto max-w-full self-start rounded-lg"
      onError={() => setFailed(true)}
    />
  );
}

function ClipLocationLine({ location }: { location?: ClipLocation }) {
  const label = formatClipLocation(location);
  const href = mapsUrl(location);
  if (!label && !href) return null;
  return (
    <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
      <MapPin className="size-3 shrink-0" />
      <span>{label || "有座標"}</span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2 hover:text-foreground"
          onClick={(event) => event.stopPropagation()}
        >
          地圖
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
  };
  if (!response.ok) {
    throw new Error(data.error ?? "無法掃描這個路徑");
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
