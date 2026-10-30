import asyncio
import threading
import time
import socket
import sys

# Use Windows Selector Event Loop on Windows to eliminate WinError 10054 crashes
if sys.platform == "win32":
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    except Exception:
        pass

# SOCKS5 proxy pool by region (tested & verified for www.tiktok.com)
PROXY_REGIONS = {
    "DE": [
        ("49.13.22.249", 10805),
        ("5.75.133.113", 10806),
        ("91.107.179.68", 10809),
    ],
    "NL": [
        ("45.74.31.46", 6218),
        ("45.74.31.40", 11615),
        ("45.74.31.46", 9530),
        ("45.74.31.40", 9544),
        ("45.74.31.40", 13451),
    ],
    "US": [
        ("69.55.49.177", 38182),
        ("72.223.61.88", 1080),
        ("141.148.153.100", 10808),
    ],
    "FR": [
        ("51.15.111.198", 1080),
        ("51.158.111.229", 1080),
        ("207.180.217.98", 1088),
    ],
    "GB": [
        ("178.62.24.96", 1080),
        ("46.101.59.84", 1080),
    ],
    "PL": [
        ("178.217.171.189", 1080),
        ("185.204.1.171", 1080),
    ],
    "SE": [
        ("185.244.195.148", 1080),
        ("193.180.119.14", 1080),
    ],
    "JP": [
        ("103.100.158.115", 10809),
        ("202.218.2.19", 50000),
        ("133.18.234.13", 1080),
    ],
    "SG": [
        ("8.219.245.123", 1080),
        ("128.199.202.122", 1080),
    ],
}

# Direct CDN domains and subdomains
DIRECT_CDN_DOMAINS = [
    "tiktokcdn.com",
    "tiktokcdn-eu.com",
    "tiktokcdn-us.com",
    "byteoversea.com",
    "ibyteimg.com",
    "ibytedtos.com",
    "akamaized.net",
    "cloudfront.net",
    "ttwstatic.com",
]

def is_direct_candidate(host):
    if not host:
        return False
    host = host.lower()
    # Streaming video & audio chunks are fully accessible in RU and stream at full speed directly
    if any(host.startswith(prefix) for prefix in [
        "v16-", "v19-", "webapp-", "sf16-", "p16-", "p19-", "mon-", "mcs-", "starling-", "ibytedtos-"
    ]):
        return True
    for d in DIRECT_CDN_DOMAINS:
        if host == d or host.endswith("." + d):
            return True
    return False

class TikTokProxyRelay:
    def __init__(self, bind_host="127.0.0.1", bind_port=28888):
        self.bind_host = bind_host
        self.bind_port = bind_port
        self.active_region = "DE"
        self.upstream_host, self.upstream_port = PROXY_REGIONS["DE"][0]
        self.proxy_index = 0
        self.server = None
        self.loop = None
        self.thread = None
        self.running = False

    def get_current_info(self):
        if self.active_region == "DIRECT":
            return {"region": "RU", "name": "Россия (Прямой)", "host": "Direct", "status": "Прямое подключение"}
        names = {
            "DE": "Германия",
            "NL": "Нидерланды",
            "FR": "Франция",
            "US": "США",
            "GB": "Великобритания",
            "PL": "Польша",
            "SE": "Швеция",
            "JP": "Япония",
            "SG": "Сингапур",
        }
        rname = names.get(self.active_region, self.active_region)
        return {
            "region": self.active_region,
            "name": rname,
            "host": f"{self.upstream_host}:{self.upstream_port}",
            "status": f"Активно ({rname})"
        }

    def set_region(self, region_code):
        if region_code == "DIRECT":
            self.active_region = "DIRECT"
            print("[TikTok Fix Relay] Mode: DIRECT", flush=True)
            return
        if region_code in PROXY_REGIONS:
            self.active_region = region_code
            self.proxy_index = 0
            self.upstream_host, self.upstream_port = PROXY_REGIONS[region_code][0]
            print(f"[TikTok Fix Relay] Switched to {region_code} -> {self.upstream_host}:{self.upstream_port}", flush=True)

    def rotate_current_region(self):
        if self.active_region in PROXY_REGIONS:
            pool = PROXY_REGIONS[self.active_region]
            self.proxy_index = (self.proxy_index + 1) % len(pool)
            self.upstream_host, self.upstream_port = pool[self.proxy_index]
            print(f"[TikTok Fix Relay] Rotated proxy: {self.upstream_host}:{self.upstream_port}", flush=True)

    def get_candidates(self):
        if self.active_region not in PROXY_REGIONS:
            return [("5.75.133.113", 10813), ("45.74.31.40", 8684), ("69.55.49.177", 38182)]
        pool = PROXY_REGIONS[self.active_region]
        cands = [(self.upstream_host, self.upstream_port)]
        for h, p in pool:
            if (h, p) not in cands:
                cands.append((h, p))
        # Add high-speed verified German, Dutch & US master fallbacks
        master_fallbacks = [("49.13.22.249", 10805), ("5.75.133.113", 10806), ("45.74.31.46", 6218), ("69.55.49.177", 38182)]
        for fb in master_fallbacks:
            if fb not in cands:
                cands.append(fb)
        return cands

    async def pipe(self, reader, writer):
        try:
            while True:
                data = await reader.read(65536)
                if not data:
                    break
                writer.write(data)
                await writer.drain()
        except Exception:
            pass

    async def forward_duplex(self, r1, w1, r2, w2):
        """Full-duplex forwarding that handles streaming video chunks smoothly."""
        t1 = asyncio.create_task(self.pipe(r1, w2))
        t2 = asyncio.create_task(self.pipe(r2, w1))
        await asyncio.wait([t1, t2], return_when=asyncio.FIRST_COMPLETED)
        t1.cancel()
        t2.cancel()
        for w in [w1, w2]:
            try:
                w.close()
            except Exception:
                pass

    async def handle_client(self, client_reader, client_writer):
        try:
            # 1. SOCKS5 handshake with client
            ver, nmethods = await client_reader.readexactly(2)
            methods = await client_reader.readexactly(nmethods)
            client_writer.write(bytes([5, 0])) # No auth required
            await client_writer.drain()

            # 2. Destination request
            ver, cmd, rsv, atyp = await client_reader.readexactly(4)
            req_body = bytes([ver, cmd, rsv, atyp])
            dest_host = None
            dest_port = None
            if atyp == 1: # IPv4
                dest_ip_bytes = await client_reader.readexactly(4)
                dest_port_bytes = await client_reader.readexactly(2)
                dest_host = socket.inet_ntoa(dest_ip_bytes)
                dest_port = int.from_bytes(dest_port_bytes, "big")
                req_body += dest_ip_bytes + dest_port_bytes
            elif atyp == 3: # Domain
                dom_len = (await client_reader.readexactly(1))[0]
                dom_bytes = await client_reader.readexactly(dom_len)
                dest_port_bytes = await client_reader.readexactly(2)
                dest_host = dom_bytes.decode("utf-8", errors="ignore")
                dest_port = int.from_bytes(dest_port_bytes, "big")
                req_body += bytes([dom_len]) + dom_bytes + dest_port_bytes
            elif atyp == 4: # IPv6
                dest_ip_bytes = await client_reader.readexactly(16)
                dest_port_bytes = await client_reader.readexactly(2)
                dest_host = socket.inet_ntop(socket.AF_INET6, dest_ip_bytes)
                dest_port = int.from_bytes(dest_port_bytes, "big")
                req_body += dest_ip_bytes + dest_port_bytes

            # 3. Smart routing:
            # Direct connection for media CDNs or if DIRECT mode is selected
            use_direct = (self.active_region == "DIRECT") or is_direct_candidate(dest_host)

            if use_direct:
                try:
                    target_reader, target_writer = await asyncio.wait_for(
                        asyncio.open_connection(dest_host, dest_port),
                        timeout=5.0
                    )
                    client_writer.write(bytes([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]))
                    await client_writer.drain()
                    await self.forward_duplex(client_reader, client_writer, target_reader, target_writer)
                    return
                except Exception:
                    pass

            # 4. Proxy routing with automatic fallback
            candidates = self.get_candidates()
            for cand_host, cand_port in candidates:
                try:
                    up_reader, up_writer = await asyncio.wait_for(
                        asyncio.open_connection(cand_host, cand_port),
                        timeout=2.2
                    )

                    # Upstream SOCKS5 handshake
                    up_writer.write(bytes([5, 1, 0]))
                    await up_writer.drain()
                    up_resp = await asyncio.wait_for(up_reader.readexactly(2), timeout=2.0)
                    if up_resp != bytes([5, 0]):
                        up_writer.close()
                        continue

                    # Forward connection request to upstream
                    up_writer.write(req_body)
                    await up_writer.drain()

                    # Read response from upstream
                    resp_hdr = await asyncio.wait_for(up_reader.readexactly(4), timeout=2.5)
                    if resp_hdr[1] != 0: # SOCKS reply not succeeded
                        up_writer.close()
                        continue

                    client_writer.write(resp_hdr)
                    uatyp = resp_hdr[3]
                    if uatyp == 1:
                        dest = await up_reader.readexactly(6)
                        client_writer.write(dest)
                    elif uatyp == 3:
                        dom_len = (await up_reader.readexactly(1))[0]
                        dom = await up_reader.readexactly(dom_len + 2)
                        client_writer.write(bytes([dom_len]) + dom)
                    elif uatyp == 4:
                        dest = await up_reader.readexactly(18)
                        client_writer.write(dest)
                    await client_writer.drain()

                    # Success - stream duplex
                    self.upstream_host, self.upstream_port = cand_host, cand_port
                    await self.forward_duplex(client_reader, client_writer, up_reader, up_writer)
                    return
                except Exception:
                    continue

            # 5. Last resort fallback: direct connection
            try:
                target_reader, target_writer = await asyncio.wait_for(
                    asyncio.open_connection(dest_host, dest_port),
                    timeout=5.0
                )
                client_writer.write(bytes([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]))
                await client_writer.drain()
                await self.forward_duplex(client_reader, client_writer, target_reader, target_writer)
            except Exception:
                pass

        except Exception:
            pass
        finally:
            try:
                client_writer.close()
            except Exception:
                pass

    def _run_loop(self):
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        
        async def starter():
            for attempt in range(10):
                try:
                    self.server = await asyncio.start_server(self.handle_client, self.bind_host, self.bind_port)
                    print(f"[TikTok Fix Relay] Listening on {self.bind_host}:{self.bind_port}", flush=True)
                    self.running = True
                    break
                except OSError:
                    await asyncio.sleep(0.5)
            if self.server:
                async with self.server:
                    await self.server.serve_forever()

        try:
            self.loop.run_until_complete(starter())
        except Exception:
            pass

    def start(self):
        if self.running:
            return
        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()
        # Wait until server is listening
        for _ in range(30):
            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                s.settimeout(0.2)
                s.connect((self.bind_host, self.bind_port))
                s.close()
                self.running = True
                break
            except Exception:
                time.sleep(0.1)

    def stop(self):
        self.running = False
        if self.loop and self.server:
            self.loop.call_soon_threadsafe(self.server.close)


# Backward compatibility alias
CatTokProxyRelay = TikTokProxyRelay
