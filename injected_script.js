// =========================================================================
// TikTok Fix Core Injected Engine v2.4
// Pure Native TikTok Style (Zero Emojis, Native Fonts & Themes)
// Features: Feed 2026, Dates, Reposts, Downloader (MP4 + MP3),
//           PiP Feed Scrolling (Wheel / Arrows / Auto-Advance), Hotkeys (Rewind, Speed, PiP), Mouse Wheel Volume
// =========================================================================
(function() {
    window.TIKTOK_FIX_ACTIVE = true;

    // Safe storage helper (prevents SecurityError if storage is partitioned/restricted)
    function safeStorageGet(key, defVal) {
        try {
            if (typeof window !== 'undefined' && 'localStorage' in window && window.localStorage) {
                let v = window.localStorage.getItem(key);
                return v !== null ? v : defVal;
            }
        } catch (e) {}
        return defVal;
    }

    function safeStorageSet(key, val) {
        try {
            if (typeof window !== 'undefined' && 'localStorage' in window && window.localStorage) {
                window.localStorage.setItem(key, String(val));
            }
        } catch (e) {}
    }

    // Load user preferences safely
    let blockAds = safeStorageGet("tf_block_ads", "true") !== "false";
    let blockStreams = safeStorageGet("tf_block_streams", "true") !== "false";
    let blockPhotos = safeStorageGet("tf_block_photos", "true") !== "false";
    let currentRegion = safeStorageGet("tf_region", "DE");

    // Global cache for intercepted video direct download URLs
    window.__TIKTOK_FIX_VIDEOS = window.__TIKTOK_FIX_VIDEOS || new Map();

    function captureVideoItems(data) {
        if (!data || typeof data !== 'object') return;
        let items = data.itemList || (data.itemInfo && [data.itemInfo.itemStruct]) || data.aweme_list || [];
        if (!Array.isArray(items)) return;
        items.forEach(it => {
            if (it && it.id) {
                let vid = it.video || {};
                let url = (typeof vid.playAddr === 'string' ? vid.playAddr : (vid.playAddr?.urlList?.[0])) ||
                          (typeof vid.downloadAddr === 'string' ? vid.downloadAddr : (vid.downloadAddr?.urlList?.[0])) ||
                          (vid.bitrate?.[vid.bitrate.length - 1]?.playAddr?.urlList?.[0]) || '';
                let musicUrl = it.music?.playUrl || (it.music?.playUrl?.urlList?.[0]) || '';
                if (url || musicUrl) {
                    window.__TIKTOK_FIX_VIDEOS.set(String(it.id), {
                        id: String(it.id),
                        url: url,
                        audioUrl: musicUrl,
                        author: it.author?.uniqueId || '',
                        desc: it.desc || ''
                    });
                }
            }
        });
    }

    // Intercept fetch to automatically harvest clean video CDN links from feed responses
    let origFetch = window.fetch;
    window.fetch = async function(...args) {
        let resp = await origFetch.apply(this, args);
        try {
            let clone = resp.clone();
            let url = (args[0] && args[0].url) || args[0] || '';
            if (typeof url === 'string' && (url.includes('item') || url.includes('feed') || url.includes('detail') || url.includes('repost'))) {
                clone.json().then(captureVideoItems).catch(() => {});
            }
        } catch(e) {}
        return resp;
    };

    // Intercept XMLHttpRequest for legacy and background requests
    try {
        let origXhrOpen = XMLHttpRequest.prototype.open;
        let origXhrSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function(method, url) {
            this._tf_url = url;
            return origXhrOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function() {
            this.addEventListener('load', function() {
                try {
                    let u = this._tf_url || '';
                    if (typeof u === 'string' && (u.includes('item') || u.includes('feed') || u.includes('detail'))) {
                        let data = JSON.parse(this.responseText);
                        captureVideoItems(data);
                    }
                } catch(e) {}
            });
            return origXhrSend.apply(this, arguments);
        };
    } catch(e) {}

    // -------------------------------------------------------------
    // Helper: Convert Unix Timestamp to DD.MM.YYYY
    // -------------------------------------------------------------
    function formatTimestamp(ts) {
        if (!ts) return null;
        if (ts > 1000000000000) ts = Math.floor(ts / 1000);
        if (ts < 1400000000 || ts > 2200000000) return null;
        let d = new Date(ts * 1000);
        let day = String(d.getDate()).padStart(2, '0');
        let month = String(d.getMonth() + 1).padStart(2, '0');
        let year = d.getFullYear();
        return `${day}.${month}.${year}`;
    }

    function getDateFromVideoId(videoId) {
        try {
            if (!videoId) return null;
            let str = String(videoId).trim();
            if (str.length < 15) return null;
            let ts = Number(BigInt(str) >> 32n);
            return formatTimestamp(ts);
        } catch(e) {
            return null;
        }
    }

    // -------------------------------------------------------------
    // Helper: Extract Video Info from React Fiber
    // -------------------------------------------------------------
    function getVideoDataFromElement(el) {
        let curr = el;
        let depth = 0;
        while (curr && depth < 12) {
            for (let k in curr) {
                if (k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')) {
                    let fiber = curr[k];
                    let fdepth = 0;
                    while (fiber && fdepth < 25) {
                        let p = fiber.memoizedProps;
                        if (p) {
                            let item = p.itemStruct || p.itemInfo?.itemStruct || p.itemInfo || p.item || p.videoData || p.aweme || p.post || p.videoInfo;
                            if (item) {
                                if (item.itemStruct) item = item.itemStruct;
                                if (item.id || item.video || item.desc) return item;
                            }
                            if (p.id && String(p.id).length >= 18) return p;
                            if (p.video && (p.video.playAddr || p.video.downloadAddr)) return p;
                        }
                        let s = fiber.memoizedState;
                        if (s && typeof s === 'object') {
                            let item = s.itemStruct || s.itemInfo?.itemStruct || s.item;
                            if (item && (item.id || item.video)) return item;
                        }
                        fiber = fiber.return;
                        fdepth++;
                    }
                }
            }
            curr = curr.parentElement;
            depth++;
        }
        return null;
    }

    // -------------------------------------------------------------
    // Helper: Extract items from SSR rehydration scripts
    // -------------------------------------------------------------
    let rehydrationCache = null;
    function getRehydrationItems() {
        if (rehydrationCache && rehydrationCache.length > 0) return rehydrationCache;
        try {
            let script = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
            if (script && script.textContent) {
                let data = JSON.parse(script.textContent);
                let items = [];
                let defaultScope = data['__DEFAULT_SCOPE__'];
                if (defaultScope) {
                    for (let key in defaultScope) {
                        let obj = defaultScope[key];
                        if (obj && obj.itemList && Array.isArray(obj.itemList)) {
                            items.push(...obj.itemList);
                        }
                        if (obj && obj.itemInfo && obj.itemInfo.itemStruct) {
                            items.push(obj.itemInfo.itemStruct);
                        }
                    }
                }
                let webapp = data['webapp.video-detail'];
                if (webapp && webapp.itemInfo && webapp.itemInfo.itemStruct) {
                    items.push(webapp.itemInfo.itemStruct);
                }
                let feed = data['webapp.user-detail'];
                if (feed && feed.itemList) {
                    items.push(...feed.itemList);
                }
                let sigil = document.getElementById('SIGI_STATE');
                if (sigil && sigil.textContent) {
                    let sdata = JSON.parse(sigil.textContent);
                    let scope = sdata.ItemModule;
                    if (scope) {
                        for (let k in scope) items.push(scope[k]);
                    }
                    if (scope && scope.itemList) {
                        items.push(...scope.itemList);
                    }
                }
                rehydrationCache = items;
                return items;
            }
        } catch(e) {}
        return [];
    }

    // -------------------------------------------------------------
    // Helper: Get Active / Playing Video Element
    // -------------------------------------------------------------
    function getActiveVideo() {
        let videos = Array.from(document.querySelectorAll('video'));
        if (!videos.length) return null;
        let active = videos.find(v => !v.paused && v.currentTime > 0);
        if (active) return active;
        let midY = window.innerHeight / 2;
        let midX = window.innerWidth / 2;
        let best = null, minDist = 999999;
        for (let v of videos) {
            let r = v.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
                let dist = Math.abs((r.top + r.height / 2) - midY) + Math.abs((r.left + r.width / 2) - midX);
                if (dist < minDist) {
                    minDist = dist;
                    best = v;
                }
            }
        }
        return best || videos[0];
    }

    // -------------------------------------------------------------
    // Floating Notification (Isolated in body, Zero DOM issues)
    // -------------------------------------------------------------
    function showVideoToast(text) {
        let existing = document.getElementById('tf-global-toast');
        if (existing) existing.remove();

        let toast = document.createElement('div');
        toast.id = 'tf-global-toast';
        toast.textContent = text;
        toast.style.cssText = `
            position: fixed !important;
            top: 70px !important;
            left: 50% !important;
            transform: translateX(-50%) !important;
            background: rgba(18, 18, 26, 0.92) !important;
            backdrop-filter: blur(12px) !important;
            border: 1px solid rgba(255, 255, 255, 0.22) !important;
            color: #ffffff !important;
            padding: 8px 24px !important;
            border-radius: 20px !important;
            font-size: 14px !important;
            font-weight: 600 !important;
            z-index: 2147483647 !important;
            pointer-events: none !important;
            font-family: TikTokSans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
            box-shadow: 0 8px 30px rgba(0,0,0,0.6) !important;
            transition: opacity 0.25s ease !important;
            opacity: 1 !important;
            user-select: none !important;
        `;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 250);
        }, 800);
    }

    // -------------------------------------------------------------
    // 1. Publication Date (Guaranteed NO duplicates, NEVER touches avatar)
    // -------------------------------------------------------------
    function updateVideoDates() {
        let cards = Array.from(document.querySelectorAll('article[data-e2e="recommend-list-item-container"], div[class*="ItemContainer"], [data-e2e="recommend-list-item"]'));
        if (!cards.length) {
            cards = [document.body];
        }

        cards.forEach(card => {
            // NEVER add more than one date badge to the same video card!
            if (card.querySelector('.tiktok-fix-date')) return;

            let author = card.querySelector('[data-e2e="video-author-uniqueid"]') ||
                         card.querySelector('div[data-e2e="video-author-info"] a') ||
                         card.querySelector('div[class*="DivCreatorInfoContainer"] a');
            if (!author) return;

            // Never attach to avatar
            if (author.getAttribute('data-e2e') === 'video-author-avatar' ||
                author.closest('[data-e2e="video-author-avatar"]') ||
                author.querySelector('img') ||
                author.closest('div[class*="Avatar"]')) {
                return;
            }

            let dateStr = null;
            let itemData = getVideoDataFromElement(author) || getVideoDataFromElement(card);
            if (itemData) {
                if (itemData.createTime) dateStr = formatTimestamp(itemData.createTime);
                else if (itemData.id) dateStr = getDateFromVideoId(itemData.id);
            }

            if (!dateStr) {
                let link = card.querySelector('a[href*="/video/"]');
                if (link) {
                    let m = link.href.match(/\/video\/(\d+)/);
                    if (m) dateStr = getDateFromVideoId(m[1]);
                }
            }

            if (!dateStr && window.location.href.includes('/video/')) {
                let m = window.location.href.match(/\/video\/(\d+)/);
                if (m) dateStr = getDateFromVideoId(m[1]);
            }

            if (dateStr) {
                let badge = document.createElement('span');
                badge.className = 'tiktok-fix-date';
                badge.textContent = `· ${dateStr}`;
                badge.style.cssText = `
                    display: inline-block !important;
                    margin-left: 6px !important;
                    font-size: 13px !important;
                    font-weight: 500 !important;
                    color: rgba(255, 255, 255, 0.65) !important;
                    vertical-align: baseline !important;
                    line-height: 1 !important;
                    pointer-events: auto !important;
                    user-select: text !important;
                    font-family: TikTokSans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
                `;
                author.insertAdjacentElement('afterend', badge);
            }
        });
    }

    // -------------------------------------------------------------
    // 2. Unhide & Enable Repost Tab ("Репосты") in User Profiles
    // -------------------------------------------------------------
    function updateRepostTab() {
        if (!document.body || !window.location.href.includes('/@')) return;

        let repostTab = document.querySelector('[data-e2e="repost-tab"]');
        if (repostTab) {
            if (repostTab.style.display === 'none' || window.getComputedStyle(repostTab).display === 'none') {
                repostTab.style.setProperty('display', 'inline-flex', 'important');
                repostTab.style.setProperty('visibility', 'visible', 'important');
                repostTab.style.setProperty('opacity', '1', 'important');
                repostTab.style.cursor = 'pointer';
            }
        } else {
            let tabBar = document.querySelector('div[class*="DivVideoFeedTab"]');
            if (tabBar && !document.getElementById('tf-custom-repost-tab')) {
                let sampleTab = tabBar.querySelector('[role="tab"]');
                let tab = document.createElement('p');
                tab.id = 'tf-custom-repost-tab';
                tab.role = 'tab';
                tab.tabIndex = 0;
                tab.className = sampleTab ? sampleTab.className : 'css-11y9b6f-7937d88b--PTabItem e1fq0y1c3';
                tab.style.cssText = 'display: inline-flex !important; cursor: pointer; align-items: center; justify-content: center;';
                tab.innerHTML = `<span>Репосты</span>`;

                tab.onclick = () => {
                    tabBar.querySelectorAll('[role="tab"]').forEach(t => t.setAttribute('aria-selected', 'false'));
                    tab.setAttribute('aria-selected', 'true');
                    try {
                        let match = window.location.pathname.match(/@([^/?#]+)/);
                        if (match) {
                            let secUid = window.__UNIVERSAL_DATA_FOR_REHYDRATION__?.['__DEFAULT_SCOPE__']?.['webapp.user-detail']?.userInfo?.user?.secUid || '';
                            fetch(`https://www.tiktok.com/api/user/repost/item_list/?secUid=${encodeURIComponent(secUid)}&count=30&cursor=0`)
                                .then(r => r.json())
                                .then(data => {
                                    if (data && data.itemList && data.itemList.length > 0) {
                                        let grid = document.querySelector('div[data-e2e="user-post-item-list"], div[class*="DivVideoFeed"]');
                                        if (grid) {
                                            grid.innerHTML = '';
                                            data.itemList.forEach(item => {
                                                let card = document.createElement('div');
                                                card.className = 'css-1s72gbg-7937d88b--DivItemContainer e19c29qe7';
                                                card.style.cssText = 'position: relative; border-radius: 8px; overflow: hidden; cursor: pointer; aspect-ratio: 9/16; background: #222;';
                                                let cover = (item.video && item.video.cover) ? item.video.cover.url_list[0] : '';
                                                card.innerHTML = `
                                                    <a href="/@${item.author.uniqueId}/video/${item.id}" style="display: block; width: 100%; height: 100%;">
                                                        <img src="${cover}" style="width: 100%; height: 100%; object-fit: cover;" />
                                                        <div style="position: absolute; bottom: 8px; left: 8px; font-size: 12px; color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,0.8);">
                                                            @${item.author.uniqueId}
                                                        </div>
                                                    </a>
                                                `;
                                                grid.appendChild(card);
                                            });
                                        }
                                    }
                                });
                        }
                    } catch(e) {}
                };

                let favTab = tabBar.querySelector('[data-e2e="favorites-tab"], [data-e2e="liked-tab"]');
                if (favTab) {
                    tabBar.insertBefore(tab, favTab);
                } else {
                    tabBar.appendChild(tab);
                }
            }
        }
    }

    // -------------------------------------------------------------
    // 3. Clean up Profile Backgrounds (Native Profile Header)
    // -------------------------------------------------------------
    function cleanupProfileBanners() {
        document.querySelectorAll('#tiktok-fix-banner, #tiktok-fix-banner-bg, #tf-change-banner-btn').forEach(el => el.remove());
        let profileHeaders = document.querySelectorAll('div[class*="ShareHeader"], div[class*="DivHeaderContainer"]');
        profileHeaders.forEach(header => {
            header.style.removeProperty('border-radius');
            header.style.removeProperty('padding');
            header.style.removeProperty('margin-top');
            header.style.removeProperty('margin-bottom');
            header.style.removeProperty('border');
            header.style.removeProperty('box-shadow');
            header.style.removeProperty('background-color');
            header.style.removeProperty('position');
            header.style.removeProperty('z-index');
            header.style.removeProperty('overflow');
        });
    }

    // -------------------------------------------------------------
    // 4. Content Filters (Ads, Streams, Photos)
    // -------------------------------------------------------------
    function filterContent() {
        if (!document.body) return;
        if (blockAds) {
            document.querySelectorAll('div[data-e2e="ad-badge"], div:has(> [data-e2e="ad-badge"])').forEach(el => {
                let card = el.closest('article[data-e2e="recommend-list-item-container"]') || el.closest('[data-e2e="recommend-list-item"]') || el.closest('div[class*="ItemContainer"]');
                if (card) card.style.display = 'none';
            });
        }
        if (blockStreams) {
            document.querySelectorAll('a[href*="/live"], div[data-e2e="live-card"]').forEach(el => {
                let card = el.closest('article[data-e2e="recommend-list-item-container"]') || el.closest('[data-e2e="recommend-list-item"]') || el.closest('div[class*="ItemContainer"]');
                if (card) card.style.display = 'none';
            });
        }
        if (blockPhotos) {
            document.querySelectorAll('div[data-e2e="photo-mode-indicator"]').forEach(el => {
                let card = el.closest('article[data-e2e="recommend-list-item-container"]') || el.closest('[data-e2e="recommend-list-item"]') || el.closest('div[class*="ItemContainer"]');
                if (card) card.style.display = 'none';
            });
        }
    }

    // -------------------------------------------------------------
    // 5. Volume Control via Mouse Wheel directly on video
    // -------------------------------------------------------------
    function bindVideoVolume() {
        if (!document.body) return;
        let videos = document.querySelectorAll('video');
        videos.forEach(v => {
            if (v.dataset.tfVolBound) return;
            v.dataset.tfVolBound = 'true';

            v.addEventListener('wheel', function(e) {
                e.preventDefault();
                e.stopPropagation();
                let step = 0.05;
                let cur = v.volume;
                let newVol = cur + (e.deltaY < 0 ? step : -step);
                newVol = Math.max(0, Math.min(1, Math.round(newVol * 100) / 100));
                v.volume = newVol;
                if (newVol > 0 && v.muted) v.muted = false;
                if (newVol === 0) v.muted = true;
                safeStorageSet('tf_volume', newVol);
                showVideoToast(`Громкость: ${Math.round(newVol * 100)}%`);
            }, { passive: false });
        });
    }

    // -------------------------------------------------------------
    // Helper: Collect all video items from JSON scripts and cache
    // -------------------------------------------------------------
    function collectAllKnownItems() {
        let items = [];
        let seenIds = new Set();

        function add(it) {
            if (!it) return;
            let id = it.id || (it.itemStruct && it.itemStruct.id);
            if (!id) return;
            id = String(id);
            if (seenIds.has(id)) return;
            seenIds.add(id);

            let real = it.itemStruct || it;
            let vid = real.video || {};
            let url = (typeof vid.playAddr === 'string' ? vid.playAddr : (vid.playAddr?.urlList?.[0])) ||
                      (typeof vid.downloadAddr === 'string' ? vid.downloadAddr : (vid.downloadAddr?.urlList?.[0])) ||
                      (vid.bitrate?.[vid.bitrate.length - 1]?.playAddr?.urlList?.[0]) || '';
            let musicUrl = real.music?.playUrl || (real.music?.playUrl?.urlList?.[0]) || '';

            items.push({
                id: id,
                author: real.author?.uniqueId || '',
                desc: real.desc || '',
                url: url,
                audioUrl: musicUrl,
                createTime: real.createTime || 0
            });
        }

        // 1. From __UNIVERSAL_DATA_FOR_REHYDRATION__
        try {
            let script = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
            if (script && script.textContent) {
                let data = JSON.parse(script.textContent);
                function deepFindItems(obj, d) {
                    if (!obj || typeof obj !== 'object' || d > 6) return;
                    if (Array.isArray(obj)) {
                        for (let el of obj) deepFindItems(el, d + 1);
                    } else {
                        if (obj.itemList && Array.isArray(obj.itemList)) {
                            obj.itemList.forEach(add);
                        }
                        if (obj.itemInfo && obj.itemInfo.itemStruct) {
                            add(obj.itemInfo.itemStruct);
                        }
                        if (obj.id && (obj.video || obj.music)) {
                            add(obj);
                        }
                        for (let k in obj) {
                            if (typeof obj[k] === 'object') deepFindItems(obj[k], d + 1);
                        }
                    }
                }
                deepFindItems(data, 0);
            }
        } catch(e) {}

        // 2. From SIGI_STATE
        try {
            let sigi = document.getElementById('SIGI_STATE');
            if (sigi && sigi.textContent) {
                let sdata = JSON.parse(sigi.textContent);
                if (sdata.ItemModule) {
                    for (let k in sdata.ItemModule) add(sdata.ItemModule[k]);
                }
            }
        } catch(e) {}

        // 3. From window.__TIKTOK_FIX_VIDEOS (intercepted fetch/XHR)
        if (window.__TIKTOK_FIX_VIDEOS) {
            for (let [id, val] of window.__TIKTOK_FIX_VIDEOS.entries()) {
                add(val);
            }
        }

        return items;
    }

    // -------------------------------------------------------------
    // 6. Ultra-Fast Video & Audio Downloader (Multi-Strategy Extraction & In-Browser Fetch)
    // -------------------------------------------------------------
    function getActiveArticle() {
        let items = Array.from(document.querySelectorAll('article[id^="one-column-item-"], article[data-e2e="recommend-list-item-container"], div[class*="ItemContainer"], section[data-e2e="feed-video"]'));
        if (!items.length) {
            items = Array.from(document.querySelectorAll('article, section'));
        }
        let midY = window.innerHeight / 2;
        let best = null, minDist = 999999;
        for (let el of items) {
            let r = el.getBoundingClientRect();
            if (r.height > 100) {
                let dist = Math.abs((r.top + r.height / 2) - midY);
                if (dist < minDist) {
                    minDist = dist;
                    best = el;
                }
            }
        }
        return best;
    }

    function extractVideoUrls(vid) {
        let urls = [];
        if (!vid || typeof vid !== 'object') return urls;
        function deep(obj) {
            if (!obj) return;
            if (typeof obj === 'string') {
                if (obj.startsWith('http://') || obj.startsWith('https://')) {
                    let lower = obj.toLowerCase();
                    if (!urls.includes(obj) && !lower.includes('avatar') && !lower.includes('cover') && !lower.includes('.jpeg') && !lower.includes('.jpg') && !lower.includes('.png')) {
                        urls.push(obj);
                    }
                }
                return;
            }
            if (Array.isArray(obj)) {
                for (let x of obj) deep(x);
                return;
            }
            if (typeof obj === 'object') {
                for (let k in obj) {
                    let kl = k.toLowerCase();
                    if (kl.includes('cover') || kl.includes('avatar') || kl.includes('thumb')) continue;
                    deep(obj[k]);
                }
            }
        }
        deep(vid);
        urls.sort((a, b) => {
            let scoreA = (a.includes('/aweme/v1/play/') ? 10 : 0) + (a.includes('v16-') || a.includes('v19-') ? 5 : 0);
            let scoreB = (b.includes('/aweme/v1/play/') ? 10 : 0) + (b.includes('v16-') || b.includes('v19-') ? 5 : 0);
            return scoreB - scoreA;
        });
        return urls;
    }

    function extractAudioUrls(mus) {
        let urls = [];
        if (!mus || typeof mus !== 'object') return urls;
        function deep(obj) {
            if (!obj) return;
            if (typeof obj === 'string') {
                if (obj.startsWith('http://') || obj.startsWith('https://')) {
                    let lower = obj.toLowerCase();
                    if (!urls.includes(obj) && !lower.includes('.jpeg') && !lower.includes('.jpg') && !lower.includes('.png') && !lower.includes('avatar')) {
                        urls.push(obj);
                    }
                }
                return;
            }
            if (Array.isArray(obj)) {
                for (let x of obj) deep(x);
                return;
            }
            if (typeof obj === 'object') {
                for (let k in obj) {
                    let kl = k.toLowerCase();
                    if (kl.includes('cover') || kl.includes('avatar')) continue;
                    deep(obj[k]);
                }
            }
        }
        deep(mus);
        return urls;
    }

    function getFullItemFromFiber(el) {
        if (!el) return null;
        let fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber'));
        if (!fiberKey) {
            let childWithFiber = el.querySelector('[id*="item"], [data-e2e], section, canvas, div, video');
            if (childWithFiber) fiberKey = Object.keys(childWithFiber).find(k => k.startsWith('__reactFiber'));
            if (childWithFiber && fiberKey) el = childWithFiber;
        }
        if (!fiberKey) return null;

        let f = el[fiberKey];
        let found = null;

        function checkObj(obj) {
            if (!obj || typeof obj !== 'object') return null;
            if (obj.item && (obj.item.video || obj.item.music)) return obj.item;
            if (obj.itemStruct && (obj.itemStruct.video || obj.itemStruct.music)) return obj.itemStruct;
            if (obj.video && (obj.video.playAddr || obj.video.bitrateInfo || obj.video.PlayAddrStruct || obj.video.downloadAddr)) return obj;
            return null;
        }

        function search(node, depth) {
            if (!node || depth > 15 || found) return;
            let propsList = [node.memoizedProps, node.pendingProps];
            for (let p of propsList) {
                if (!p || typeof p !== 'object') continue;
                let item = checkObj(p);
                if (item) { found = item; return; }
                if (p.children) {
                    if (Array.isArray(p.children)) {
                        for (let c of p.children) {
                            item = checkObj(c?.props) || checkObj(c);
                            if (item) { found = item; return; }
                        }
                    } else if (typeof p.children === 'object') {
                        item = checkObj(p.children.props) || checkObj(p.children);
                        if (item) { found = item; return; }
                    }
                }
            }
            if (node.child) search(node.child, depth + 1);
            if (node.sibling && depth <= 3) search(node.sibling, depth);
        }

        let curr = f;
        while (curr && !found) {
            search(curr, 0);
            curr = curr.return;
        }
        return found;
    }

    async function getActiveMediaInfo() {
        let candidateVideoUrls = [];
        let candidateAudioUrls = [];
        let pageUrl = window.location.href;
        let videoId = null;
        let author = '';
        let desc = '';

        let v = getActiveVideo();
        let article = (v && (v.closest('article, [data-e2e="recommend-list-item-container"], div[class*="ItemContainer"]') || v.parentElement)) || getActiveArticle();

        // Strategy 1: URL inspection (single video page or modal)
        let urlMatch = window.location.href.match(/\/video\/(\d{18,20})/);
        if (urlMatch) {
            videoId = urlMatch[1];
            let authMatch = window.location.href.match(/@([^\/?#]+)/);
            if (authMatch) author = authMatch[1];
        }

        // Strategy 2: React Fiber deep inspection (guaranteed on modern TikTok feed)
        let fItem = getFullItemFromFiber(article) || getFullItemFromFiber(v);
        if (fItem) {
            if (fItem.id) videoId = String(fItem.id);
            if (fItem.author?.uniqueId) author = fItem.author.uniqueId;
            if (fItem.desc) desc = fItem.desc;

            let extractedVideos = extractVideoUrls(fItem.video || fItem);
            for (let u of extractedVideos) {
                if (!candidateVideoUrls.includes(u)) candidateVideoUrls.push(u);
            }

            let extractedAudios = extractAudioUrls(fItem.music);
            for (let u of extractedAudios) {
                if (!candidateAudioUrls.includes(u)) candidateAudioUrls.push(u);
            }
        }

        // Strategy 3: Inspect DOM container for links
        if (!videoId && article) {
            let a = article.querySelector('a[href*="/video/"]');
            if (a) {
                let m = a.href.match(/\/video\/(\d{18,20})/);
                if (m) videoId = m[1];
                let mAuth = a.href.match(/@([^\/?#]+)/);
                if (mAuth) author = mAuth[1];
            }
        }
        if (!author && article) {
            let aAuth = article.querySelector('a[href^="/@"]');
            if (aAuth) {
                let mAuth = aAuth.getAttribute('href').match(/@([^\/?#]+)/);
                if (mAuth) author = mAuth[1];
            }
        }

        // Strategy 4: Intercepted fetch and rehydration items
        let knownItems = collectAllKnownItems();
        let matched = null;
        if (videoId) matched = knownItems.find(it => it.id === videoId);
        if (!matched && author) matched = knownItems.find(it => it.author === author);
        if (!matched && knownItems.length > 0) {
            matched = knownItems[0];
        }

        if (matched) {
            if (!videoId) videoId = matched.id;
            if (!author) author = matched.author;
            if (!desc) desc = matched.desc;
            if (matched.url && !candidateVideoUrls.includes(matched.url)) candidateVideoUrls.push(matched.url);
            if (matched.audioUrl && !candidateAudioUrls.includes(matched.audioUrl)) candidateAudioUrls.push(matched.audioUrl);
        }

        // Strategy 5: Video element currentSrc if non-blob
        if (v && v.currentSrc && v.currentSrc.startsWith('http') && !v.currentSrc.startsWith('blob:')) {
            if (!candidateVideoUrls.includes(v.currentSrc)) candidateVideoUrls.push(v.currentSrc);
        }

        // Strategy 6: TikTok internal item detail API if candidate URLs are empty
        if (videoId && !candidateVideoUrls.length) {
            try {
                let r = await fetch(`https://www.tiktok.com/api/item/detail/?itemId=${videoId}`, { credentials: 'include' });
                if (r.ok) {
                    let d = await r.json();
                    let st = d.itemInfo?.itemStruct;
                    if (st) {
                        let vid = st.video || {};
                        if (vid.PlayAddrStruct?.UrlList) {
                            let aweme = vid.PlayAddrStruct.UrlList.find(u => u.includes('/aweme/v1/play/'));
                            if (aweme) candidateVideoUrls.push(aweme);
                            for (let u of vid.PlayAddrStruct.UrlList) {
                                if (!candidateVideoUrls.includes(u)) candidateVideoUrls.push(u);
                            }
                        }
                        if (vid.playAddr && !candidateVideoUrls.includes(vid.playAddr)) candidateVideoUrls.push(vid.playAddr);
                        if (vid.downloadAddr && !candidateVideoUrls.includes(vid.downloadAddr)) candidateVideoUrls.push(vid.downloadAddr);
                        if (st.music?.playUrl && !candidateAudioUrls.includes(st.music.playUrl)) candidateAudioUrls.push(st.music.playUrl);
                    }
                }
            } catch(e) {}
        }

        if (videoId) {
            pageUrl = `https://www.tiktok.com/@${author || 'tiktok'}/video/${videoId}`;
        }

        return {
            videoId,
            pageUrl,
            candidateVideoUrls,
            candidateAudioUrls,
            directUrl: candidateVideoUrls[0] || '',
            audioUrl: candidateAudioUrls[0] || '',
            desc,
            author
        };
    }

    async function callFixApi(path) {
        let pList = [window.__TIKTOK_FIX_API_PORT__ || 28889, 28889, 28890, 28891];
        pList = [...new Set(pList)];
        let lastErr = null;
        for (let p of pList) {
            try {
                let res = await fetch(`http://127.0.0.1:${p}${path}`, {
                    method: 'GET',
                    mode: 'cors',
                    headers: { 'Accept': 'application/json' }
                });
                if (res.ok) {
                    return await res.json();
                }
            } catch (e) {
                lastErr = e;
            }
        }
        throw lastErr || new Error('Сервер недоступен');
    }

    async function saveFileToBackend(filename, blob) {
        let pList = [window.__TIKTOK_FIX_API_PORT__ || 28889, 28889, 28890, 28891];
        pList = [...new Set(pList)];
        for (let p of pList) {
            try {
                let res = await fetch(`http://127.0.0.1:${p}/api/save_file?name=${encodeURIComponent(filename)}`, {
                    method: 'POST',
                    mode: 'cors',
                    body: blob
                });
                if (res.ok) {
                    return await res.json();
                }
            } catch (e) {}
        }
        return null;
    }

    function triggerBrowserDownload(blob, filename) {
        try {
            let blobUrl = URL.createObjectURL(blob);
            let a = document.createElement('a');
            a.href = blobUrl;
            a.download = filename;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);
            return true;
        } catch(e) {
            return false;
        }
    }

    async function downloadCurrentVideo(btn) {
        if (!btn) return;
        let origText = btn.textContent;
        btn.textContent = 'Поиск...';
        showVideoToast('Поиск видео...');

        try {
            let info = await getActiveMediaInfo();
            btn.textContent = 'Загрузка...';
            showVideoToast('Загрузка видео...');

            let filename = `TikTok_${info.videoId || Math.floor(Date.now() / 1000)}.mp4`;
            let downloadedBlob = null;

            // 1. Fast in-browser fetch (cross-origin without credentials for clean CDN access)
            for (let url of (info.candidateVideoUrls || [])) {
                try {
                    let r = await fetch(url);
                    if (r.ok && (r.status === 200 || r.status === 206)) {
                        let b = await r.blob();
                        if (b && b.size > 25000) {
                            downloadedBlob = b;
                            break;
                        }
                    }
                } catch(e) {}
            }

            if (downloadedBlob) {
                triggerBrowserDownload(downloadedBlob, filename);
                await saveFileToBackend(filename, downloadedBlob);

                btn.textContent = 'Готово!';
                showVideoToast(`Сохранено: ${filename}`);
                setTimeout(() => { btn.textContent = origText; }, 2500);
                return;
            }

            // 2. Direct backend stream downloader
            btn.textContent = 'Сервер...';
            let params = new URLSearchParams({
                id: info.videoId || '',
                page: info.pageUrl || window.location.href,
                src: info.directUrl || '',
                urls: JSON.stringify(info.candidateVideoUrls || []),
                author: info.author || '',
                desc: info.desc || '',
                cookie: document.cookie || ''
            });

            let data = await callFixApi('/api/download?' + params.toString());
            if (data && data.success) {
                btn.textContent = 'Готово!';
                showVideoToast(`Сохранено: ${data.filename}`);
            } else {
                btn.textContent = 'Ошибка';
                showVideoToast(`Ошибка: ${(data && data.error) || 'Не удалось скачать видео'}`);
            }
        } catch(err) {
            btn.textContent = 'Ошибка';
            showVideoToast('Ошибка загрузки видео');
        }
        setTimeout(() => { btn.textContent = origText; }, 2500);
    }

    async function downloadCurrentAudio(btn) {
        if (!btn) return;
        let origText = btn.textContent;
        btn.textContent = 'Поиск...';
        showVideoToast('Поиск аудио...');

        try {
            let info = await getActiveMediaInfo();
            btn.textContent = 'Загрузка...';
            showVideoToast('Загрузка аудио...');

            let filename = `TikTok_Audio_${info.videoId || Math.floor(Date.now() / 1000)}.mp3`;
            let downloadedBlob = null;

            // 1. Fast in-browser fetch
            for (let url of (info.candidateAudioUrls || [])) {
                try {
                    let r = await fetch(url);
                    if (r.ok && (r.status === 200 || r.status === 206)) {
                        let b = await r.blob();
                        if (b.size > 5000) {
                            downloadedBlob = b;
                            break;
                        }
                    }
                } catch(e) {}
            }

            if (downloadedBlob) {
                triggerBrowserDownload(downloadedBlob, filename);
                await saveFileToBackend(filename, downloadedBlob);

                btn.textContent = 'Готово!';
                showVideoToast(`Звук сохранен: ${filename}`);
                setTimeout(() => { btn.textContent = origText; }, 2500);
                return;
            }

            // 2. Direct backend stream downloader
            btn.textContent = 'Сервер...';
            let params = new URLSearchParams({
                id: info.videoId || '',
                page: info.pageUrl || window.location.href,
                src: info.directUrl || '',
                audio_src: info.audioUrl || '',
                urls: JSON.stringify(info.candidateAudioUrls || []),
                author: info.author || '',
                desc: info.desc || '',
                cookie: document.cookie || ''
            });

            let data = await callFixApi('/api/download_audio?' + params.toString());
            if (data && data.success) {
                btn.textContent = 'Готово!';
                showVideoToast(`Звук сохранен: ${data.filename}`);
            } else {
                btn.textContent = 'Ошибка';
                showVideoToast(`Ошибка: ${(data && data.error) || 'Не удалось скачать звук'}`);
            }
        } catch(err) {
            btn.textContent = 'Ошибка';
            showVideoToast('Ошибка загрузки звука');
        }
        setTimeout(() => { btn.textContent = origText; }, 2500);
    }
    // Expose helpers globally on window
    window.__tfDownloadCurrentVideo = downloadCurrentVideo;
    window.__tfDownloadCurrentAudio = downloadCurrentAudio;
    window.__tfGetActiveMediaInfo = getActiveMediaInfo;

    // -------------------------------------------------------------
    // 7. Mod Settings Button (Bottom-Right Floating Gear, No Text)
    // -------------------------------------------------------------
    function updateFabSettingsButton() {
        if (!document.body) return;
        let oldTopBtn = document.getElementById('tiktok-fix-header-btn');
        if (oldTopBtn) oldTopBtn.remove();

        let fab = document.getElementById('tiktok-fix-fab-btn');
        if (!fab) {
            fab = document.createElement('button');
            fab.id = 'tiktok-fix-fab-btn';
            fab.title = 'Настройки TikTok Fix';
            fab.setAttribute('aria-label', 'Настройки');
            fab.innerHTML = `
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: block;">
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                </svg>
            `;
            fab.style.cssText = `
                position: fixed !important;
                bottom: 24px !important;
                right: 24px !important;
                width: 44px !important;
                height: 44px !important;
                min-width: 44px !important;
                max-width: 44px !important;
                border-radius: 50% !important;
                background: rgba(22, 24, 35, 0.88) !important;
                backdrop-filter: blur(12px) !important;
                border: 1px solid rgba(255, 255, 255, 0.16) !important;
                box-shadow: 0 6px 20px rgba(0, 0, 0, 0.6) !important;
                color: #ffffff !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                cursor: pointer !important;
                z-index: 2147483645 !important;
                transition: transform 0.2s ease, background 0.2s ease, border-color 0.2s ease !important;
                user-select: none !important;
                padding: 0 !important;
                outline: none !important;
                box-sizing: border-box !important;
            `;
            fab.onmouseover = () => {
                fab.style.transform = 'scale(1.08)';
                fab.style.background = 'rgba(38, 41, 58, 0.95)';
                fab.style.borderColor = 'rgba(255, 255, 255, 0.3)';
            };
            fab.onmouseout = () => {
                fab.style.transform = 'scale(1)';
                fab.style.background = 'rgba(22, 24, 35, 0.88)';
                fab.style.borderColor = 'rgba(255, 255, 255, 0.16)';
            };
            fab.onclick = togglePanel;
            document.body.appendChild(fab);
        }
    }

    // -------------------------------------------------------------
    // 8. Native Settings Section on /setting (Clean TikTok UI)
    // -------------------------------------------------------------
    function updateSettingsPage() {
        if (!document.body || !window.location.href.includes('/setting')) return;
        if (document.getElementById('tiktok-fix-native-section')) return;

        let manageContainer = document.querySelector('div[class*="DivManageContainer"]');
        if (!manageContainer) {
            let titles = Array.from(document.querySelectorAll('div, h2, h3, h4'));
            let match = titles.find(t => t.innerText && t.innerText.trim() === 'Управление аккаунтом');
            if (match) {
                manageContainer = match.closest('div[class*="Container"]') || match.parentElement;
            }
        }
        if (!manageContainer || !manageContainer.parentNode) return;

        let section = document.createElement('div');
        section.id = 'tiktok-fix-native-section';
        section.style.cssText = `
            background: #181824 !important;
            border: 1px solid rgba(255, 255, 255, 0.12) !important;
            border-radius: 12px !important;
            padding: 24px !important;
            margin-bottom: 28px !important;
            color: #ffffff !important;
            font-family: TikTokSans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
        `;
        section.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); padding-bottom: 16px;">
                <div>
                    <div style="font-size: 18px; font-weight: 700; color: #ffffff;">TikTok Fix</div>
                    <div style="font-size: 13px; color: rgba(255, 255, 255, 0.55); margin-top: 2px;">Управление параметрами подключения и контентом</div>
                </div>
                <div style="background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.16); color: #ffffff; font-size: 12px; font-weight: 600; border-radius: 6px; padding: 4px 10px;">
                    Активен (2026)
                </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 20px;">
                <div>
                    <label style="display: block; font-size: 12px; color: rgba(255, 255, 255, 0.6); margin-bottom: 6px; font-weight: 600;">Регион подключения</label>
                    <select id="tf-nat-region" style="width: 100%; background: #252533; color: #fff; border: 1px solid #3d3d50; border-radius: 8px; padding: 10px 12px; font-size: 14px; outline: none; cursor: pointer;">
                        <option value="DE">Германия (DE)</option>
                        <option value="NL">Нидерланды (NL)</option>
                        <option value="FR">Франция (FR)</option>
                        <option value="US">США (US)</option>
                        <option value="GB">Великобритания (GB)</option>
                        <option value="PL">Польша (PL)</option>
                        <option value="SE">Швеция (SE)</option>
                        <option value="JP">Япония (JP)</option>
                        <option value="SG">Сингапур (SG)</option>
                        <option value="DIRECT">Россия (Прямой)</option>
                    </select>
                </div>
                <div>
                    <label style="display: block; font-size: 12px; color: rgba(255, 255, 255, 0.6); margin-bottom: 6px; font-weight: 600;">Сетевые действия</label>
                    <div style="display: flex; gap: 8px;">
                        <button id="tf-nat-reconnect" style="flex: 1; background: #2b2b3d; color: #fff; border: 1px solid #4a4a60; border-radius: 8px; padding: 10px; font-size: 13px; font-weight: 600; cursor: pointer; transition: 0.2s;">Переподключиться</button>
                        <button id="tf-nat-clear" style="flex: 1; background: #2b2b3d; color: #fff; border: 1px solid #4a4a60; border-radius: 8px; padding: 10px; font-size: 13px; font-weight: 600; cursor: pointer; transition: 0.2s;">Очистить кэш</button>
                    </div>
                </div>
            </div>

            <div style="margin-bottom: 20px;">
                <label style="display: block; font-size: 12px; color: rgba(255, 255, 255, 0.6); margin-bottom: 10px; font-weight: 600;">Фильтрация ленты</label>
                <div style="display: flex; gap: 24px; flex-wrap: wrap;">
                    <label style="display: flex; align-items: center; gap: 8px; font-size: 14px; cursor: pointer; user-select: none;">
                        <input type="checkbox" id="tf-nat-ads" ${blockAds ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: #fe2c55; cursor: pointer;">
                        <span>Блокировать рекламу</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 8px; font-size: 14px; cursor: pointer; user-select: none;">
                        <input type="checkbox" id="tf-nat-streams" ${blockStreams ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: #fe2c55; cursor: pointer;">
                        <span>Скрыть LIVE-трансляции</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 8px; font-size: 14px; cursor: pointer; user-select: none;">
                        <input type="checkbox" id="tf-nat-photos" ${blockPhotos ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: #fe2c55; cursor: pointer;">
                        <span>Скрыть фото-посты</span>
                    </label>
                </div>
            </div>

            <div style="display: flex; align-items: center; justify-content: space-between; border-top: 1px solid rgba(255, 255, 255, 0.08); padding-top: 16px; flex-wrap: wrap; gap: 10px;">
                <div style="display: flex; gap: 10px;">
                    <button id="tf-nat-download" style="background: #fe2c55; color: #fff; border: none; border-radius: 8px; padding: 10px 18px; font-size: 13px; font-weight: 600; cursor: pointer;">
                        Скачать видео
                    </button>
                    <button id="tf-nat-download-audio" style="background: #2b2b3d; color: #fff; border: 1px solid #4a4a60; border-radius: 8px; padding: 10px 18px; font-size: 13px; font-weight: 600; cursor: pointer;">
                        Скачать звук (MP3)
                    </button>
                </div>
                <span style="font-size: 12px; color: rgba(255, 255, 255, 0.45);">Дата публикации и репосты отображаются автоматически</span>
            </div>
        `;

        manageContainer.parentNode.insertBefore(section, manageContainer);

        let sel = document.getElementById('tf-nat-region');
        if (sel) sel.value = currentRegion;

        document.getElementById('tf-nat-region').onchange = (e) => {
            currentRegion = e.target.value;
            safeStorageSet("tf_region", currentRegion);
            fetch(`/api/set_region?code=${currentRegion}`).then(() => location.reload()).catch(() => location.reload());
        };
        document.getElementById('tf-nat-reconnect').onclick = () => {
            let b = document.getElementById('tf-nat-reconnect');
            b.textContent = 'Подключение...';
            callFixApi('/api/reconnect').then(() => setTimeout(() => location.reload(), 500)).catch(() => location.reload());
        };
        document.getElementById('tf-nat-clear').onclick = () => {
            if (confirm('Сбросить кэш и обновить сессию?')) {
                callFixApi('/api/clear_cache').then(() => location.reload()).catch(() => location.reload());
            }
        };
        document.getElementById('tf-nat-ads').onchange = (e) => {
            blockAds = e.target.checked;
            safeStorageSet("tf_block_ads", blockAds);
            filterContent();
        };
        document.getElementById('tf-nat-streams').onchange = (e) => {
            blockStreams = e.target.checked;
            safeStorageSet("tf_block_streams", blockStreams);
            filterContent();
        };
        document.getElementById('tf-nat-photos').onchange = (e) => {
            blockPhotos = e.target.checked;
            safeStorageSet("tf_block_photos", blockPhotos);
            filterContent();
        };
        document.getElementById('tf-nat-download').onclick = () => {
            downloadCurrentVideo(document.getElementById('tf-nat-download'));
        };
        let bAudio = document.getElementById('tf-nat-download-audio');
        if (bAudio) {
            bAudio.onclick = () => {
                downloadCurrentAudio(bAudio);
            };
        }
    }

    // -------------------------------------------------------------
    // 9. Floating Settings Panel (Outside React, Completely Safe)
    // -------------------------------------------------------------
    function createSettingsPanel() {
        if (!document.body || document.getElementById('tiktok-fix-panel')) return;

        let panel = document.createElement('div');
        panel.id = 'tiktok-fix-panel';
        panel.style.cssText = `
            position: fixed !important;
            right: 24px !important;
            bottom: 78px !important;
            top: auto !important;
            width: 290px !important;
            background: #181824 !important;
            border: 1px solid rgba(255, 255, 255, 0.14) !important;
            border-radius: 12px !important;
            padding: 18px !important;
            color: #ffffff !important;
            z-index: 2147483647 !important;
            box-shadow: 0 16px 40px rgba(0, 0, 0, 0.8) !important;
            font-family: TikTokSans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
            display: none;
            user-select: none !important;
        `;
        panel.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 10px; margin-bottom: 14px;">
                <span style="font-size: 15px; font-weight: 700; color: #fff;">TikTok Fix</span>
                <span id="tf-close" style="cursor: pointer; color: rgba(255,255,255,0.5); font-size: 16px; font-weight: bold; padding: 2px 6px;">✕</span>
            </div>

            <div style="margin-bottom: 12px;">
                <label style="display: block; font-size: 11px; color: rgba(255,255,255,0.55); margin-bottom: 4px; font-weight: 600;">Регион подключения</label>
                <select id="tf-region" style="width: 100%; background: #252533; color: #fff; border: 1px solid #3d3d50; border-radius: 6px; padding: 8px 10px; font-size: 13px; outline: none; cursor: pointer;">
                    <option value="DE">Германия (DE)</option>
                    <option value="NL">Нидерланды (NL)</option>
                    <option value="FR">Франция (FR)</option>
                    <option value="US">США (US)</option>
                    <option value="GB">Великобритания (GB)</option>
                    <option value="PL">Польша (PL)</option>
                    <option value="SE">Швеция (SE)</option>
                    <option value="JP">Япония (JP)</option>
                    <option value="SG">Сингапур (SG)</option>
                    <option value="DIRECT">Россия (Прямой)</option>
                </select>
                <button id="tf-reconnect" style="width: 100%; background: #252533; color: #fff; border: 1px solid #3d3d50; border-radius: 6px; padding: 8px; font-size: 12px; font-weight: 600; cursor: pointer; margin-top: 6px;">Переподключиться</button>
            </div>

            <div style="margin-bottom: 12px;">
                <label style="display: block; font-size: 11px; color: rgba(255,255,255,0.55); margin-bottom: 4px; font-weight: 600;">Фильтры ленты</label>
                <label style="display: flex; align-items: center; gap: 8px; margin-top: 6px; font-size: 13px; color: #ddd; cursor: pointer;">
                    <input type="checkbox" id="tf-cb-ads" ${blockAds ? 'checked' : ''} style="accent-color: #fe2c55; cursor: pointer;">
                    <span>Блокировать рекламу</span>
                </label>
                <label style="display: flex; align-items: center; gap: 8px; margin-top: 6px; font-size: 13px; color: #ddd; cursor: pointer;">
                    <input type="checkbox" id="tf-cb-streams" ${blockStreams ? 'checked' : ''} style="accent-color: #fe2c55; cursor: pointer;">
                    <span>Скрыть LIVE-трансляции</span>
                </label>
                <label style="display: flex; align-items: center; gap: 8px; margin-top: 6px; font-size: 13px; color: #ddd; cursor: pointer;">
                    <input type="checkbox" id="tf-cb-photos" ${blockPhotos ? 'checked' : ''} style="accent-color: #fe2c55; cursor: pointer;">
                    <span>Скрыть фото-посты</span>
                </label>
            </div>

            <div style="margin-bottom: 12px;">
                <label style="display: block; font-size: 11px; color: rgba(255,255,255,0.55); margin-bottom: 4px; font-weight: 600;">Скачать медиа</label>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
                    <button id="tf-download" style="background: #fe2c55; border: none; color: #fff; border-radius: 6px; padding: 8px; font-size: 12px; font-weight: 600; cursor: pointer;">Видео (MP4)</button>
                    <button id="tf-download-audio" style="background: #252533; border: 1px solid #3d3d50; color: #fff; border-radius: 6px; padding: 8px; font-size: 12px; font-weight: 600; cursor: pointer;">Звук (MP3)</button>
                </div>
                <button id="tf-clear" style="width: 100%; background: #1f1f2b; color: #aaa; border: 1px solid #303040; border-radius: 6px; padding: 6px; font-size: 11px; cursor: pointer; margin-top: 8px;">Очистить кэш браузера</button>
            </div>

            <div style="font-size: 11px; color: rgba(255,255,255,0.45); margin-top: 8px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 8px; line-height: 1.4;">
                Клавиши: ←/→ (3 сек), [/] (скорость), P (PiP режим), Колесико (звук)
            </div>
        `;
        document.body.appendChild(panel);

        document.getElementById('tf-close').onclick = togglePanel;

        let sel = document.getElementById('tf-region');
        if (sel) sel.value = currentRegion;

        document.getElementById('tf-region').onchange = (e) => {
            currentRegion = e.target.value;
            safeStorageSet("tf_region", currentRegion);
            fetch(`/api/set_region?code=${currentRegion}`).then(() => location.reload()).catch(() => location.reload());
        };
        document.getElementById('tf-reconnect').onclick = () => {
            callFixApi('/api/reconnect').then(() => setTimeout(() => location.reload(), 500)).catch(() => location.reload());
        };
        document.getElementById('tf-clear').onclick = () => {
            if (confirm('Сбросить кэш и обновить сессию?')) {
                callFixApi('/api/clear_cache').then(() => location.reload()).catch(() => location.reload());
            }
        };
        document.getElementById('tf-cb-ads').onchange = (e) => {
            blockAds = e.target.checked;
            safeStorageSet("tf_block_ads", blockAds);
            filterContent();
        };
        document.getElementById('tf-cb-streams').onchange = (e) => {
            blockStreams = e.target.checked;
            safeStorageSet("tf_block_streams", blockStreams);
            filterContent();
        };
        document.getElementById('tf-cb-photos').onchange = (e) => {
            blockPhotos = e.target.checked;
            safeStorageSet("tf_block_photos", blockPhotos);
            filterContent();
        };
        document.getElementById('tf-download').onclick = () => {
            downloadCurrentVideo(document.getElementById('tf-download'));
        };
        document.getElementById('tf-download-audio').onclick = () => {
            downloadCurrentAudio(document.getElementById('tf-download-audio'));
        };
    }

    function togglePanel() {
        let p = document.getElementById('tiktok-fix-panel');
        if (!p) {
            createSettingsPanel();
            p = document.getElementById('tiktok-fix-panel');
        }
        if (p) {
            p.style.display = (p.style.display === 'block') ? 'none' : 'block';
        }
    }

    // -------------------------------------------------------------
    // 9. Feed Navigation (Next / Previous Video)
    // -------------------------------------------------------------
    function dispatchNavKey(code, key, keyCode) {
        let opts = {
            key: key,
            code: code,
            keyCode: keyCode,
            which: keyCode,
            bubbles: true,
            cancelable: true,
            view: window
        };
        let el = document.activeElement || document.body;
        el.dispatchEvent(new KeyboardEvent('keydown', opts));
        window.dispatchEvent(new KeyboardEvent('keydown', opts));
        document.dispatchEvent(new KeyboardEvent('keydown', opts));
        el.dispatchEvent(new KeyboardEvent('keyup', opts));
        window.dispatchEvent(new KeyboardEvent('keyup', opts));
        document.dispatchEvent(new KeyboardEvent('keyup', opts));
    }

    function scrollNextVideo() {
        if (activePipWindow && currentPipVideo) {
            detachPipVideo();
        }

        let nextBtn = document.querySelector('button[data-e2e="arrow-right"], button[data-e2e="navigation-down"], button[data-e2e="arrow-down"], button[aria-label*="Next"], button[aria-label*="Следующ"], button[aria-label*="next"]');
        if (nextBtn) {
            nextBtn.click();
        } else {
            dispatchNavKey('ArrowDown', 'ArrowDown', 40);
            let v = getActiveVideo();
            let card = v ? (v.closest('[data-e2e="recommend-list-item-container"]') || v.closest('div[class*="ItemContainer"]') || v.closest('div[data-e2e="feed-item"]')) : null;
            if (card && card.nextElementSibling) {
                card.nextElementSibling.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else {
                window.scrollBy({ top: window.innerHeight * 0.9, behavior: 'smooth' });
            }
        }

        if (activePipWindow && !activePipWindow.closed) {
            attachNextVideoToPip(activePipWindow);
        }
    }

    function scrollPrevVideo() {
        if (activePipWindow && currentPipVideo) {
            detachPipVideo();
        }

        let prevBtn = document.querySelector('button[data-e2e="arrow-left"], button[data-e2e="navigation-up"], button[data-e2e="arrow-up"], button[aria-label*="Previous"], button[aria-label*="Предыдущ"], button[aria-label*="prev"]');
        if (prevBtn) {
            prevBtn.click();
        } else {
            dispatchNavKey('ArrowUp', 'ArrowUp', 38);
            let v = getActiveVideo();
            let card = v ? (v.closest('[data-e2e="recommend-list-item-container"]') || v.closest('div[class*="ItemContainer"]') || v.closest('div[data-e2e="feed-item"]')) : null;
            if (card && card.previousElementSibling) {
                card.previousElementSibling.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else {
                window.scrollBy({ top: -window.innerHeight * 0.9, behavior: 'smooth' });
            }
        }

        if (activePipWindow && !activePipWindow.closed) {
            attachNextVideoToPip(activePipWindow);
        }
    }

    function attachNextVideoToPip(pipWin) {
        let oldVideo = currentPipVideo;
        let attempts = 0;
        let poll = setInterval(() => {
            attempts++;
            let v = getActiveVideo();
            if ((v && v !== oldVideo) || attempts > 16) {
                clearInterval(poll);
                if (v && pipWin && !pipWin.closed) {
                    attachPipVideo(pipWin, v);
                }
            }
        }, 50);
    }

    // -------------------------------------------------------------
    // 10. Picture-in-Picture with Interactive Feed Scrolling
    // -------------------------------------------------------------
    let activePipWindow = null;
    let currentPipVideo = null;
    let pipPlaceholder = null;

    function detachPipVideo() {
        if (currentPipVideo) {
            if (pipPlaceholder && pipPlaceholder.parentNode) {
                pipPlaceholder.parentNode.insertBefore(currentPipVideo, pipPlaceholder);
                pipPlaceholder.remove();
            }
            currentPipVideo.style.width = '';
            currentPipVideo.style.height = '';
            currentPipVideo.style.maxWidth = '';
            currentPipVideo.style.maxHeight = '';
            currentPipVideo.style.objectFit = '';
            currentPipVideo.style.outline = '';
        }
        currentPipVideo = null;
        pipPlaceholder = null;
    }

    function attachPipVideo(pipWin, v) {
        if (!pipWin || pipWin.closed || !v) return;

        detachPipVideo();

        currentPipVideo = v;
        let parent = v.parentNode;
        pipPlaceholder = document.createElement('div');
        pipPlaceholder.id = 'tf-pip-placeholder';
        pipPlaceholder.style.display = 'contents';
        parent.insertBefore(pipPlaceholder, v);

        let container = pipWin.document.getElementById('pip-video-container');
        if (container) {
            let oldV = container.querySelector('video');
            if (oldV && oldV !== v) oldV.remove();

            v.style.cssText = 'width: 100% !important; height: 100% !important; max-width: 100% !important; max-height: 100% !important; object-fit: contain !important; outline: none !important; background: #000;';
            container.insertBefore(v, container.firstChild);

            try {
                if (v.paused) v.play();
            } catch (e) {}
        }

        v.onended = () => {
            if (activePipWindow && !activePipWindow.closed) {
                scrollNextVideo();
            }
        };
    }

    async function openDocumentPip(initialVideo) {
        let width = 380;
        let height = 620;

        const pipWin = await window.documentPictureInPicture.requestWindow({
            width: width,
            height: height
        });

        activePipWindow = pipWin;
        pipWin.document.title = 'TikTok Fix';

        let style = pipWin.document.createElement('style');
        style.textContent = `
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body {
                background: #000;
                color: #fff;
                overflow: hidden;
                width: 100vw;
                height: 100vh;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                font-family: TikTokSans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                user-select: none;
            }
            #pip-video-container {
                width: 100%;
                height: 100%;
                position: relative;
                display: flex;
                align-items: center;
                justify-content: center;
                background: #000;
            }
            .pip-overlay {
                position: absolute;
                inset: 0;
                display: flex;
                flex-direction: column;
                justify-content: space-between;
                align-items: center;
                padding: 10px;
                pointer-events: none;
                opacity: 0;
                transition: opacity 0.25s ease;
                background: linear-gradient(180deg, rgba(0,0,0,0.55) 0%, transparent 20%, transparent 80%, rgba(0,0,0,0.65) 100%);
            }
            #pip-video-container:hover .pip-overlay {
                opacity: 1;
            }
            .pip-nav-btn {
                pointer-events: auto;
                background: rgba(22, 24, 35, 0.75);
                backdrop-filter: blur(12px);
                border: 1px solid rgba(255, 255, 255, 0.15);
                color: #fff;
                border-radius: 20px;
                padding: 6px 14px;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 6px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.4);
                transition: background 0.15s, transform 0.15s, border-color 0.15s;
            }
            .pip-nav-btn:hover {
                background: rgba(254, 44, 85, 0.9);
                border-color: #fe2c55;
                transform: scale(1.04);
            }
            .pip-nav-btn:active {
                transform: scale(0.96);
            }
            .pip-toast {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(0, 0, 0, 0.85);
                backdrop-filter: blur(8px);
                color: #fff;
                border: 1px solid rgba(255, 255, 255, 0.15);
                padding: 8px 16px;
                border-radius: 8px;
                font-size: 13px;
                font-weight: 600;
                pointer-events: none;
                opacity: 0;
                transition: opacity 0.15s ease;
                z-index: 99;
            }
            .pip-hint {
                font-size: 11px;
                color: rgba(255, 255, 255, 0.6);
                background: rgba(0,0,0,0.5);
                padding: 2px 7px;
                border-radius: 8px;
                margin-left: 4px;
            }
        `;
        pipWin.document.head.appendChild(style);

        let container = pipWin.document.createElement('div');
        container.id = 'pip-video-container';

        let overlay = pipWin.document.createElement('div');
        overlay.className = 'pip-overlay';
        overlay.innerHTML = `
            <button class="pip-nav-btn" id="pip-prev">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4l-8 8h16z"/></svg>
                Пред. видео
                <span class="pip-hint">↑ или Колесико вверх</span>
            </button>
            <div class="pip-toast" id="pip-toast"></div>
            <button class="pip-nav-btn" id="pip-next">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 20l8-8H4z"/></svg>
                След. видео
                <span class="pip-hint">↓ или Колесико вниз</span>
            </button>
        `;

        container.appendChild(overlay);
        pipWin.document.body.appendChild(container);

        let toastEl = overlay.querySelector('#pip-toast');
        let toastTimer = null;
        function showToast(msg) {
            if (!toastEl) return;
            toastEl.textContent = msg;
            toastEl.style.opacity = '1';
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => {
                if (toastEl) toastEl.style.opacity = '0';
            }, 1200);
        }

        attachPipVideo(pipWin, initialVideo);

        overlay.querySelector('#pip-prev').onclick = (e) => {
            e.stopPropagation();
            showToast('▲ Предыдущее');
            scrollPrevVideo();
        };
        overlay.querySelector('#pip-next').onclick = (e) => {
            e.stopPropagation();
            showToast('▼ Следующее');
            scrollNextVideo();
        };

        // Mouse wheel over PiP window scrolls the feed
        let lastWheelTime = 0;
        pipWin.addEventListener('wheel', (e) => {
            e.preventDefault();
            e.stopPropagation();
            let now = Date.now();
            if (now - lastWheelTime < 320) return;
            lastWheelTime = now;

            if (e.deltaY > 0) {
                showToast('▼ Следующее');
                scrollNextVideo();
            } else if (e.deltaY < 0) {
                showToast('▲ Предыдущее');
                scrollPrevVideo();
            }
        }, { passive: false });

        // Keydown events inside PiP window (ArrowDown / ArrowUp for feed, Left/Right for rewind, Space for pause)
        pipWin.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                e.stopPropagation();
                showToast('▼ Следующее');
                scrollNextVideo();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                e.stopPropagation();
                showToast('▲ Предыдущее');
                scrollPrevVideo();
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                let v = currentPipVideo;
                if (v) {
                    v.currentTime = Math.max(0, v.currentTime - 3);
                    showToast('◄◄ 3 сек');
                }
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                let v = currentPipVideo;
                if (v) {
                    v.currentTime = Math.min(v.duration || 9999, v.currentTime + 3);
                    showToast('3 сек ►►');
                }
            } else if (e.key === ' ' || e.code === 'Space') {
                e.preventDefault();
                let v = currentPipVideo;
                if (v) {
                    if (v.paused) { v.play(); showToast('Воспроизведение'); }
                    else { v.pause(); showToast('Пауза'); }
                }
            } else if (e.key === '[' || e.code === 'BracketLeft') {
                e.preventDefault();
                let v = currentPipVideo;
                if (v) {
                    let speeds = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
                    let cur = v.playbackRate || 1.0;
                    let idx = speeds.findIndex(s => Math.abs(s - cur) < 0.05);
                    if (idx === -1) idx = 2;
                    let nextIdx = Math.max(0, idx - 1);
                    v.playbackRate = speeds[nextIdx];
                    showToast(`${speeds[nextIdx]}x`);
                }
            } else if (e.key === ']' || e.code === 'BracketRight') {
                e.preventDefault();
                let v = currentPipVideo;
                if (v) {
                    let speeds = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
                    let cur = v.playbackRate || 1.0;
                    let idx = speeds.findIndex(s => Math.abs(s - cur) < 0.05);
                    if (idx === -1) idx = 2;
                    let nextIdx = Math.min(speeds.length - 1, idx + 1);
                    v.playbackRate = speeds[nextIdx];
                    showToast(`${speeds[nextIdx]}x`);
                }
            } else if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
                e.preventDefault();
                pipWin.close();
            }
        });

        pipWin.addEventListener('pagehide', () => {
            detachPipVideo();
            activePipWindow = null;
            showVideoToast('PiP закрыт');
        });

        showVideoToast('Картинка в картинке');
    }

    async function togglePictureInPicture() {
        let v = getActiveVideo();
        if (!v) {
            showVideoToast('Видео не найдено');
            return;
        }

        if (activePipWindow && !activePipWindow.closed) {
            activePipWindow.close();
            return;
        }

        if (document.pictureInPictureElement) {
            document.exitPictureInPicture().catch(() => {});
            return;
        }

        if ('documentPictureInPicture' in window) {
            try {
                await openDocumentPip(v);
                return;
            } catch (err) {
                console.warn('[TikTok Fix] Document PiP failed, fallback to video PiP:', err);
            }
        }

        if (document.pictureInPictureEnabled) {
            try {
                await v.requestPictureInPicture();
                showVideoToast('Картинка в картинке');
            } catch (err) {
                showVideoToast('Ошибка PiP');
            }
        }
    }

    // MediaSession navigation buttons for standard PiP
    if ('mediaSession' in navigator) {
        try {
            navigator.mediaSession.setActionHandler('nexttrack', () => {
                scrollNextVideo();
            });
            navigator.mediaSession.setActionHandler('previoustrack', () => {
                scrollPrevVideo();
            });
        } catch (e) {}
    }

    // -------------------------------------------------------------
    // 11. Global Keyboard Hotkeys
    // -------------------------------------------------------------
    window.addEventListener('keydown', function(e) {
        let isRightAlt = (e.code === 'AltRight' || e.key === 'AltGraph' || (e.key === 'Alt' && e.location === 2));
        if (isRightAlt) {
            e.preventDefault();
            e.stopPropagation();
            togglePanel();
            return;
        }

        let tag = (document.activeElement && document.activeElement.tagName) || '';
        let isInput = (tag === 'INPUT' || tag === 'TEXTAREA' || (document.activeElement && document.activeElement.isContentEditable));
        if (isInput) return;

        if (e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0') {
            togglePanel();
            return;
        }

        let v = getActiveVideo();

        // BracketLeft '[': Slow down
        if (e.key === '[' || e.code === 'BracketLeft') {
            if (v) {
                e.preventDefault();
                let speeds = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
                let cur = v.playbackRate || 1.0;
                let idx = speeds.findIndex(s => Math.abs(s - cur) < 0.05);
                if (idx === -1) idx = 2;
                let nextIdx = Math.max(0, idx - 1);
                v.playbackRate = speeds[nextIdx];
                showVideoToast(`Скорость: ${speeds[nextIdx]}x`);
            }
        }
        // BracketRight ']': Speed up
        else if (e.key === ']' || e.code === 'BracketRight') {
            if (v) {
                e.preventDefault();
                let speeds = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
                let cur = v.playbackRate || 1.0;
                let idx = speeds.findIndex(s => Math.abs(s - cur) < 0.05);
                if (idx === -1) idx = 2;
                let nextIdx = Math.min(speeds.length - 1, idx + 1);
                v.playbackRate = speeds[nextIdx];
                showVideoToast(`Скорость: ${speeds[nextIdx]}x`);
            }
        }
        // Key P: Picture-in-Picture
        else if (e.key === 'p' || e.key === 'P' || e.code === 'KeyP') {
            e.preventDefault();
            togglePictureInPicture();
        }
    }, true);

    // Global Tick called continuously (isolated in try-catch so no error can ever break other functions)
    window.tikTokFixTick = function() {
        if (!document.body) return;
        try { createSettingsPanel(); } catch(e) { console.error('[TikTok Fix] createSettingsPanel error:', e); }
        try { updateFabSettingsButton(); } catch(e) { console.error('[TikTok Fix] updateFabSettingsButton error:', e); }
        try { updateSettingsPage(); } catch(e) { console.error('[TikTok Fix] updateSettingsPage error:', e); }
        try { updateVideoDates(); } catch(e) { console.error('[TikTok Fix] updateVideoDates error:', e); }
        try { updateRepostTab(); } catch(e) { console.error('[TikTok Fix] updateRepostTab error:', e); }
        try { cleanupProfileBanners(); } catch(e) { console.error('[TikTok Fix] cleanupProfileBanners error:', e); }
        try { filterContent(); } catch(e) { console.error('[TikTok Fix] filterContent error:', e); }
        try { bindVideoVolume(); } catch(e) { console.error('[TikTok Fix] bindVideoVolume error:', e); }
    };

    // Run interval
    setInterval(window.tikTokFixTick, 1000);
    window.tikTokFixTick();
})();
