"""
GrabIt API: looks up media links and streams downloads.

Runs as one Vercel Python function (all /api/* routes are rewritten here by
vercel.json). Nothing is stored: files are streamed from the source site,
through ffmpeg when video and audio have to be merged or the audio converted,
straight to the visitor's browser.

Local development:  python api/index.py   ->  http://127.0.0.1:5000
"""
from __future__ import annotations

import ipaddress
import os
import re
import shutil
import socket
import stat
import subprocess
import sys
import threading
import urllib.parse
from pathlib import Path

from flask import Flask, Response, jsonify, request, send_from_directory

import yt_dlp
from yt_dlp.networking import Request as YDLRequest

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
TMP = Path(os.environ.get("TMPDIR", "/tmp"))

# Optional settings (Vercel → Project → Settings → Environment Variables)
PROXY = os.environ.get("GRABIT_PROXY") or None           # e.g. http://user:pass@host:port
COOKIES = os.environ.get("GRABIT_COOKIES") or None       # contents of a Netscape cookies.txt
ALLOW_PRIVATE = os.environ.get("GRABIT_ALLOW_PRIVATE_URLS") == "1"  # local testing only

CHUNK = 256 * 1024
MAX_ITEMS = 60

app = Flask(__name__, static_folder=None)


class RestoreApiPath:
    """vercel.json rewrites /api/<x> to /api/index?__path=<x>; put the real path back."""

    def __init__(self, wsgi_app):
        self.wsgi_app = wsgi_app

    def __call__(self, environ, start_response):
        query = urllib.parse.parse_qs(environ.get("QUERY_STRING", ""), keep_blank_values=True)
        sub = query.pop("__path", None)
        if sub:
            environ["PATH_INFO"] = "/api/" + sub[0].lstrip("/")
            environ["QUERY_STRING"] = urllib.parse.urlencode(query, doseq=True)
        return self.wsgi_app(environ, start_response)


app.wsgi_app = RestoreApiPath(app.wsgi_app)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
class ApiError(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


@app.errorhandler(ApiError)
def _api_error(e: ApiError):
    return jsonify(error=e.message, code=e.code), e.status


_ffmpeg_path: str | None = None


def ffmpeg() -> str:
    """System ffmpeg if present, otherwise the static build shipped by imageio-ffmpeg."""
    global _ffmpeg_path
    if _ffmpeg_path:
        return _ffmpeg_path
    exe = shutil.which("ffmpeg")
    if not exe:
        import imageio_ffmpeg

        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if not os.access(exe, os.X_OK):  # read-only bundle without the exec bit
            copy = TMP / "ffmpeg"
            if not copy.exists():
                shutil.copy(exe, copy)
                copy.chmod(copy.stat().st_mode | stat.S_IEXEC)
            exe = str(copy)
    _ffmpeg_path = exe
    return exe


def cookie_file() -> str | None:
    if not COOKIES:
        return None
    path = TMP / "grabit-cookies.txt"  # yt-dlp writes cookies back, so it must be writable
    if not path.exists():
        path.write_text(COOKIES.replace("\\n", "\n"))
    return str(path)


def check_url(raw: str | None) -> str:
    url = (raw or "").strip()
    if not url:
        raise ApiError("invalid_url", "Paste a link first.")
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise ApiError("invalid_url", "That doesn't look like a web link.")
    if not ALLOW_PRIVATE:
        # Stop the server from being used to reach internal addresses.
        try:
            addrs = {ai[4][0] for ai in socket.getaddrinfo(parts.hostname, None)}
        except socket.gaierror:
            raise ApiError("invalid_url", "That website couldn't be found.")
        for a in addrs:
            ip = ipaddress.ip_address(a.split("%")[0])
            if not ip.is_global:
                raise ApiError("invalid_url", "That link points to a private address.")
    return url


def ydl_opts(**extra) -> dict:
    opts = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "socket_timeout": 20,
        "cachedir": str(TMP / "yt-dlp-cache"),
        "ffmpeg_location": ffmpeg(),
    }
    if PROXY:
        opts["proxy"] = PROXY
    if cookie_file():
        opts["cookiefile"] = cookie_file()
    opts.update(extra)
    return opts


def explain(err: Exception) -> ApiError:
    msg = re.sub(r"\x1b\[[0-9;]*m", "", str(err)).replace("ERROR: ", "")
    msg = re.sub(r";?\s*please report this issue on.*$", "", msg, flags=re.S).strip()
    low = msg.lower()
    if "confirm you" in low and "bot" in low:
        return ApiError("bot_check", msg, 403)
    if any(k in low for k in ("login required", "log in", "sign in", "cookies", "private", "rate-limit", "not available")):
        return ApiError("login_required", msg, 403)
    if "unable to download webpage" in low and any(k in low for k in ("connect", "resolve", "name or service", "timed out")):
        return ApiError("unreachable", msg, 502)
    if "unsupported url" in low:
        return ApiError("unsupported", msg, 400)
    if any(k in low for k in ("404", "not found", "removed", "does not exist", "unavailable")):
        return ApiError("not_found", msg, 404)
    return ApiError("failed", msg, 502)


def safe_filename(name: str, ext: str) -> str:
    name = re.sub(r'[\\/:*?"<>|\r\n\t]+', " ", name or "download").strip(" .")
    name = re.sub(r"\s+", " ", name)[:120] or "download"
    return f"{name}.{ext}"


def disposition(filename: str) -> str:
    ascii_name = filename.encode("ascii", "ignore").decode() or "download"
    ascii_name = ascii_name.replace('"', "")
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{urllib.parse.quote(filename)}"


def best_thumb(info: dict) -> str | None:
    if info.get("thumbnail"):
        return info["thumbnail"]
    thumbs = [t for t in info.get("thumbnails") or [] if t.get("url")]
    return thumbs[-1]["url"] if thumbs else None


def has_video(info: dict) -> bool:
    fmts = info.get("formats") or []
    if fmts:
        return any(f.get("vcodec") != "none" for f in fmts)
    return info.get("vcodec") != "none"


def gallery_urls(url: str) -> list[str]:
    """Image posts (Instagram photos and carousels): ask gallery-dl for the file URLs."""
    cmd = [sys.executable, "-m", "gallery_dl", "-g", "--range", f"1-{MAX_ITEMS}"]
    if PROXY:
        cmd += ["--proxy", PROXY]
    if cookie_file():
        cmd += ["--cookies", cookie_file()]
    proc = subprocess.run(cmd + [url], capture_output=True, text=True, timeout=60)
    urls = [u.lstrip("| ").strip() for u in proc.stdout.splitlines() if u.strip().lstrip("| ").startswith("http")]
    if not urls:
        raise explain(Exception(proc.stderr.strip() or "No media found in this post."))
    return urls


# --------------------------------------------------------------------------- #
# /api/info
# --------------------------------------------------------------------------- #
@app.route("/api/info", methods=["GET", "POST"])
def info():
    data = request.get_json(silent=True) or request.values
    url = check_url(data.get("url"))
    try:
        with yt_dlp.YoutubeDL(ydl_opts(extract_flat="in_playlist", playlistend=MAX_ITEMS)) as ydl:
            meta = ydl.sanitize_info(ydl.extract_info(url, download=False))
    except yt_dlp.utils.DownloadError as e:
        low = str(e).lower()
        if "no video" in low or "no formats" in low:
            urls = gallery_urls(url)
            return jsonify(
                kind="gallery", title="Photo post", site="Instagram" if "instagram" in url else None,
                items=[{"index": i + 1, "type": "image", "thumbnail": u} for i, u in enumerate(urls)],
            )
        raise explain(e)

    if meta.get("_type") in ("playlist", "multi_video") or meta.get("entries") is not None:
        entries = [e for e in (meta.get("entries") or []) if e][:MAX_ITEMS]
        items = [
            {
                "index": i + 1,
                "type": "video" if e.get("_type") == "url" or has_video(e) else "audio",
                "title": e.get("title"),
                "duration": e.get("duration"),
                "thumbnail": best_thumb(e),
            }
            for i, e in enumerate(entries)
        ]
        return jsonify(
            kind="playlist", title=meta.get("title"), uploader=meta.get("uploader") or meta.get("channel"),
            site=meta.get("extractor_key"), thumbnail=best_thumb(meta) or (items[0]["thumbnail"] if items else None),
            items=items,
        )

    heights = sorted(
        {f["height"] for f in meta.get("formats") or [] if f.get("height") and f.get("vcodec") not in (None, "none")},
        reverse=True,
    )
    return jsonify(
        kind="single",
        title=meta.get("title") or meta.get("id"),
        uploader=meta.get("uploader") or meta.get("channel") or meta.get("uploader_id"),
        duration=meta.get("duration"),
        thumbnail=best_thumb(meta),
        site=meta.get("extractor_key"),
        has_video=has_video(meta),
        heights=heights,
    )


# --------------------------------------------------------------------------- #
# /api/download
# --------------------------------------------------------------------------- #
def video_selector(quality: str) -> str:
    h = f"[height<={int(quality)}]" if quality.isdigit() else ""
    # Prefer H.264 + AAC (plays everywhere), then any MP4, then anything at all.
    return (
        f"bv*{h}[vcodec^=avc1]+ba[acodec^=mp4a]/bv*{h}[ext=mp4]+ba[ext=m4a]/b{h}[ext=mp4]/"
        f"bv*{h}+ba/b{h}/bv*+ba/b"
    )


def stream_direct(ydl: yt_dlp.YoutubeDL, fmt: dict, filename: str, mime: str) -> Response:
    """Pass a single file through, in ranged chunks when the site needs it (YouTube)."""
    headers = dict(fmt.get("http_headers") or {})
    chunk_size = (fmt.get("downloader_options") or {}).get("http_chunk_size")
    size = fmt.get("filesize")

    def open_range(start: int | None):
        h = dict(headers)
        if chunk_size and start is not None:
            h["Range"] = f"bytes={start}-{start + chunk_size - 1}"
        return ydl.urlopen(YDLRequest(fmt["url"], headers=h))

    try:
        first = open_range(0 if chunk_size else None)
    except Exception as e:  # noqa: BLE001
        raise explain(e)
    if not size:
        cr = first.headers.get("Content-Range")
        size = int(cr.rsplit("/", 1)[1]) if cr and cr.rsplit("/", 1)[1].isdigit() else None
        if not size and not chunk_size and first.headers.get("Content-Length"):
            size = int(first.headers["Content-Length"])

    def gen():
        resp, pos = first, 0
        try:
            while True:
                got = 0
                while True:
                    block = resp.read(CHUNK)
                    if not block:
                        break
                    got += len(block)
                    pos += len(block)
                    yield block
                resp.close()
                if not chunk_size or got == 0 or (size and pos >= size) or got < chunk_size:
                    return
                resp = open_range(pos)
        finally:
            resp.close()

    out = Response(gen(), mimetype=mime)
    out.headers["Content-Disposition"] = disposition(filename)
    if size:
        out.headers["Content-Length"] = str(size)
    return out


def stream_ffmpeg(fmts: list[dict], args: list[str], filename: str, mime: str, estimate: int | None) -> Response:
    """Merge/convert with ffmpeg reading the source URLs and writing to stdout."""
    cmd = [ffmpeg(), "-hide_banner", "-loglevel", "error", "-nostdin"]
    for f in fmts:
        hdrs = "".join(f"{k}: {v}\r\n" for k, v in (f.get("http_headers") or {}).items())
        if hdrs:
            cmd += ["-headers", hdrs]
        if PROXY and PROXY.startswith("http"):
            cmd += ["-http_proxy", PROXY]
        cmd += ["-i", f["url"]]
    cmd += args + ["pipe:1"]

    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    errors: list[bytes] = []
    threading.Thread(target=lambda: errors.extend(proc.stderr), daemon=True).start()

    # Read the first block before answering: if ffmpeg fails early (bad source, blocked
    # request) we can still send a real error instead of a broken file.
    first = proc.stdout.read(CHUNK)
    if len(first) < CHUNK and proc.wait() != 0:
        detail = b"".join(errors[-6:]).decode(errors="replace").strip()
        raise ApiError("failed", detail or "The file couldn't be prepared.", 502)

    def gen():
        try:
            yield first
            while True:
                block = proc.stdout.read(CHUNK)
                if not block:
                    break
                yield block
        finally:
            if proc.poll() is None:
                proc.kill()

    out = Response(gen(), mimetype=mime)
    out.headers["Content-Disposition"] = disposition(filename)
    if estimate:
        out.headers["X-Estimated-Size"] = str(int(estimate))
    out.headers["Access-Control-Expose-Headers"] = "X-Estimated-Size, Content-Disposition"
    return out


@app.get("/api/download")
def download():
    url = check_url(request.args.get("url"))
    kind = request.args.get("type", "video")
    quality = request.args.get("quality", "best")
    fmt_out = request.args.get("format") or ("mp3" if kind == "audio" else "mp4")
    item = request.args.get("item", "")
    item = int(item) if item.isdigit() else None
    bitrate = request.args.get("bitrate", "192")
    bitrate = bitrate if bitrate in ("128", "192", "256", "320") else "192"

    if kind == "image":
        urls = gallery_urls(url)
        src = urls[min(max((item or 1) - 1, 0), len(urls) - 1)]
        ext = (re.search(r"\.(jpe?g|png|webp|heic|mp4)(?:\?|$)", src, re.I) or [None, "jpg"])[1].lower()
        ydl = yt_dlp.YoutubeDL(ydl_opts())  # left open: the response streams after we return
        return stream_direct(ydl, {"url": src}, safe_filename(f"photo {item or 1}", ext),
                             "video/mp4" if ext == "mp4" else f"image/{'jpeg' if ext == 'jpg' else ext}")

    if kind not in ("video", "audio") or fmt_out not in ("mp4", "mp3", "m4a"):
        raise ApiError("invalid", "Unsupported download option.")

    opts = ydl_opts(
        format=video_selector(quality) if kind == "video" else "ba[ext=m4a]/ba/b",
        noplaylist=item is None,
        playlist_items=str(item) if item else None,
    )
    ydl = yt_dlp.YoutubeDL(opts)
    try:
        meta = ydl.extract_info(url, download=False)
    except yt_dlp.utils.DownloadError as e:
        raise explain(e)
    if meta.get("entries") is not None:
        entries = [e for e in meta["entries"] if e]
        if not entries:
            raise ApiError("not_found", "That item couldn't be found.", 404)
        meta = entries[0]

    fmts = meta.get("requested_formats") or [meta]
    title = meta.get("title") or meta.get("id") or "download"
    duration = meta.get("duration") or 0
    approx = sum((f.get("filesize") or f.get("filesize_approx") or 0) for f in fmts) or None
    http_only = all(f.get("protocol", "https") in ("http", "https") for f in fmts)

    if kind == "video":
        name = safe_filename(title, "mp4")
        if len(fmts) == 1 and fmts[0].get("ext") == "mp4" and http_only:
            return stream_direct(ydl, fmts[0], name, "video/mp4")
        maps = ["-map", "0:v:0", "-map", "1:a:0"] if len(fmts) == 2 else ["-map", "0"]
        args = maps + ["-c", "copy", "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-f", "mp4"]
        return stream_ffmpeg(fmts, args, name, "video/mp4", approx)

    src = fmts[0]
    if fmt_out == "m4a":
        name = safe_filename(title, "m4a")
        if src.get("ext") == "m4a" and http_only:
            return stream_direct(ydl, src, name, "audio/mp4")
        copy = (src.get("acodec") or "").startswith("mp4a")
        args = ["-vn"] + (["-c:a", "copy"] if copy else ["-c:a", "aac", "-b:a", f"{bitrate}k"])
        args += ["-movflags", "frag_keyframe+empty_moov", "-f", "ipod"]
        return stream_ffmpeg([src], args, name, "audio/mp4", approx)

    name = safe_filename(title, "mp3")
    args = ["-vn", "-c:a", "libmp3lame", "-b:a", f"{bitrate}k", "-f", "mp3"]
    estimate = duration * int(bitrate) * 125 if duration else None
    return stream_ffmpeg([src], args, name, "audio/mpeg", estimate)


# --------------------------------------------------------------------------- #
# /api/thumb: some CDNs refuse hot-linked thumbnails, so relay those (images only).
# --------------------------------------------------------------------------- #
THUMB_HOSTS = (".cdninstagram.com", ".fbcdn.net", ".ytimg.com", ".tiktokcdn.com", ".tiktokcdn-us.com",
               ".twimg.com", ".redd.it", ".vimeocdn.com", ".sndcdn.com", ".pinimg.com", ".dmcdn.net")


@app.get("/api/thumb")
def thumb():
    src = request.args.get("src", "")
    host = urllib.parse.urlsplit(src).hostname or ""
    if not src.startswith("https://") or not any(host.endswith(h) or "." + host == h for h in THUMB_HOSTS):
        raise ApiError("invalid", "Not an allowed image host.", 400)
    try:
        with yt_dlp.YoutubeDL(ydl_opts()) as ydl:
            r = ydl.urlopen(YDLRequest(src))
            ctype = r.headers.get("Content-Type", "")
            body = r.read(5 * 1024 * 1024 + 1)
    except Exception as e:  # noqa: BLE001
        raise ApiError("failed", str(e), 502)
    if not ctype.startswith("image/") or len(body) > 5 * 1024 * 1024:
        raise ApiError("invalid", "Not an image.", 400)
    resp = Response(body, mimetype=ctype)
    resp.headers["Cache-Control"] = "public, max-age=86400"
    return resp


@app.get("/api/health")
def health():
    return jsonify(ok=True, yt_dlp=yt_dlp.version.__version__, proxy=bool(PROXY), cookies=bool(COOKIES))


# --------------------------------------------------------------------------- #
# Local development: also serve the static site from public/
# --------------------------------------------------------------------------- #
@app.get("/")
@app.get("/<path:path>")
def static_files(path: str = "index.html"):
    if path.startswith("api/"):
        raise ApiError("not_found", f"No API route for /{path}.", 404)
    target = PUBLIC / path
    if not target.is_file():
        path = "index.html"
    return send_from_directory(PUBLIC, path)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    print(f"\n  GrabIt  →  http://127.0.0.1:{port}\n")
    app.run(host="127.0.0.1", port=port, threaded=True)
