// =========================================================================
// TikTok Fix Core Injected Engine v2.4
// Pure Native TikTok Style (Zero Emojis, Native Fonts & Themes)
// Features: Feed 2026, Dates, Reposts, Downloader (MP4 + MP3),
//           Hotkeys (Rewind, Speed, PiP), Mouse Wheel Volume, Copy & Translate
// =========================================================================
(function() {
    window.TIKTOK_FIX_ACTIVE = true;

    // Load user preferences
    let blockAds = localStorage.getItem("tf_block_ads") !== "false";
    let blockStreams = localStorage.getItem("tf_block_streams") !== "false";
    let blockPhotos = localStorage.getItem("tf_block_photos") !== "false";
    let currentRegion = localStorage.getItem("tf_region") || "FR";

    // Global cache for intercepted video direct download URLs
    window.__TIKTOK_FIX_VIDEOS = window.__TIKTOK_FIX_VIDEOS || new Map();

    function captureVideoItems(data) {
        if (!data) return;
        let items = data.itemList || (data.itemInfo && [data.itemInfo.itemStruct]) || [];
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
            if (typeof url === 'string' && (url.includes('/item_list') || url.includes('/item/detail') || url.includes('/user/repost') || url.includes('/recommend/item_list'))) {
                clone.json().then(captureVideoItems).catch(() => {});
            }
        } catch(e) {}
        return resp;
    };

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
                    while (fiber && fdepth < 15) {
                        let p = fiber.memoizedProps;
                        if (p) {
                            let item = p.itemInfo || p.item || p.videoData || p.aweme || p.videoInfo;
                            if (item && (item.id || item.createTime || item.video)) return item;
                            if (p.id && String(p.id).length >= 18) return p;
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
        if (!window.location.href.includes('/@')) return;

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
                localStorage.setItem('tf_volume', newVol);
                showVideoToast(`Громкость: ${Math.round(newVol * 100)}%`);
            }, { passive: false });
        });
    }

    // -------------------------------------------------------------
    // 6. Direct Video & Audio Downloader
    // -------------------------------------------------------------
    function getActiveMediaInfo() {
        let directUrl = null;
        let audioUrl = null;
        let pageUrl = window.location.href;
        let videoId = null;
        let desc = '';

        let v = getActiveVideo();
        if (v) {
            if (v.currentSrc && v.currentSrc.startsWith('http') && !v.currentSrc.startsWith('blob:')) {
                directUrl = v.currentSrc;
            }
            let vData = getVideoDataFromElement(v);
            if (vData) {
                if (vData.id) videoId = String(vData.id);
                if (vData.desc) desc = vData.desc;
                if (vData.music) audioUrl = vData.music.playUrl || (vData.music.playUrl?.urlList?.[0]) || '';
                if (vData.video) {
                    let vid = vData.video;
                    directUrl = (typeof vid.playAddr === 'string' ? vid.playAddr : (vid.playAddr?.urlList?.[0])) ||
                                (typeof vid.downloadAddr === 'string' ? vid.downloadAddr : (vid.downloadAddr?.urlList?.[0])) ||
                                (vid.bitrate?.[vid.bitrate.length - 1]?.playAddr?.urlList?.[0]) || directUrl;
                }
                if (vData.author && vData.author.uniqueId && videoId) {
                    pageUrl = `https://www.tiktok.com/@${vData.author.uniqueId}/video/${videoId}`;
                }
            }
        }

        let m = window.location.href.match(/\/video\/(\d+)/);
        if (m) {
            videoId = m[1];
            pageUrl = window.location.href;
        }

        if (videoId && window.__TIKTOK_FIX_VIDEOS && window.__TIKTOK_FIX_VIDEOS.has(videoId)) {
            let info = window.__TIKTOK_FIX_VIDEOS.get(videoId);
            if (info.url) directUrl = info.url;
            if (info.audioUrl) audioUrl = info.audioUrl;
            if (info.desc) desc = info.desc;
            if (info.author && !pageUrl.includes('/video/')) {
                pageUrl = `https://www.tiktok.com/@${info.author}/video/${videoId}`;
            }
        }

        if (!desc) {
            let dEl = document.querySelector('h1[data-e2e="browse-video-desc"], div[data-e2e="browse-video-desc"], [data-e2e="user-post-item-desc"]');
            if (dEl) desc = dEl.innerText.trim();
        }

        return { videoId, pageUrl, directUrl, audioUrl, desc };
    }

    function downloadCurrentVideo(btn) {
        if (!btn) return;
        let origText = btn.textContent;
        btn.textContent = 'Поиск видео...';

        let info = getActiveMediaInfo();
        btn.textContent = 'Скачивание...';

        fetch(`http://127.0.0.1:28889/api/download?page=${encodeURIComponent(info.pageUrl)}&src=${encodeURIComponent(info.directUrl || '')}`)
            .then(r => r.json())
            .then(data => {
                btn.textContent = origText;
                if (data.success) {
                    showVideoToast(`Сохранено: ${data.filename}`);
                    alert(`Видео успешно сохранено в Загрузки!\nФайл: ${data.filename}`);
                } else {
                    alert(`Ошибка скачивания: ${data.error || 'Не удалось получить видео'}`);
                }
            })
            .catch(err => {
                btn.textContent = origText;
                alert(`Ошибка соединения: ${err}`);
            });
    }

    function downloadCurrentAudio(btn) {
        if (!btn) return;
        let origText = btn.textContent;
        btn.textContent = 'Поиск аудио...';

        let info = getActiveMediaInfo();
        btn.textContent = 'Скачивание MP3...';

        fetch(`http://127.0.0.1:28889/api/download_audio?page=${encodeURIComponent(info.pageUrl)}&src=${encodeURIComponent(info.directUrl || '')}&audio_src=${encodeURIComponent(info.audioUrl || '')}`)
            .then(r => r.json())
            .then(data => {
                btn.textContent = origText;
                if (data.success) {
                    showVideoToast(`Звук сохранен: ${data.filename}`);
                    alert(`Аудиодорожка успешно сохранена в Загрузки!\nФайл: ${data.filename}`);
                } else {
                    alert(`Ошибка скачивания: ${data.error || 'Не удалось получить аудио'}`);
                }
            })
            .catch(err => {
                btn.textContent = origText;
                alert(`Ошибка соединения: ${err}`);
            });
    }

    function copyCurrentDescription(btn) {
        let info = getActiveMediaInfo();
        let text = info.desc;
        if (!text) {
            let el = document.querySelector('h1[data-e2e="browse-video-desc"], div[data-e2e="browse-video-desc"], [data-e2e="user-post-item-desc"]');
            if (el) text = el.innerText.trim();
        }
        if (!text) {
            alert('Описание текущего видео не найдено');
            return;
        }
        navigator.clipboard.writeText(text).then(() => {
            showVideoToast('Описание скопировано!');
            if (btn) {
                let p = btn.textContent;
                btn.textContent = 'Скопировано!';
                setTimeout(() => { btn.textContent = p; }, 1200);
            }
        });
    }

    function translateCurrentDescription(btn) {
        let info = getActiveMediaInfo();
        let text = info.desc;
        if (!text) {
            let el = document.querySelector('h1[data-e2e="browse-video-desc"], div[data-e2e="browse-video-desc"], [data-e2e="user-post-item-desc"]');
            if (el) text = el.innerText.trim();
        }
        if (!text) {
            alert('Описание текущего видео не найдено');
            return;
        }

        let p = btn ? btn.textContent : '';
        if (btn) btn.textContent = 'Перевод...';

        fetch(`http://127.0.0.1:28889/api/translate?text=${encodeURIComponent(text)}`)
            .then(r => r.json())
            .then(d => {
                if (btn) btn.textContent = p;
                if (d.success && d.translated) {
                    alert(`Перевод описания:\n\n${d.translated}`);
                } else {
                    alert('Не удалось перевести описание');
                }
            })
            .catch(e => {
                if (btn) btn.textContent = p;
                alert('Ошибка перевода: ' + e);
            });
    }

    // -------------------------------------------------------------
    // 7. Mod Settings Button (Bottom-Right Floating Gear, No Text)
    // -------------------------------------------------------------
    function updateFabSettingsButton() {
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
        if (!window.location.href.includes('/setting')) return;
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
                        <option value="FR">Франция (FR)</option>
                        <option value="US">США (US)</option>
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
            localStorage.setItem("tf_region", currentRegion);
            fetch(`http://127.0.0.1:28889/api/set_region?code=${currentRegion}`).then(() => location.reload()).catch(() => location.reload());
        };
        document.getElementById('tf-nat-reconnect').onclick = () => {
            let b = document.getElementById('tf-nat-reconnect');
            b.textContent = 'Подключение...';
            fetch('http://127.0.0.1:28889/api/reconnect').then(() => setTimeout(() => location.reload(), 500)).catch(() => location.reload());
        };
        document.getElementById('tf-nat-clear').onclick = () => {
            if (confirm('Сбросить кэш и обновить сессию?')) {
                fetch('http://127.0.0.1:28889/api/clear_cache').then(() => location.reload()).catch(() => location.reload());
            }
        };
        document.getElementById('tf-nat-ads').onchange = (e) => {
            blockAds = e.target.checked;
            localStorage.setItem("tf_block_ads", blockAds);
            filterContent();
        };
        document.getElementById('tf-nat-streams').onchange = (e) => {
            blockStreams = e.target.checked;
            localStorage.setItem("tf_block_streams", blockStreams);
            filterContent();
        };
        document.getElementById('tf-nat-photos').onchange = (e) => {
            blockPhotos = e.target.checked;
            localStorage.setItem("tf_block_photos", blockPhotos);
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
        if (document.getElementById('tiktok-fix-panel')) return;

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
                    <option value="FR">Франция (FR)</option>
                    <option value="US">США (US)</option>
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
                <label style="display: block; font-size: 11px; color: rgba(255,255,255,0.55); margin-bottom: 4px; font-weight: 600;">Действия с текущим видео</label>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
                    <button id="tf-download" style="background: #fe2c55; border: none; color: #fff; border-radius: 6px; padding: 8px; font-size: 12px; font-weight: 600; cursor: pointer;">Видео (MP4)</button>
                    <button id="tf-download-audio" style="background: #252533; border: 1px solid #3d3d50; color: #fff; border-radius: 6px; padding: 8px; font-size: 12px; font-weight: 600; cursor: pointer;">Звук (MP3)</button>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 6px;">
                    <button id="tf-copy-desc" style="background: #252533; border: 1px solid #3d3d50; color: #fff; border-radius: 6px; padding: 7px; font-size: 12px; font-weight: 600; cursor: pointer;">Копир. текст</button>
                    <button id="tf-trans-desc" style="background: #252533; border: 1px solid #3d3d50; color: #fff; border-radius: 6px; padding: 7px; font-size: 12px; font-weight: 600; cursor: pointer;">Перевести</button>
                </div>
                <button id="tf-clear" style="width: 100%; background: #1f1f2b; color: #aaa; border: 1px solid #303040; border-radius: 6px; padding: 6px; font-size: 11px; cursor: pointer; margin-top: 8px;">Очистить кэш браузера</button>
            </div>

            <div style="font-size: 11px; color: rgba(255,255,255,0.45); margin-top: 8px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 8px; line-height: 1.4;">
                Клавиши: ←/→ (5 сек), [/] (скорость), P (PiP), Колесико (звук)
            </div>
        `;
        document.body.appendChild(panel);

        document.getElementById('tf-close').onclick = togglePanel;

        let sel = document.getElementById('tf-region');
        if (sel) sel.value = currentRegion;

        document.getElementById('tf-region').onchange = (e) => {
            currentRegion = e.target.value;
            localStorage.setItem("tf_region", currentRegion);
            fetch(`http://127.0.0.1:28889/api/set_region?code=${currentRegion}`).then(() => location.reload()).catch(() => location.reload());
        };
        document.getElementById('tf-reconnect').onclick = () => {
            fetch('http://127.0.0.1:28889/api/reconnect').then(() => setTimeout(() => location.reload(), 500)).catch(() => location.reload());
        };
        document.getElementById('tf-clear').onclick = () => {
            if (confirm('Сбросить кэш и обновить сессию?')) {
                fetch('http://127.0.0.1:28889/api/clear_cache').then(() => location.reload()).catch(() => location.reload());
            }
        };
        document.getElementById('tf-cb-ads').onchange = (e) => {
            blockAds = e.target.checked;
            localStorage.setItem("tf_block_ads", blockAds);
            filterContent();
        };
        document.getElementById('tf-cb-streams').onchange = (e) => {
            blockStreams = e.target.checked;
            localStorage.setItem("tf_block_streams", blockStreams);
            filterContent();
        };
        document.getElementById('tf-cb-photos').onchange = (e) => {
            blockPhotos = e.target.checked;
            localStorage.setItem("tf_block_photos", blockPhotos);
            filterContent();
        };
        document.getElementById('tf-download').onclick = () => {
            downloadCurrentVideo(document.getElementById('tf-download'));
        };
        document.getElementById('tf-download-audio').onclick = () => {
            downloadCurrentAudio(document.getElementById('tf-download-audio'));
        };
        document.getElementById('tf-copy-desc').onclick = () => {
            copyCurrentDescription(document.getElementById('tf-copy-desc'));
        };
        document.getElementById('tf-trans-desc').onclick = () => {
            translateCurrentDescription(document.getElementById('tf-trans-desc'));
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
    // 10. Global Keyboard Hotkeys
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

        // ArrowLeft: Rewind 5s
        if (e.key === 'ArrowLeft' || e.code === 'ArrowLeft') {
            if (v) {
                e.preventDefault();
                v.currentTime = Math.max(0, v.currentTime - 5);
                showVideoToast('◄◄ 5 сек');
            }
        }
        // ArrowRight: Forward 5s
        else if (e.key === 'ArrowRight' || e.code === 'ArrowRight') {
            if (v) {
                e.preventDefault();
                v.currentTime = Math.min(v.duration || 9999, v.currentTime + 5);
                showVideoToast('5 сек ►►');
            }
        }
        // BracketLeft '[': Slow down
        else if (e.key === '[' || e.code === 'BracketLeft') {
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
            if (v) {
                e.preventDefault();
                if (document.pictureInPictureElement) {
                    document.exitPictureInPicture().then(() => showVideoToast('PiP выключен')).catch(() => {});
                } else if (document.pictureInPictureEnabled) {
                    v.requestPictureInPicture().then(() => showVideoToast('Картинка в картинке')).catch(() => {});
                }
            }
        }
    }, true);

    // Global Tick called continuously
    window.tikTokFixTick = function() {
        createSettingsPanel();
        updateFabSettingsButton();
        updateSettingsPage();
        updateVideoDates();
        updateRepostTab();
        cleanupProfileBanners();
        filterContent();
        bindVideoVolume();
    };

    // Run interval
    setInterval(window.tikTokFixTick, 1000);
    window.tikTokFixTick();
})();
