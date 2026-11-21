import { icon } from "./icons.js";
import { STRINGS } from "./i18n.js";

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let lang = localStorage.getItem("grabit.lang") || (navigator.language?.startsWith("ar") ? "ar" : "en");
const t = (key, vars = {}) => {
  let s = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
};
const num = (n) => new Intl.NumberFormat(lang === "ar" ? "ar-EG" : "en-US").format(n);
const bytes = (n) => {
  if (!n && n !== 0) return "";
  const units = lang === "ar" ? ["بايت", "ك.ب", "م.ب", "ج.ب"] : ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${new Intl.NumberFormat(lang === "ar" ? "ar-EG" : "en-US", { maximumFractionDigits: i ? 1 : 0 }).format(n)} ${units[i]}`;
};
const clock = (s) => {
  if (!s) return "";
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? `${h}:${String(m).padStart(2, "0")}` : m) + ":" + String(x).padStart(2, "0");
};
const parseTime = (v) => {
  v = String(v || "").trim();
  if (!v) return null;
  const parts = v.split(":").map(Number);
  if (parts.some(isNaN)) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
};

function paintIcons(root = document) {
  $$("[data-icon]", root).forEach((el) => { el.innerHTML = icon(el.dataset.icon); el.style.display = "inline-flex"; });
}

function applyLang() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  $("#langToggle").lang = lang === "ar" ? "en" : "ar";
  $$("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
  $$("[data-i18n-html]").forEach((el) => (el.innerHTML = t(el.dataset.i18nHtml)));
  $$("[data-i18n-ph]").forEach((el) => (el.placeholder = t(el.dataset.i18nPh)));
  $$("[data-i18n-title]").forEach((el) => (el.title = t(el.dataset.i18nTitle)));
  $$(".notice[data-key]").forEach((el) => !el.hidden && (el.innerHTML = noticeHTML(t(el.dataset.key), el.dataset.detail)));
  if (media && !busy) renderResult();
  if (conv.file) { renderFormats(); renderOptions(); renderFileCard(); }
  if (!$("#convDone").hidden) renderConvDone();
}

$("#langToggle").addEventListener("click", () => {
  lang = lang === "ar" ? "en" : "ar";
  localStorage.setItem("grabit.lang", lang);
  applyLang();
});

function noticeHTML(message, detail) {
  return `${icon("circle-alert")}<div><p>${esc(message)}</p>${
    detail ? `<details><summary>${esc(t("err.details"))}</summary><pre>${esc(detail)}</pre></details>` : ""
  }</div>`;
}
function showNotice(el, key, detail) {
  el.dataset.key = key;
  el.dataset.detail = detail || "";
  el.innerHTML = noticeHTML(t(key), detail);
  el.hidden = false;
}

function saveBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

/* ------------------------------------------------------------------ */
/* Download                                                            */
/* ------------------------------------------------------------------ */
let media = null;   // last /api/info result + the URL it came from
const choice = { type: "video", quality: "best", format: "mp3", bitrate: "192" };
const lastSaved = { blob: null, name: "" };

const urlInput = $("#url");
urlInput.addEventListener("input", () => ($("#clearUrl").hidden = !urlInput.value));
$("#clearUrl").addEventListener("click", () => { urlInput.value = ""; $("#clearUrl").hidden = true; urlInput.focus(); });
urlInput.addEventListener("paste", () => setTimeout(() => urlInput.value.trim() && lookup(), 30));
$("#lookupForm").addEventListener("submit", (e) => { e.preventDefault(); lookup(); });

class ApiError extends Error {
  constructor(code, detail) { super(detail || code); this.code = code; this.detail = detail; }
}

async function apiError(res) {
  let body = {};
  try { body = await res.json(); } catch {}
  if (res.status === 504) return new ApiError("timeout");
  return new ApiError(body.code || "failed", body.error || `${res.status} ${res.statusText}`);
}

function errorText(err) {
  const known = ["invalid_url", "login_required", "bot_check", "unsupported", "not_found", "timeout", "network", "unreachable"];
  const code = known.includes(err.code) ? err.code : "failed";
  return { key: `err.${code}`, detail: ["invalid_url", "timeout", "network", "unreachable"].includes(code) ? null : err.detail };
}

async function lookup() {
  const url = urlInput.value.trim();
  const errorBox = $("#lookupError");
  errorBox.hidden = true;
  if (!url) { urlInput.focus(); return; }
  if (media?.url === url && !$("#result").hidden) { $("#result").scrollIntoView({ block: "nearest" }); return; }

  const btn = $("#lookupBtn");
  btn.disabled = true;
  btn.innerHTML = `${icon("loader-circle", "spin")}<span>${esc(t("lookup.busy"))}</span>`;
  try {
    let res;
    try {
      res = await fetch(`/api/info?url=${encodeURIComponent(url)}`);
    } catch { throw new ApiError("network"); }
    if (!res.ok) throw await apiError(res);
    media = { ...(await res.json()), url };
    choice.type = media.kind === "single" && media.has_video === false ? "audio" : "video";
    choice.quality = "best";
    renderResult();
    $("#result").hidden = false;
    $("#result").scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (err) {
    const { key, detail } = errorText(err);
    showNotice(errorBox, key, detail);
    $("#result").hidden = true;
    media = null;
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<span data-i18n="lookup.go">${esc(t("lookup.go"))}</span><span class="flip-rtl">${icon("arrow-right")}</span>`;
  }
}

function thumbHTML(src, duration, fallback = "film") {
  const dur = duration ? `<span class="duration">${clock(duration)}</span>` : "";
  if (!src) return `<div class="media-thumb">${icon(fallback)}${dur}</div>`;
  // Some CDNs refuse hot-linking; fall back to the server relay once.
  const relay = `/api/thumb?src=${encodeURIComponent(src)}`;
  return `<div class="media-thumb"><img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer"
    onerror="if(!this.dataset.r){this.dataset.r=1;this.src='${esc(relay)}'}else{this.remove()}" />${dur}</div>`;
}

function chip(group, value, label, on, extra = "") {
  return `<button type="button" class="chip${on ? " on" : ""}" data-group="${group}" data-value="${esc(value)}" aria-pressed="${on}" ${extra}>
    <span class="chip-check">${icon("check")}</span>${label}</button>`;
}

function optionsHTML() {
  const canVideo = media.kind !== "single" || media.has_video !== false;
  let html = "";
  if (canVideo) {
    html += `<div class="opt-group"><div class="opt-label">${esc(t("res.type"))}</div><div class="chips">
      ${chip("type", "video", `${icon("film")}${esc(t("res.video"))}`, choice.type === "video")}
      ${chip("type", "audio", `${icon("music")}${esc(t("res.audio"))}`, choice.type === "audio")}
    </div></div>`;
  } else {
    html += `<div class="notice notice-info" style="margin-bottom:20px">${icon("info")}<p>${esc(t("res.audioNote"))}</p></div>`;
  }
  if (choice.type === "video" && media.kind === "single" && media.heights?.length) {
    const steps = [2160, 1440, 1080, 720, 480, 360];
    const top = media.heights[0];
    const offered = steps.filter((h) => h <= top && media.heights.some((x) => x >= h * 0.9 && x <= h * 1.1));
    html += `<div class="opt-group"><div class="opt-label">${esc(t("res.quality"))}</div><div class="chips">
      ${chip("quality", "best", `${esc(t("res.best"))} <small>${num(top)}p</small>`, choice.quality === "best")}
      ${offered.filter((h) => h !== top).slice(0, 4).map((h) => chip("quality", String(h), `${num(h)}p`, choice.quality === String(h))).join("")}
    </div></div>`;
  }
  if (choice.type === "audio") {
    html += `<div class="opt-group"><div class="opt-label">${esc(t("res.format"))}</div><div class="chips">
      ${chip("format", "mp3", "MP3", choice.format === "mp3")}
      ${chip("format", "m4a", "M4A", choice.format === "m4a")}
    </div></div>`;
    if (choice.format === "mp3") {
      html += `<div class="opt-group"><div class="opt-label">${esc(t("res.bitrate"))}</div><div class="chips">
        ${["128", "192", "320"].map((b) => chip("bitrate", b, `${num(+b)} kbps`, choice.bitrate === b)).join("")}
      </div></div>`;
    }
  }
  return html;
}

function renderResult() {
  const pane = $("#result");
  const m = media;
  const meta = [
    m.uploader && `<span>${icon("user")}${esc(m.uploader)}</span>`,
    m.site && m.site !== "Generic" && `<span>${icon("link")}${esc(m.site)}</span>`,
  ].filter(Boolean).join("");

  if (m.kind === "single") {
    pane.innerHTML = `
      <div class="result">
        ${thumbHTML(m.thumbnail, m.duration, m.has_video === false ? "music" : "film")}
        <div>
          <h2 class="media-title">${esc(m.title)}</h2>
          <p class="media-meta">${meta}</p>
          <div id="opts">${optionsHTML()}</div>
          <button class="btn btn-primary" type="button" id="downloadBtn">${icon("download")}<span>${esc(t("res.download"))}</span></button>
          <div id="dlArea"></div>
        </div>
      </div>`;
    $("#downloadBtn").addEventListener("click", () => runDownload({}));
  } else {
    const isGallery = m.kind === "gallery";
    const hasVideos = m.items.some((i) => i.type === "video");
    const count = isGallery || m.site?.toLowerCase().includes("instagram") ? t("res.items", { n: num(m.items.length) }) : t("res.itemsPlaylist", { n: num(m.items.length) });
    pane.innerHTML = `
      <div class="panel-head">
        <h2 class="media-title" style="margin:0">${esc(isGallery ? t("res.photoPost") : m.title || "")}</h2>
        <p class="media-meta" style="margin:0">${meta}<span>${icon("layers")}${esc(count)}</span></p>
      </div>
      ${hasVideos ? `<div id="opts">${optionsHTML()}</div>` : ""}
      <div class="items">
        ${m.items.map((it) => `
          <div class="item" data-index="${it.index}">
            ${thumbHTML(it.thumbnail, it.duration, it.type === "image" ? "image" : "film")}
            <div class="item-foot">
              <span>${esc(it.type === "image" ? `${t("res.photo")} ${num(it.index)}` : t("res.item", { n: num(it.index) }))}</span>
              <button type="button" class="icon-btn" data-save="${it.index}" aria-label="${esc(t("res.download"))} ${it.index}">${icon("download")}</button>
            </div>
          </div>`).join("")}
      </div>
      <div style="margin-top:22px"><button class="btn btn-primary" type="button" id="saveAllBtn">${icon("download")}<span>${esc(t("res.saveAll"))}</span></button></div>
      <div id="dlArea"></div>`;
    $$("[data-save]", pane).forEach((b) => b.addEventListener("click", () => runDownload({ item: +b.dataset.save })));
    $("#saveAllBtn").addEventListener("click", async () => {
      for (const it of m.items) {
        const ok = await runDownload({ item: it.index, quiet: true });
        if (!ok) break;
      }
    });
  }

  $$("#opts .chip", pane).forEach((c) => c.addEventListener("click", () => {
    choice[c.dataset.group] = c.dataset.value;
    renderResult();
  }));
}

function progressHTML() {
  return `<div class="progress"><div class="progress-track"><div class="progress-fill indeterminate" id="dlFill"></div></div>
    <div class="progress-row"><strong id="dlStatus">${esc(t("dl.connecting"))}</strong><span id="dlBytes"></span></div>
    <p class="fine" style="margin:0" id="dlHint">${choice.quality === "best" || +choice.quality >= 1080 ? esc(t("dl.slow")) : ""}</p></div>`;
}

let busy = false;
async function runDownload({ item, quiet }) {
  if (busy) return false;
  busy = true;
  const area = $("#dlArea");
  const itemEl = item ? $(`.item[data-index="${item}"]`) : null;
  const it = item ? media.items.find((x) => x.index === item) : null;
  const type = it?.type === "image" ? "image" : choice.type;
  $$("#result button").forEach((b) => (b.disabled = true));
  itemEl?.classList.add("saving");
  area.innerHTML = progressHTML();

  const params = new URLSearchParams({ url: media.url, type });
  if (type === "video") params.set("quality", choice.quality);
  if (type === "audio") { params.set("format", choice.format); params.set("bitrate", choice.bitrate); }
  if (item) params.set("item", item);

  try {
    let res;
    try { res = await fetch(`/api/download?${params}`); } catch { throw new ApiError("network"); }
    if (!res.ok) throw await apiError(res);

    const total = +res.headers.get("Content-Length") || 0;
    const estimate = +res.headers.get("X-Estimated-Size") || 0;
    const name = filenameFrom(res.headers.get("Content-Disposition")) || `download.${type === "audio" ? choice.format : "mp4"}`;
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    $("#dlStatus").textContent = t("dl.connecting");
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      const fill = $("#dlFill");
      const of = total || estimate;
      if (of) {
        fill.classList.remove("indeterminate");
        fill.style.width = `${Math.min(99, (got / of) * 100)}%`;
      }
      $("#dlStatus").textContent = name;
      $("#dlBytes").textContent = total ? t("dl.progress", { a: bytes(got), b: bytes(total) }) : t("dl.received", { a: bytes(got) });
    }
    if (total && got < total) throw new ApiError("timeout");

    const blob = new Blob(chunks, { type: res.headers.get("Content-Type") || "application/octet-stream" });
    saveBlob(blob, name);
    lastSaved.blob = blob;
    lastSaved.name = name;
    itemEl?.classList.replace("saving", "saved");

    area.innerHTML = `<div class="done-row">
      <span class="pill-status status-upcoming">${esc(t("dl.saved"))}</span>
      <span class="fine" style="overflow-wrap:anywhere">${esc(name)} · ${bytes(blob.size)}</span>
      ${quiet ? "" : `<button class="link-btn" type="button" id="saveAgain">${icon("download")}${esc(t("dl.again"))}</button>`}
      ${type === "image" ? "" : `<button class="link-btn" type="button" id="toConverter">${icon("refresh-cw")}${esc(t("dl.convert"))}</button>`}
    </div>`;
    $("#saveAgain")?.addEventListener("click", () => saveBlob(blob, name));
    $("#toConverter")?.addEventListener("click", () => {
      setConverterFile(new File([blob], name, { type: blob.type }));
      $("#convert").scrollIntoView({ behavior: "smooth" });
    });
    return true;
  } catch (err) {
    itemEl?.classList.remove("saving");
    const { key, detail } = errorText(err);
    area.innerHTML = `<div class="notice" role="alert" style="margin-top:18px"></div>`;
    showNotice(area.firstElementChild, key, detail);
    return false;
  } finally {
    busy = false;
    $$("#result button").forEach((b) => (b.disabled = false));
  }
}

function filenameFrom(cd) {
  if (!cd) return null;
  const star = cd.match(/filename\*=UTF-8''([^;]+)/i);
  if (star) try { return decodeURIComponent(star[1]); } catch {}
  const plain = cd.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1] : null;
}

/* ------------------------------------------------------------------ */
/* Converter (ffmpeg.wasm, runs locally)                               */
/* ------------------------------------------------------------------ */
const FORMATS = {
  video: ["mp4", "webm", "mov", "mkv", "avi", "gif"],
  audio: ["mp3", "m4a", "wav", "flac", "ogg", "opus"],
  image: ["jpg", "png", "webp"],
};
const groupOf = (f) => Object.keys(FORMATS).find((g) => FORMATS[g].includes(f));

const conv = {
  file: null,
  kind: null,          // video | audio | image (of the source)
  target: null,
  opts: { resolution: "keep", quality: "balanced", bitrate: "192", start: "", end: "", fps: "12", width: "480", mute: false },
};

function sourceKind(file) {
  const type = file.type || "";
  const ext = file.name.split(".").pop().toLowerCase();
  if (type.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "bmp", "heic", "avif"].includes(ext)) return "image";
  if (type.startsWith("audio/") || ["mp3", "m4a", "wav", "flac", "ogg", "opus", "aac", "wma"].includes(ext)) return "audio";
  return "video";
}

function setStep(n) {
  $$("#stepper li").forEach((li, i) => {
    li.className = i + 1 < n ? "done" : i + 1 === n ? "current" : "";
    li.querySelector("span").innerHTML = i + 1 < n ? icon("check") : num(i + 1);
  });
  if (n > 3) $$("#stepper li").forEach((li) => { li.className = "done"; li.querySelector("span").innerHTML = icon("check"); });
}

function setConverterFile(file) {
  if (!file) return;
  conv.file = file;
  conv.kind = sourceKind(file);
  const ext = file.name.split(".").pop().toLowerCase();
  conv.target = { video: "mp3", audio: ext === "mp3" ? "m4a" : "mp3", image: ext === "png" ? "jpg" : "png" }[conv.kind];
  $("#dropZone").hidden = true;
  $("#fileCard").hidden = false;
  $("#formatStep").hidden = false;
  $("#convDone").hidden = true;
  $("#convError").hidden = true;
  $("#convProgress").hidden = true;
  renderFileCard();
  renderFormats();
  renderOptions();
  setStep(2);
}

function renderFileCard() {
  const f = conv.file;
  $("#fileName").textContent = f.name;
  $("#fileMeta").textContent = `${bytes(f.size)} · ${t(`grp.${conv.kind}`)}`;
  $("#fileCard .svc-icon").innerHTML = icon({ video: "film", audio: "music", image: "image" }[conv.kind]);
}

function allowed(fmt) {
  const g = groupOf(fmt);
  if (conv.kind === "audio") return g === "audio";
  if (conv.kind === "image") return g === "image";
  return true;
}

function renderFormats() {
  $("#fmtGroups").innerHTML = Object.entries(FORMATS).map(([g, list]) => `
    <div class="fmt-group"><span>${esc(t(`grp.${g}`))}</span><div class="chips">
      ${list.map((f) => `<button type="button" class="chip${conv.target === f ? " on" : ""}" data-fmt="${f}" aria-pressed="${conv.target === f}" ${allowed(f) ? "" : "disabled"}>${f.toUpperCase()}</button>`).join("")}
    </div></div>`).join("");
  $$("#fmtGroups .chip").forEach((c) => c.addEventListener("click", () => {
    conv.target = c.dataset.fmt;
    renderFormats();
    renderOptions();
    $("#convDone").hidden = true;
    setStep(2);
  }));
  const slow = conv.target === "webm";
  $("#convHint").textContent = slow ? t("conv.hintSlow") : ffmpegInstance ? "" : t("conv.hintFirst");
}

function field(id, label, control) {
  return `<label class="fld"><span>${esc(label)}</span><div class="signin-input">${control}</div></label>`;
}
function select(id, options, value) {
  return `<select id="${id}">${options.map(([v, l]) => `<option value="${v}"${v === value ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
}

function renderOptions() {
  const g = groupOf(conv.target);
  const o = conv.opts;
  const parts = [];
  const res = select("o-resolution", [["keep", t("opt.keep")], ["1080", "1080p"], ["720", "720p"], ["480", "480p"], ["360", "360p"]], o.resolution);
  const timeIn = (id, val, ph) => `${icon("clock")}<input id="${id}" value="${esc(val)}" placeholder="${ph}" inputmode="numeric" />`;

  if (g === "video" && conv.target !== "gif") {
    parts.push(field("o-resolution", t("opt.resolution"), res));
    parts.push(field("o-quality", t("opt.quality"), select("o-quality", [["high", t("opt.high")], ["balanced", t("opt.balanced")], ["small", t("opt.small")]], o.quality)));
  }
  if (conv.target === "gif") {
    parts.push(field("o-fps", t("opt.fps"), select("o-fps", [["8", "8"], ["12", "12"], ["15", "15"], ["24", "24"]], o.fps)));
    parts.push(field("o-width", t("opt.width"), select("o-width", [["320", "320 px"], ["480", "480 px"], ["640", "640 px"], ["800", "800 px"]], o.width)));
  }
  if (["mp3", "m4a", "ogg", "opus"].includes(conv.target) || (g === "video" && !["gif"].includes(conv.target) && !o.mute)) {
    parts.push(field("o-bitrate", t("opt.bitrate"), select("o-bitrate", [["128", "128 kbps"], ["192", "192 kbps"], ["256", "256 kbps"], ["320", "320 kbps"]], o.bitrate)));
  }
  if (g === "image") {
    parts.push(field("o-resolution", t("opt.resolution"), res));
    if (conv.kind === "video") parts.push(field("o-start", t("opt.frame"), timeIn("o-start", o.start, "0:05")));
  } else if (conv.kind !== "image") {
    parts.push(field("o-start", t("opt.start"), timeIn("o-start", o.start, "0:00")));
    parts.push(field("o-end", t("opt.end"), timeIn("o-end", o.end, "1:30")));
  }
  let html = parts.join("");
  if (g === "video" && conv.target !== "gif" && conv.kind === "video") {
    html += `<label class="check-row"><input type="checkbox" id="o-mute"${o.mute ? " checked" : ""} />${esc(t("opt.mute"))}</label>`;
  }
  $("#convOpts").innerHTML = html;
  $$("#convOpts select, #convOpts input").forEach((el) => el.addEventListener("change", () => {
    const key = el.id.slice(2);
    conv.opts[key] = el.type === "checkbox" ? el.checked : el.value;
    if (key === "mute") renderOptions();
  }));
}

// file picking
const drop = $("#dropZone");
$("#fileInput").addEventListener("change", (e) => setConverterFile(e.target.files[0]));
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => setConverterFile(e.dataTransfer.files[0]));
$("#changeFile").addEventListener("click", () => {
  conv.file = null;
  $("#fileInput").value = "";
  $("#dropZone").hidden = false;
  $("#fileCard").hidden = true;
  $("#formatStep").hidden = true;
  setStep(1);
});

// ffmpeg.wasm
let ffmpegInstance = null;
let ffLogs = [];
async function getFFmpeg() {
  if (ffmpegInstance) return ffmpegInstance;
  const { FFmpeg } = await import("./vendor/ffmpeg/ffmpeg/index.js");
  const ff = new FFmpeg();
  ff.on("log", ({ message }) => { ffLogs.push(message); if (ffLogs.length > 400) ffLogs.shift(); });
  const base = new URL("./vendor/ffmpeg/core/", import.meta.url).href;
  await ff.load({ coreURL: base + "ffmpeg-core.js", wasmURL: base + "ffmpeg-core.wasm" });
  ffmpegInstance = ff;
  return ff;
}

function buildArgs(input, output) {
  const o = conv.opts;
  const target = conv.target;
  const g = groupOf(target);
  const start = parseTime(o.start);
  const end = parseTime(o.end);
  const args = ["-hide_banner"];
  if (start && conv.kind !== "image") args.push("-ss", String(start));
  args.push("-i", input);
  if (end && g !== "image") args.push("-t", String(Math.max(0.1, end - (start || 0))));
  const scale = o.resolution !== "keep" ? `scale=-2:'min(${o.resolution},ih)'` : null;
  const abr = `${o.bitrate}k`;
  const crf = { high: 20, balanced: 24, small: 29 }[o.quality];

  if (g === "audio") {
    args.push("-vn");
    args.push(...{
      mp3: ["-c:a", "libmp3lame", "-b:a", abr],
      m4a: ["-c:a", "aac", "-b:a", abr],
      wav: ["-c:a", "pcm_s16le"],
      flac: ["-c:a", "flac"],
      ogg: ["-c:a", "libvorbis", "-q:a", "6"],
      opus: ["-c:a", "libopus", "-b:a", abr],
    }[target]);
  } else if (target === "gif") {
    args.push("-vf", `fps=${o.fps},scale=${o.width}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, "-loop", "0");
  } else if (g === "image") {
    args.push("-frames:v", "1");
    if (scale) args.push("-vf", scale);
    if (target === "jpg") args.push("-q:v", "2");
  } else {
    if (scale) args.push("-vf", scale);
    const audio = (codec) => (o.mute ? ["-an"] : codec);
    if (["mp4", "mov", "mkv"].includes(target)) {
      args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", String(crf), "-pix_fmt", "yuv420p", ...audio(["-c:a", "aac", "-b:a", abr]));
      if (target !== "mkv") args.push("-movflags", "+faststart");
    } else if (target === "webm") {
      // VP8: the browser build's VP9 encoder crashes, VP8 is reliable and plays everywhere WebM does.
      const vp8 = { high: ["6", "4M"], balanced: ["10", "2M"], small: ["20", "1M"] }[o.quality];
      args.push("-c:v", "libvpx", "-crf", vp8[0], "-b:v", vp8[1], "-deadline", "realtime", "-cpu-used", "8", ...audio(["-c:a", "libvorbis", "-b:a", abr]));
    } else if (target === "avi") {
      args.push("-c:v", "mpeg4", "-q:v", "4", ...audio(["-c:a", "libmp3lame", "-b:a", abr]));
    }
  }
  args.push(output);
  return { args, start, end };
}

$("#convertBtn").addEventListener("click", convert);

async function convert() {
  const errBox = $("#convError");
  errBox.hidden = true;
  $("#convDone").hidden = true;
  if (!conv.file) { showNotice(errBox, "err.noFile"); return; }

  const btn = $("#convertBtn");
  btn.disabled = true;
  $$("#fmtGroups .chip, #convOpts select, #convOpts input, #changeFile").forEach((el) => (el.disabled = true));
  const fill = $("#convFill");
  $("#convProgress").hidden = false;
  fill.style.width = "0%";
  fill.classList.add("indeterminate");
  $("#convPct").textContent = "";
  $("#convStatus").textContent = t("conv.loading");
  setStep(3);

  const stem = conv.file.name.replace(/\.[^.]+$/, "") || "file";
  const outName = `${stem}.${conv.target}`;
  const safeIn = "input." + (conv.file.name.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "") || "bin");
  let ff;
  let mounted = false;
  try {
    ff = await getFFmpeg();
    $("#convHint").textContent = "";
    $("#convStatus").textContent = t("conv.running");
    ffLogs = [];

    // Read the file in place (WORKERFS) instead of copying it into memory.
    await ff.createDir("/in").catch(() => {});
    await ff.mount("WORKERFS", { files: [new File([conv.file], safeIn, { type: conv.file.type })] }, "/in");
    mounted = true;

    const { args, start, end } = buildArgs(`/in/${safeIn}`, `out.${conv.target}`);
    let duration = null;
    const onProgress = ({ time }) => {
      if (duration == null) {
        const line = ffLogs.find((l) => l.includes("Duration:"));
        const m = line && line.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
        duration = m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
      }
      const span = (end || duration || 0) - (start || 0);
      if (span > 0 && time > 0) {
        const pct = Math.max(0, Math.min(99, (time / 1e6 / span) * 100));
        fill.classList.remove("indeterminate");
        fill.style.width = `${pct}%`;
        $("#convPct").textContent = `${num(Math.round(pct))}%`;
      }
    };
    ff.on("progress", onProgress);
    const code = await ff.exec(args);
    ff.off("progress", onProgress);
    if (code !== 0) throw new Error("ffmpeg exited with " + code);

    const data = await ff.readFile(`out.${conv.target}`);
    await ff.deleteFile(`out.${conv.target}`).catch(() => {});
    const blob = new Blob([data.buffer], { type: mimeFor(conv.target) });

    fill.classList.remove("indeterminate");
    fill.style.width = "100%";
    $("#convStatus").textContent = t("conv.done");
    $("#convPct").textContent = bytes(blob.size);
    setStep(4);
    lastConverted = { blob, outName, target: conv.target };
    renderConvDone();
    saveBlob(blob, outName);
  } catch (err) {
    const log = ffLogs.join("\n");
    let msg = "err.convert";
    if (/does not contain any stream|matches no streams|Output file .* does not contain|no video stream/i.test(log)) {
      msg = groupOf(conv.target) === "audio" ? "err.noAudio" : "err.audioOnly";
    } else if (/OOM|out of memory|Cannot enlarge memory|RangeError|Aborted/i.test(log + " " + err)) {
      msg = "err.memory";
    }
    showNotice(errBox, msg, ffLogs.slice(-8).join("\n") || String(err));
    $("#convProgress").hidden = true;
    setStep(2);
    // A failed run can leave the wasm instance unusable; start fresh next time.
    try { ffmpegInstance?.terminate(); } catch {}
    ffmpegInstance = null;
    mounted = false;
  } finally {
    if (mounted && ff) { await ff.unmount("/in").catch(() => {}); }
    btn.disabled = false;
    $$("#fmtGroups .chip, #convOpts select, #convOpts input, #changeFile").forEach((el) => (el.disabled = false));
    renderFormats();
  }
}

let lastConverted = null;
function renderConvDone() {
  const c = lastConverted;
  if (!c) return;
  $("#convStatus").textContent = t("conv.done");
  $("#convPct").textContent = bytes(c.blob.size);
  const done = $("#convDone");
  done.innerHTML = `
    <button class="btn btn-primary" type="button" id="saveConverted">${icon("download")}<span>${esc(t("conv.save", { name: c.target.toUpperCase() }))}</span></button>
    <span class="fine" style="overflow-wrap:anywhere">${esc(c.outName)}</span>`;
  done.hidden = false;
  $("#saveConverted").addEventListener("click", () => saveBlob(c.blob, c.outName));
}

function mimeFor(ext) {
  return {
    mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska", avi: "video/x-msvideo", gif: "image/gif",
    mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", flac: "audio/flac", ogg: "audio/ogg", opus: "audio/ogg",
    jpg: "image/jpeg", png: "image/png", webp: "image/webp",
  }[ext] || "application/octet-stream";
}

/* ------------------------------------------------------------------ */
/* Nav: highlight the section in view                                  */
/* ------------------------------------------------------------------ */
const io = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (e.isIntersecting) $$(".nav-links a").forEach((a) => a.setAttribute("aria-current", a.getAttribute("href") === `#${e.target.id}` ? "true" : "false"));
  });
}, { rootMargin: "-45% 0px -50% 0px" });
["download", "convert"].forEach((id) => io.observe(document.getElementById(id)));

paintIcons();
applyLang();
