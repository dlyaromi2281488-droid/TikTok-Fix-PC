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
from http.server import HTTPServer, BaseHTTPRequestHandler
import websockets
import asyncio

# Import proxy relay
from tiktok_relay import TikTokProxyRelay

RELAY_PORT = 28888
API_PORT = 28889
DEBUG_PORT = 9222

relay = TikTokProxyRelay(bind_host="127.0.0.1", bind_port=RELAY_PORT)

class ReusableHTTPServer(HTTPServer):
    allow_reuse_address = True

class ApiHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)

        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
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
            page_url = qs.get("page", [""])[0]
            video_src = qs.get("src", [""])[0]
            try:
                downloads_dir = os.path.join(os.path.expanduser("~"), "Downloads")
                timestamp = int(time.time())
                filename = f"TikTok_{timestamp}.mp4"
                out_path = os.path.join(downloads_dir, filename)
                download_success = False

                # 1. Direct CDN link download with TikTok Referer
                if video_src and video_src.startswith("http") and not video_src.startswith("blob:"):
                    import requests
                    headers = {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
                        "Referer": "https://www.tiktok.com/",
                        "Range": "bytes=0-"
                    }
                    try:
                        r = requests.get(video_src, headers=headers, stream=True, timeout=25)
                        if r.status_code in [200, 206]:
                            with open(out_path, "wb") as f:
                                for chunk in r.iter_content(chunk_size=65536):
                                    f.write(chunk)
                            if os.path.exists(out_path) and os.path.getsize(out_path) > 30000:
                                download_success = True
                                resp = {"success": True, "filename": filename}
                    except Exception:
                        pass

                # 2. yt-dlp fallback with proxy relay
                if not download_success and page_url:
                    try:
                        import yt_dlp
                        ydl_opts = {
                            'outtmpl': out_path,
                            'proxy': f'socks5://127.0.0.1:{RELAY_PORT}',
                            'quiet': True,
                            'no_warnings': True,
                        }
                        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                            ydl.download([page_url])
                        if os.path.exists(out_path) and os.path.getsize(out_path) > 30000:
                            download_success = True
                            resp = {"success": True, "filename": filename}
                    except Exception:
                        pass

                # 3. yt-dlp direct fallback
                if not download_success and page_url:
                    try:
                        import yt_dlp
                        ydl_opts = {
                            'outtmpl': out_path,
                            'quiet': True,
                            'no_warnings': True,
                        }
                        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                            ydl.download([page_url])
                        if os.path.exists(out_path) and os.path.getsize(out_path) > 30000:
                            download_success = True
                            resp = {"success": True, "filename": filename}
                    except Exception:
                        pass

                if not download_success:
                    resp = {"success": False, "error": "Не удалось получить файл видео. Откройте видео на отдельной вкладке и повторите попытку."}

            except Exception as e:
                resp = {"success": False, "error": str(e)}

        elif parsed.path == "/api/download_audio":
            page_url = qs.get("page", [""])[0]
            audio_src = qs.get("audio_src", [""])[0]
            video_src = qs.get("src", [""])[0]
            try:
                downloads_dir = os.path.join(os.path.expanduser("~"), "Downloads")
                timestamp = int(time.time())
                filename = f"TikTok_Audio_{timestamp}.mp3"
                out_path = os.path.join(downloads_dir, filename)
                download_success = False

                # 1. Direct audio CDN link download
                if audio_src and audio_src.startswith("http") and not audio_src.startswith("blob:"):
                    import requests
                    headers = {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
                        "Referer": "https://www.tiktok.com/",
                        "Range": "bytes=0-"
                    }
                    try:
                        r = requests.get(audio_src, headers=headers, stream=True, timeout=25)
                        if r.status_code in [200, 206]:
                            with open(out_path, "wb") as f:
                                for chunk in r.iter_content(chunk_size=65536):
                                    f.write(chunk)
                            if os.path.exists(out_path) and os.path.getsize(out_path) > 10000:
                                download_success = True
                                resp = {"success": True, "filename": filename}
                    except Exception:
                        pass

                # 2. Extract audio via yt-dlp with proxy
                if not download_success and page_url:
                    try:
                        import yt_dlp
                        out_template = os.path.join(downloads_dir, f"TikTok_Audio_{timestamp}.%(ext)s")
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
                        }
                        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                            ydl.download([page_url])
                        if os.path.exists(out_path) and os.path.getsize(out_path) > 10000:
                            download_success = True
                            resp = {"success": True, "filename": filename}
                    except Exception:
                        pass

                # 3. Direct yt-dlp fallback
                if not download_success and page_url:
                    try:
                        import yt_dlp
                        out_template = os.path.join(downloads_dir, f"TikTok_Audio_{timestamp}.%(ext)s")
                        ydl_opts = {
                            'format': 'bestaudio/best',
                            'outtmpl': out_template,
                            'postprocessors': [{
                                'key': 'FFmpegExtractAudio',
                                'preferredcodec': 'mp3',
                                'preferredquality': '192',
                            }],
                            'quiet': True,
                            'no_warnings': True,
                        }
                        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                            ydl.download([page_url])
                        if os.path.exists(out_path) and os.path.getsize(out_path) > 10000:
                            download_success = True
                            resp = {"success": True, "filename": filename}
                    except Exception:
                        pass

                if not download_success:
                    resp = {"success": False, "error": "Не удалось скачать аудиодорожку."}

            except Exception as e:
                resp = {"success": False, "error": str(e)}

        elif parsed.path == "/api/translate":
            text = qs.get("text", [""])[0]
            target_lang = qs.get("to", ["ru"])[0]
            translated = ""
            if text:
                try:
                    import urllib.request, urllib.parse, json
                    url = 'https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=' + target_lang + '&q=' + urllib.parse.quote(text)
                    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
                    with urllib.request.urlopen(req, timeout=6) as r_trans:
                        data = json.loads(r_trans.read().decode('utf-8'))
                        if isinstance(data, list) and len(data) > 0:
                            if isinstance(data[0], list):
                                translated = data[0][0]
                            else:
                                translated = data[0]
                except Exception:
                    pass
                if not translated:
                    try:
                        import urllib.request, urllib.parse, json
                        url = f'https://api.mymemory.translated.net/get?q={urllib.parse.quote(text)}&langpair=auto|{target_lang}'
                        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                        with urllib.request.urlopen(req, timeout=6) as r_trans:
                            data = json.loads(r_trans.read().decode('utf-8'))
                            translated = data.get('responseData', {}).get('translatedText', '')
                    except Exception:
                        pass
            resp = {"success": bool(translated), "translated": translated or text}

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

async def inject_tab(ws_url, script_content):
    try:
        async with websockets.connect(ws_url, ping_interval=None, close_timeout=2) as ws:
            # Enable Page domain
            await ws.send(json.dumps({"id": 1, "method": "Page.enable"}))
            await ws.recv()

            # Add to evaluate on new document (persists across full navigations)
            await ws.send(json.dumps({
                "id": 2,
                "method": "Page.addScriptToEvaluateOnNewDocument",
                "params": {"source": script_content}
            }))
            await ws.recv()

            # Execute right now or trigger tick
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
                    try:
                        asyncio.run(inject_tab(ws_url, script_content))
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
    """Clean up processes and locks."""
    try:
        import psutil
        curr_pid = os.getpid()
        for p in psutil.process_iter(['pid', 'name', 'cmdline']):
            try:
                if p.info['pid'] == curr_pid:
                    continue
                cmd = ' '.join(p.info['cmdline'] or [])
                if 'tiktok_fix_profile' in cmd:
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
            script_content = f.read()

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
            "--lang=ru-RU,en-US",
            "--no-first-run",
            "--no-default-browser-check"
        ]

        try:
            proc = subprocess.Popen(args)
            proc.wait()
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
