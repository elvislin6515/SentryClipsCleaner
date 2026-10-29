import assert from "node:assert/strict";
import {
  buildClipTimeline,
  camerasToOpen,
  eventCameraId,
  eventReasonLabel,
  groupClipVideos,
  locateEventTime,
  parseClipEvent,
  parseClipVideoName,
  parseTeslaTimestamp,
  ratioOnTimeline,
  seekOnTimeline,
} from "./clip-videos.ts";
import {
  buildPowerShellScript,
  buildRunCommand,
  buildScriptFileName,
  encodeTextDownload,
} from "./export-script.ts";
import {
  applyClusterKeep,
  clipsFromNamedFolders,
  clusterClips,
  formatClipLocation,
  locationKey,
  locationStats,
  mapsUrl,
  namesAtLocations,
  parseClipFolderName,
  parseEventLocation,
  parsePastedNames,
  sharedLocationLabel,
  suggestedDeleteNames,
  type Clip,
} from "./clips.ts";

function clip(name: string): Clip {
  const timestamp = parseClipFolderName(name);
  assert.ok(timestamp, name);
  return {
    id: name,
    name,
    timestamp,
    size: 1,
    fileCount: 4,
    kind: "SentryClips",
  };
}

assert.equal(
  parseClipFolderName("2026-08-20_22-14-02")?.toISOString().startsWith("2026-08-20"),
  true,
);
assert.ok(parseClipFolderName("2026-08-20_22-14-02-front.mp4"));
assert.equal(parseClipFolderName("event.json"), null);

const named = clipsFromNamedFolders([
  { name: "2026-08-20_22-14-02", kind: "SentryClips" },
  { name: "event.json", kind: "SentryClips" },
]);
assert.equal(named.length, 1);
assert.equal(named[0].size, 0);

const sized = clipsFromNamedFolders([
  { name: "2026-08-20_22-14-02", kind: "SentryClips", size: 1500, fileCount: 6 },
]);
assert.equal(sized[0].size, 1500);
assert.equal(sized[0].fileCount, 6);

const pasted = parsePastedNames(`
2026-08-20_22-14-02
2026-08-20_22-14-41
20260820_221518
`);
assert.equal(pasted.length, 3);

const burst = [
  clip("2026-08-20_22-14-02"),
  clip("2026-08-20_22-14-41"),
  clip("2026-08-20_22-16-03"),
  clip("2026-08-20_22-18-10"),
  clip("2026-08-20_23-40-00"),
];
const clusters = clusterClips(burst, 3 * 60 * 1000);
assert.equal(clusters.length, 2);
assert.equal(clusters[0].clips.length, 4);
assert.equal(clusters[1].clips.length, 1);

const firstPolicy = suggestedDeleteNames(clusters, "first", 2, 3 * 60 * 1000);
assert.deepEqual([...firstPolicy], [
  "2026-08-20_22-14-41",
  "2026-08-20_22-16-03",
  "2026-08-20_22-18-10",
]);

const spaced = suggestedDeleteNames(clusters, "spaced", 2, 3 * 60 * 1000);
assert.deepEqual([...spaced], [
  "2026-08-20_22-14-41",
  "2026-08-20_22-16-03",
]);

const group1 = clusters[0].clips.map((item) => item.name);
const group2 = ["2026-08-21_02-08-03", "2026-08-21_02-09-11", "2026-08-21_02-10-44"];
const selected = new Set([
  ...group1.slice(1),
  ...group2.slice(1),
]);
const keepSecond = applyClusterKeep(selected, group2, "all");
assert.equal(keepSecond.has("2026-08-21_02-09-11"), false);
assert.equal(keepSecond.has("2026-08-21_02-10-44"), false);
assert.equal(keepSecond.has(group1[1]), true);

const keepFirstInSecond = applyClusterKeep(new Set([...group2]), group2, "first");
assert.equal(keepFirstInSecond.has("2026-08-21_02-08-03"), false);
assert.equal(keepFirstInSecond.has("2026-08-21_02-09-11"), true);
assert.equal(keepFirstInSecond.has("2026-08-21_02-10-44"), true);

const parsed = parseEventLocation({
  timestamp: "2026-07-18T16:30:43",
  city: "",
  street: "沿海路",
  est_lat: "22.4645",
  est_lon: "120.462",
});
assert.equal(parsed?.street, "沿海路");
assert.equal(parsed?.lat, 22.4645);
assert.equal(parsed?.lon, 120.462);
assert.equal(formatClipLocation(parsed), "沿海路");
assert.ok(mapsUrl(parsed)?.includes("22.4645"));
assert.equal(parseEventLocation({ est_lat: "0", est_lon: "0" }), undefined);
assert.equal(parseEventLocation({ city: "高雄市" })?.city, "高雄市");

const located = clipsFromNamedFolders([
  {
    name: "2026-08-20_22-14-02",
    kind: "SentryClips",
    location: parsed,
  },
]);
assert.equal(located[0].location?.street, "沿海路");
assert.equal(
  sharedLocationLabel(
    [
      { ...located[0], location: { street: "沿海路" } },
      { ...located[0], name: "other", location: { street: "七賢二路" } },
    ],
    "zh-Hant",
  ),
  "多個地點",
);
assert.equal(
  sharedLocationLabel(
    [
      { ...located[0], location: { street: "沿海路" } },
      { ...located[0], name: "other", location: { street: "七賢二路" } },
    ],
    "en",
  ),
  "Multiple locations",
);

const home = { street: "七賢二路", lat: 22.6334, lon: 120.296 };
const office = { street: "沿海路", lat: 22.4645, lon: 120.462 };
const ranked = locationStats([
  { ...clip("2026-08-20_22-14-02"), location: home, size: 10 },
  { ...clip("2026-08-20_22-14-41"), location: home, size: 20 },
  { ...clip("2026-08-20_22-16-03"), location: home, size: 30 },
  { ...clip("2026-08-21_02-08-03"), location: office, size: 5 },
  { ...clip("2026-08-21_09-41-55") },
]);
assert.equal(ranked[0].label, "七賢二路");
assert.equal(ranked[0].count, 3);
assert.equal(ranked[0].bytes, 60);
assert.equal(ranked[1].label, "沿海路");
assert.equal(ranked.length, 2);
assert.equal(locationKey(home), "七賢二路");

const placeClips = [
  { ...clip("2026-08-20_22-14-02"), location: home },
  { ...clip("2026-08-20_22-14-41"), location: home },
  { ...clip("2026-08-21_02-08-03"), location: office },
];
assert.deepEqual(namesAtLocations(placeClips, ["七賢二路"]), [
  "2026-08-20_22-14-02",
  "2026-08-20_22-14-41",
]);
assert.deepEqual(namesAtLocations(placeClips, []), []);

const grouped = groupClipVideos([
  { name: "2026-09-20_13-19-43-back.mp4", size: 4 },
  { name: "2026-09-20_13-18-42-front.mp4", size: 1 },
  { name: "2026-09-20_13-18-42-left_repeater.mp4", size: 2 },
  { name: "event.json", size: 1 },
  { name: "../secret.mp4", size: 9 },
]);
assert.equal(parseClipVideoName("../secret.mp4"), null);
assert.equal(grouped.length, 2);
assert.equal(grouped[0].id, "2026-09-20_13-18-42");
assert.deepEqual(
  grouped[0].files.map((file) => file.camera),
  ["front", "left_repeater"],
);
assert.equal(grouped[1].files[0].camera, "back");

const eventMs = parseTeslaTimestamp("2026-08-27T07:27:10");
assert.equal(eventMs != null, true);
const jump = locateEventTime(
  [
    "2026-08-27_07-24-39",
    "2026-08-27_07-25-40",
    "2026-08-27_07-26-40",
    "2026-08-27_07-27-40",
  ],
  eventMs ?? 0,
);
assert.equal(jump?.segmentId, "2026-08-27_07-26-40");
assert.equal(jump?.seconds, 30);

const eventMeta = parseClipEvent({
  timestamp: "2026-08-27T07:27:10",
  reason: "sentry_aware_object_detection",
  camera: "6",
  est_lat: "24.8064",
  est_lon: "120.955",
  city: "",
  street: "",
});
assert.equal(eventMeta?.camera, "right_pillar");
assert.equal(eventMeta?.lat, 24.8064);
assert.equal(eventReasonLabel(eventMeta?.reason ?? null, "zh-Hant"), "偵測到物體");
assert.equal(eventReasonLabel("sentry_locked_handle_pulled", "zh-Hant"), "拉動門把");
assert.equal(eventReasonLabel(eventMeta?.reason ?? null), "Object detected");
assert.equal(eventReasonLabel("sentry_locked_handle_pulled"), "Door handle pulled");
assert.equal(eventCameraId("0"), "front");
assert.equal(eventCameraId("5"), "left_pillar");
assert.equal(eventCameraId(7), "back");
assert.deepEqual(
  camerasToOpen(
    ["front", "back", "left_repeater", "right_repeater", "left_pillar", "right_pillar"],
    "right_pillar",
    false,
  ),
  ["right_repeater", "right_pillar"],
);
assert.deepEqual(
  camerasToOpen(
    ["front", "back", "left_repeater", "right_repeater", "left_pillar", "right_pillar"],
    "left_repeater",
    false,
  ),
  ["left_repeater", "left_pillar"],
);
assert.deepEqual(camerasToOpen(["front", "left_pillar"], "left_pillar", false), [
  "left_pillar",
]);
assert.deepEqual(camerasToOpen(["front", "back", "left_repeater"], null, false), [
  "front",
]);
assert.deepEqual(
  camerasToOpen(["back", "right_pillar"], "right_pillar", true),
  ["back", "right_pillar"],
);
assert.equal(parseClipEvent({ city: "" }), null);

const timeline = buildClipTimeline(
  [
    "2026-08-27_07-24-39",
    "2026-08-27_07-25-40",
    "2026-08-27_07-26-40",
    "2026-08-27_07-27-40",
  ],
  eventMs ?? undefined,
);
assert.ok(timeline);
const scrubbed = seekOnTimeline(
  timeline,
  ratioOnTimeline(timeline, eventMs ?? 0),
);
assert.equal(scrubbed?.segmentId, "2026-08-27_07-26-40");
assert.ok(Math.abs((scrubbed?.seconds ?? 0) - 30) < 0.05);

const stamped = buildScriptFileName(new Date(2026, 8, 22, 14, 32, 5));
assert.equal(stamped, "clean-sentryclips-20260922-143205.ps1");
assert.equal(
  buildRunCommand(stamped),
  'powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\\Downloads\\clean-sentryclips-20260922-143205.ps1"',
);

const generated = buildPowerShellScript(
  ['2026-09-12_07-57-33', '資料夾"名稱'],
  "C:\\Users\\使用者\\SentryClips",
);
assert.match(generated, /0x522A, 0x9664/);
assert.match(generated, /C:\\Users\\使用者\\SentryClips/);
assert.match(generated, /Delete root/);
const generatedZh = buildPowerShellScript(
  ["2026-09-12_07-57-33"],
  "C:\\TeslaCam\\SentryClips",
  "zh-Hant",
);
assert.match(generatedZh, /刪除根目錄/);
const encoded = encodeTextDownload(stamped, generated);
assert.deepEqual(Array.from(encoded.subarray(0, 3)), [0xef, 0xbb, 0xbf]);
assert.equal(new TextDecoder().decode(encoded.subarray(3)), generated);
assert.deepEqual(
  Array.from(encodeTextDownload("Clean.PS1", `\uFEFF${generated}`)),
  Array.from(encoded),
);
const listFile = encodeTextDownload(
  "sentryclips-delete-list.txt",
  "2026-09-12_07-57-33\n",
);
assert.equal(listFile[0], 0x32);
assert.equal(new TextDecoder().decode(listFile), "2026-09-12_07-57-33\n");

assert.equal(
  clipsFromNamedFolders([
    { name: "2026-08-20_22-14-02", kind: "SentryClips", hasThumb: true },
  ])[0]?.hasThumb,
  true,
);

console.log("clips.selftest ok");
