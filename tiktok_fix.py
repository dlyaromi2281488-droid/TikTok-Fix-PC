import os
import sys

if getattr(sys, 'frozen', False):
    BASE_DIR = os.path.dirname(os.path.abspath(sys.executable))
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)
try:
    os.chdir(BASE_DIR)
except Exception:
    pass

import subprocess
import time
import threading
import json
import socket
import urllib.parse
from http.server import HTTPServer, ThreadingHTTPServer, BaseHTTPRequestHandler
import websockets
import asyncio

if sys.platform == "win32":
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    except Exception:
        pass

# Import proxy relay
from tiktok_relay import TikTokProxyRelay

RELAY_PORT = 28888
API_PORT = 28889
DEBUG_PORT = 9222

relay = TikTokProxyRelay(bind_host="127.0.0.1", bind_port=RELAY_PORT)

class ReusableHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True

class ApiHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.end_headers()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)

        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.end_headers()

        resp = {"success": True}
        if parsed.path == "/api/save_file":
            try:
                fname = qs.get("name", [f"TikTok_{int(time.time())}.mp4"])[0]
                length = int(self.headers.get("Content-Length", 0))
                data = self.rfile.read(length) if length > 0 else b""
                downloads_dir = os.path.join(os.path.expanduser("~"), "Downloads")
                out_path = os.path.join(downloads_dir, fname)
                with open(out_path, "wb") as f:
                    f.write(data)
                resp = {"success": True, "filename": fname, "bytes": len(data)}
            except Exception as e:
                resp = {"success": False, "error": str(e)}

        self.wfile.write(json.dumps(resp).encode('utf-8'))

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)

        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.end_headers()

        resp = {"success": True}

        if parsed.path == "/api/set_region":
            code = qs.get("code", ["FR"])[0]
            relay.set_region(code)
            resp["info"] = relay.get_current_info()

        elif parsed.path == "/api/reconnect":
            relay.rotate_current_region()
            resp["info"] = relay.get_current_info()

        elif parsed.path == "/api/clear_cache":
            profile_dir = os.path.join(BASE_DIR, "tiktok_fix_profile")
            cache_path = os.path.join(profile_dir, "Default", "Cache")
            if os.path.exists(cache_path):
                import shutil
                try:
                    shutil.rmtree(cache_path, ignore_errors=True)
                except Exception:
                    pass
            resp["cleared"] = True

        elif parsed.path == "/api/download":
            video_id = qs.get("id", [""])[0]
            page_url = qs.get("page", [""])[0]
            video_src = qs.get("src", [""])[0]
            raw_urls = qs.get("urls", ["[]"])[0]
            author = qs.get("author", [""])[0]
            cookie_str = qs.get("cookie", [""])[0]
            try:
                candidate_urls = []
                if video_src and video_src.startswith("http") and not video_src.startswith("blob:"):
                    candidate_urls.append(video_src)
                try:
                    import json
                    parsed_urls = json.loads(raw_urls)
                    if isinstance(parsed_urls, list):
                        for u in parsed_urls:
                            if u and isinstance(u, str) and u.startswith("http") and not u.startswith("blob:") and u not in candidate_urls:
                                candidate_urls.append(u)
                except Exception:
                    pass

                downloads_dir = os.path.join(os.path.expanduser("~"), "Downloads")
                name_id = video_id if video_id else int(time.time())
                filename = f"TikTok_{name_id}.mp4"
                out_path = os.path.join(downloads_dir, filename)
                download_success = False

                relay_proxies = {
                    "http": f"socks5h://127.0.0.1:{RELAY_PORT}",
                    "https": f"socks5h://127.0.0.1:{RELAY_PORT}"
                }
                headers = {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
                    "Referer": "https://www.tiktok.com/",
                }
                if cookie_str:
                    headers["Cookie"] = cookie_str

                # 1. Direct CDN stream download (Try direct first for unblocked line-speed, then proxy)
                import requests
                for v_url in candidate_urls:
                    for proxy in [None, relay_proxies]:
                        try:
                            r = requests.get(v_url, headers=headers, proxies=proxy, stream=True, timeout=8, allow_redirects=True)
                            if r.status_code in [200, 206]:
                                with open(out_path, "wb") as f:
                                    for chunk in r.iter_content(chunk_size=262144):
                                        f.write(chunk)
                                if os.path.exists(out_path) and os.path.getsize(out_path) > 30000:
                                    download_success = True
                                    resp = {"success": True, "filename": filename}
                                    break
                        except Exception:
                            continue
                    if download_success:
                        break

                # 2. yt-dlp fallback (with constructed single-video URL if needed)
                if not download_success:
                    target_url = None
                    if page_url and "/video/" in page_url:
                        target_url = page_url
                    elif video_id:
                        user_str = author if author else "tiktok"
                        target_url = f"https://www.tiktok.com/@{user_str}/video/{video_id}"

                    if target_url:
                        try:
                            import yt_dlp
                            out_template = os.path.join(downloads_dir, f"TikTok_{name_id}.%(ext)s")
                            ydl_opts = {
                                'outtmpl': out_template,
                                'proxy': f'socks5://127.0.0.1:{RELAY_PORT}',
                                'quiet': True,
                                'no_warnings': True,
                                'socket_timeout': 15,
                            }
                            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                                ydl.download([target_url])
                            for ext in ['mp4', 'webm', 'mkv']:
                                cand = os.path.join(downloads_dir, f"TikTok_{name_id}.{ext}")
                                if os.path.exists(cand) and os.path.getsize(cand) > 30000:
                                    download_success = True
                                    resp = {"success": True, "filename": os.path.basename(cand)}
                                    break
                        except Exception:
                            pass

                if not download_success:
                    resp = {"success": False, "error": "Не удалось загрузить видео."}

            except Exception as e:
                resp = {"success": False, "error": str(e)}

        elif parsed.path == "/api/download_audio":
            video_id = qs.get("id", [""])[0]
            page_url = qs.get("page", [""])[0]
            video_src = qs.get("src", [""])[0]
            audio_src = qs.get("audio_src", [""])[0]
            raw_urls = qs.get("urls", ["[]"])[0]
            author = qs.get("author", [""])[0]
            cookie_str = qs.get("cookie", [""])[0]
            try:
                candidate_urls = []
                if audio_src and audio_src.startswith("http") and not audio_src.startswith("blob:"):
                    candidate_urls.append(audio_src)
                try:
                    import json
                    parsed_urls = json.loads(raw_urls)
                    if isinstance(parsed_urls, list):
                        for u in parsed_urls:
                            if u and isinstance(u, str) and u.startswith("http") and not u.startswith("blob:") and u not in candidate_urls:
                                candidate_urls.append(u)
                except Exception:
                    pass

                downloads_dir = os.path.join(os.path.expanduser("~"), "Downloads")
                name_id = video_id if video_id else int(time.time())
                filename = f"TikTok_Audio_{name_id}.mp3"
                out_path = os.path.join(downloads_dir, filename)
                download_success = False

                relay_proxies = {
                    "http": f"socks5h://127.0.0.1:{RELAY_PORT}",
                    "https": f"socks5h://127.0.0.1:{RELAY_PORT}"
                }
                headers = {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
                    "Referer": "https://www.tiktok.com/",
                }
                if cookie_str:
                    headers["Cookie"] = cookie_str

                # 1. Direct audio CDN link download (FAST: <1s!) - Try direct first, then proxy
                import requests
                for a_url in candidate_urls:
                    for proxy in [None, relay_proxies]:
                        try:
                            r = requests.get(a_url, headers=headers, proxies=proxy, stream=True, timeout=8, allow_redirects=True)
                            if r.status_code in [200, 206]:
                                with open(out_path, "wb") as f:
                                    for chunk in r.iter_content(chunk_size=131072):
                                        f.write(chunk)
                                if os.path.exists(out_path) and os.path.getsize(out_path) > 5000:
                                    download_success = True
                                    resp = {"success": True, "filename": filename}
                                    break
                        except Exception:
                            continue
                    if download_success:
                        break

                # 2. Extract audio from video_src or page_url via yt-dlp
                if not download_success:
                    target_url = None
                    if page_url and "/video/" in page_url:
                        target_url = page_url
                    elif video_src and video_src.startswith("http") and not video_src.startswith("blob:"):
                        target_url = video_src
                    elif video_id:
                        user_str = author if author else "tiktok"
                        target_url = f"https://www.tiktok.com/@{user_str}/video/{video_id}"

                    if target_url:
                        try:
                            import yt_dlp
                            out_template = os.path.join(downloads_dir, f"TikTok_Audio_{name_id}.%(ext)s")
                            ydl_opts = {
                                'format': 'bestaudio/best',
                                'outtmpl': out_template,
                                'proxy': f'socks5://127.0.0.1:{RELAY_PORT}',
                                'postprocessors': [{
                                    'key': 'FFmpegExtractAudio',
                                    'preferredcodec': 'mp3',
                                    'preferredquality': '192',
                                }],
                                'quiet': True,
                                'no_warnings': True,
                                'socket_timeout': 15,
                            }
                            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                                ydl.download([target_url])
                            for ext in ['mp3', 'm4a', 'aac', 'ogg']:
                                cand = os.path.join(downloads_dir, f"TikTok_Audio_{name_id}.{ext}")
                                if os.path.exists(cand) and os.path.getsize(cand) > 5000:
                                    download_success = True
                                    resp = {"success": True, "filename": os.path.basename(cand)}
                                    break
                        except Exception:
                            pass

                if not download_success:
                    resp = {"success": False, "error": "Не удалось загрузить аудио."}

            except Exception as e:
                resp = {"success": False, "error": str(e)}

        self.wfile.write(json.dumps(resp).encode('utf-8'))

def start_api_server():
    global API_PORT
    for p in range(API_PORT, API_PORT + 10):
        try:
            server = ReusableHTTPServer(("127.0.0.1", p), ApiHandler)
            API_PORT = p
            server.serve_forever()
            break
        except Exception:
            continue

injected_targets = set()

async def inject_tab(ws_url, script_content, target_id):
    try:
        async with websockets.connect(ws_url, ping_interval=None, close_timeout=2) as ws:
            if target_id not in injected_targets:
                await ws.send(json.dumps({"id": 1, "method": "Page.enable"}))
                await ws.recv()
                await ws.send(json.dumps({
                    "id": 2,
                    "method": "Page.addScriptToEvaluateOnNewDocument",
                    "params": {"source": script_content}
                }))
                await ws.recv()
                injected_targets.add(target_id)

            eval_js = f"""
            if (!window.TIKTOK_FIX_ACTIVE) {{
                {script_content}
            }} else if (typeof window.tikTokFixTick === 'function') {{
                window.tikTokFixTick();
            }}
            """
            await ws.send(json.dumps({
                "id": 3,
                "method": "Runtime.evaluate",
                "params": {"expression": eval_js}
            }))
            await ws.recv()
    except Exception:
        pass

def cdp_injector_loop(script_content, stop_event):
    """CDP injector."""
    while not stop_event.is_set():
        try:
            import urllib.request
            resp = urllib.request.urlopen(f"http://127.0.0.1:{DEBUG_PORT}/json", timeout=2)
            targets = json.loads(resp.read().decode('utf-8'))
            for t in targets:
                if t.get('type') == 'page' and 'webSocketDebuggerUrl' in t:
                    ws_url = t['webSocketDebuggerUrl']
                    target_id = t.get('id', ws_url)
                    try:
                        asyncio.run(inject_tab(ws_url, script_content, target_id))
                    except Exception:
                        pass
        except Exception:
            pass
        time.sleep(1.5)

def find_browser():
    candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    return None

def cleanup_stale_processes():
    """Clean up processes, ports, and locks."""
    try:
        import psutil
        curr_pid = os.getpid()
        for p in psutil.process_iter(['pid', 'name']):
            try:
                if p.info['pid'] == curr_pid:
                    continue
                cmdline = p.cmdline()
                cmd = ' '.join(cmdline).lower()
                if 'tiktok_fix_profile' in cmd or 'tiktok_fix.py' in cmd:
                    p.kill()
            except Exception:
                continue
    except Exception:
        pass

    # Kill any processes still listening on our ports
    for port in [DEBUG_PORT, RELAY_PORT, API_PORT]:
        try:
            import psutil
            for conn in psutil.net_connections(kind='inet'):
                if conn.laddr.port == port and conn.pid:
                    try:
                        p = psutil.Process(conn.pid)
                        if p.pid != os.getpid():
                            p.kill()
                    except Exception:
                        pass
        except Exception:
            pass

    # Remove any Chrome singleton lock files
    base_dir = BASE_DIR
    profile_dir = os.path.join(base_dir, "tiktok_fix_profile")
    for lock_file in ["SingletonLock", "SingletonCookie", "SingletonSocket"]:
        p = os.path.join(profile_dir, lock_file)
        if os.path.exists(p):
            try:
                os.remove(p)
            except Exception:
                pass

def main():
    try:
        cleanup_stale_processes()
        relay.start()

        # Start HTTP API server
        api_thread = threading.Thread(target=start_api_server, daemon=True)
        api_thread.start()

        browser_exe = find_browser()
        if not browser_exe:
            print("Ошибка: Chrome или Edge не найдены.")
            return

        base_dir = BASE_DIR
        profile_dir = os.path.join(base_dir, "tiktok_fix_profile")
        extension_dir = os.path.join(base_dir, "extension")
        script_path = os.path.join(base_dir, "injected_script.js")
        os.makedirs(profile_dir, exist_ok=True)

        with open(script_path, "r", encoding="utf-8") as f:
            raw_script = f.read()
        script_content = f"window.__TIKTOK_FIX_API_PORT__ = {API_PORT};\n" + raw_script

        stop_event = threading.Event()
        injector_thread = threading.Thread(target=cdp_injector_loop, args=(script_content, stop_event), daemon=True)
        injector_thread.start()

        args = [
            browser_exe,
            "--app=https://www.tiktok.com",
            f"--proxy-server=socks5://127.0.0.1:{RELAY_PORT}",
            f"--user-data-dir={profile_dir}",
            f"--remote-debugging-port={DEBUG_PORT}",
            f"--load-extension={extension_dir}",
            f"--disable-extensions-except={extension_dir}",
            "--enable-extensions",
            "--disable-quic",
            "--test-type",
            "--disable-infobars",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-blink-features=AutomationControlled",
            "--lang=ru-RU,en-US"
        ]

        try:
            proc = subprocess.Popen(args)
            time.sleep(2)
            
            # Supervise: keep running as long as TikTok Chrome window is open
            import psutil
            while True:
                time.sleep(1.5)
                chrome_alive = False
                for p in psutil.process_iter(['name', 'cmdline']):
                    try:
                        name = (p.info.get('name') or '').lower()
                        if 'chrome' in name or 'edge' in name:
                            cmd = ' '.join(p.info.get('cmdline') or []).lower()
                            if 'tiktok_fix_profile' in cmd:
                                chrome_alive = True
                                break
                    except Exception:
                        pass
                if not chrome_alive:
                    break
        finally:
            stop_event.set()
            relay.stop()
    except Exception as e:
        base_dir = BASE_DIR
        with open(os.path.join(base_dir, "crash.log"), "a", encoding="utf-8") as f:
            import traceback
            f.write(traceback.format_exc() + "\n")

if __name__ == "__main__":
    main()
