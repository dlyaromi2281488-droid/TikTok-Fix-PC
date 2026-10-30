// =========================================================================
// TikTok Fix Core Injected Engine v2.3
// Pure Native TikTok Style (Zero Emojis, Native Fonts & Themes)
// Includes: Repost Tab Unhide, Video Publication Date, Bottom-Right Settings,
//           One-Click Direct Video Downloader
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
            if (it && it.id && it.video) {
                let vid = it.video;
                let url = (typeof vid.playAddr === 'string' ? vid.playAddr : (vid.playAddr?.urlList?.[0])) ||
                          (typeof vid.downloadAddr === 'string' ? vid.downloadAddr : (vid.downloadAddr?.urlList?.[0])) ||
                          (vid.bitrate?.[vid.bitrate.length - 1]?.playAddr?.urlList?.[0]);
                let audioUrl = it.music?.playUrl || (it.music?.playUrl?.urlList?.[0]) || '';
                if (url || audioUrl) {
                    window.__TIKTOK_FIX_VIDEOS.set(String(it.id), {
                        id: String(it.id),
                        url: url,
                        audioUrl: audioUrl,
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
                if (k.startsWith('__reactProps')) {
                    let p = curr[k];
                    if (p) {
                        let item = p.itemInfo || p.item || p.videoData || p.aweme || p.videoInfo;
                        if (item && (item.id || item.createTime || item.video)) return item;
                        if (p.id && String(p.id).length >= 18) return p;
                    }
                }
            }
            curr = curr.parentElement;
            depth++;
        }
        return null;
    }

    let rehydrationCache = null;
    function getRehydrationItems() {
        if (rehydrationCache) return rehydrationCache;
        try {
            let el = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
            if (el && el.textContent) {
                let data = JSON.parse(el.textContent);
                let defaultScope = data['__DEFAULT_SCOPE__'] || {};
                let items = [];
                for (let k in defaultScope) {
                    let scope = defaultScope[k];
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
    // 1. Publication Date (Clean Native Style, No Emojis)
    // -------------------------------------------------------------
    function updateVideoDates() {
        // Remove any dates that were placed under or near an avatar
        document.querySelectorAll('.tiktok-fix-date').forEach(el => {
            if (el.closest('[data-e2e="video-author-avatar"]') || 
                (el.previousElementSibling && (el.previousElementSibling.getAttribute('data-e2e') === 'video-author-avatar' || el.previousElementSibling.querySelector('img')))) {
                el.remove();
                return;
            }
            if (el.textContent.includes('📅')) {
                el.textContent = el.textContent.replace('📅', '·').trim();
            }
        });

        // Target ONLY elements in Creator Info containers (NOT the right-side avatar)
        let authorEls = Array.from(document.querySelectorAll(
            'div[class*="DivCreatorInfoContainer"] a, div[data-e2e="video-author-info"] a, div[data-e2e="video-author-info"] h3, [data-e2e="video-author-uniqueid"], div[class*="DivCreatorInfoContainer"] p[class*="StyledTUXText"]'
        ));

        authorEls.forEach(author => {
            // NEVER attach to avatar!
            if (author.getAttribute('data-e2e') === 'video-author-avatar' ||
                author.closest('[data-e2e="video-author-avatar"]') ||
                author.querySelector('img') ||
                author.closest('div[class*="Avatar"]') ||
                author.closest('span[class*="Avatar"]') ||
                author.classList.contains('AvatarLink') ||
                author.className.includes('Avatar')) {
                return;
            }
            if (author.querySelector('.tiktok-fix-date')) return;
            if (author.parentElement && author.parentElement.querySelector('.tiktok-fix-date')) return;
            if (author.nextElementSibling && author.nextElementSibling.classList.contains('tiktok-fix-date')) return;

            let rect = author.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return;

            let authorText = author.innerText.trim().replace(/^@/, '');
            let dateStr = null;

            let itemData = getVideoDataFromElement(author);
            if (itemData) {
                if (itemData.createTime) dateStr = formatTimestamp(itemData.createTime);
                else if (itemData.id) dateStr = getDateFromVideoId(itemData.id);
            }

            if (!dateStr && authorText) {
                let items = getRehydrationItems();
                let matched = items.find(it => {
                    let uId = (it.author && it.author.uniqueId) || '';
                    return uId.toLowerCase() === authorText.toLowerCase();
                });
                if (matched) {
                    if (matched.createTime) dateStr = formatTimestamp(matched.createTime);
                    else if (matched.id) dateStr = getDateFromVideoId(matched.id);
                }
            }

            if (!dateStr) {
                let container = author.closest('article[data-e2e="recommend-list-item-container"]') || author.closest('[data-e2e="recommend-list-item"]') || author.closest('div[class*="ItemContainer"]') || author.parentElement.parentElement;
                if (container) {
                    let vItemData = getVideoDataFromElement(container);
                    if (vItemData && vItemData.id) {
                        dateStr = getDateFromVideoId(vItemData.id);
                    }
                    if (!dateStr) {
                        let link = container.querySelector('a[href*="/video/"]');
                        if (link) {
                            let m = link.href.match(/\/video\/(\d+)/);
                            if (m) dateStr = getDateFromVideoId(m[1]);
                        }
                    }
                    if (!dateStr) {
                        let html = container.innerHTML;
                        let m = html.match(/\/video\/(\d{18,19})/);
                        if (m) dateStr = getDateFromVideoId(m[1]);
                    }
                }
            }

            if (!dateStr && window.location.href.includes('/video/')) {
                let m = window.location.href.match(/\/video\/(\d+)/);
                if (m) dateStr = getDateFromVideoId(m[1]);
            }

            if (!dateStr) {
                let v = document.querySelector('video');
                if (v) {
                    let vData = getVideoDataFromElement(v);
                    if (vData && (vData.createTime || vData.id)) {
                        dateStr = vData.createTime ? formatTimestamp(vData.createTime) : getDateFromVideoId(vData.id);
                    }
                }
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
                tab.className = sampleTab ? sampleTab.className : 'css-1wqesiq-7937d88b--PRepost e10obkj23';
                tab.style.cssText = 'display: inline-flex !important; cursor: pointer; user-select: none;';
                tab.innerHTML = '<span>Репосты</span>';
                
                tab.onclick = () => {
                    tabBar.querySelectorAll('[role="tab"]').forEach(t => {
                        t.setAttribute('aria-selected', 'false');
                        t.classList.remove('active');
                    });
                    tab.setAttribute('aria-selected', 'true');
                    
                    try {
                        let el = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
                        let d = el ? JSON.parse(el.textContent) : {};
                        let u = d['__DEFAULT_SCOPE__'] ? d['__DEFAULT_SCOPE__']['webapp.user-detail'] : null;
                        if (u && u.userInfo && u.userInfo.user) {
                            let secUid = u.userInfo.user.secUid;
                            fetch(`/api/user/repost/item_list/?secUid=${secUid}&count=30&cursor=0`)
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
    // 3. Clean up Profile Backgrounds (Per User Request: Completely Removed)
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
    
    // -------------------------------------------------------------
    // Helper: Active Video Finder
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
    // On-Screen Toast Notification on Video
    // -------------------------------------------------------------
    function showVideoToast(video, text) {
        if (!video) return;
        let container = video.closest('div[class*="DivVideoWrapper"]') ||
                        video.closest('div[class*="DivPlayerContainer"]') ||
                        video.closest('div[class*="ItemContainer"]') ||
                        video.parentElement;
        if (!container) return;
        let existing = container.querySelector('.tf-video-toast');
        if (existing) existing.remove();

        let toast = document.createElement('div');
        toast.className = 'tf-video-toast';
        toast.textContent = text;
        toast.style.cssText = `
            position: absolute !important;
            top: 50% !important;
            left: 50% !important;
            transform: translate(-50%, -50%) !important;
            background: rgba(18, 18, 26, 0.88) !important;
            backdrop-filter: blur(10px) !important;
            border: 1px solid rgba(255, 255, 255, 0.2) !important;
            color: #ffffff !important;
            padding: 8px 18px !important;
            border-radius: 20px !important;
            font-size: 14px !important;
            font-weight: 600 !important;
            z-index: 2147483640 !important;
            pointer-events: none !important;
            font-family: TikTokSans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
            box-shadow: 0 4px 20px rgba(0,0,0,0.6) !important;
            transition: opacity 0.25s ease !important;
            opacity: 1 !important;
            user-select: none !important;
        `;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 250);
        }, 750);
    }

    // -------------------------------------------------------------
    // Feature 5: Volume Memory & Mouse Scroll Volume
    // -------------------------------------------------------------
    function applySavedVolume(v) {
        if (!v) return;
        let savedVol = localStorage.getItem('tf_volume');
        if (savedVol !== null) {
            let vol = parseFloat(savedVol);
            if (!isNaN(vol)) {
                v.volume = Math.max(0, Math.min(1, vol));
                if (vol > 0) v.muted = false;
            }
        }
    }

    function bindWheelAndEvents(container) {
        if (!container || container.dataset.tfWheelBound) return;
        container.dataset.tfWheelBound = 'true';

        container.addEventListener('wheel', function(e) {
            let v = container.querySelector('video') || (container.tagName === 'VIDEO' ? container : document.querySelector('video'));
            if (!v) return;
            e.preventDefault();
            e.stopPropagation();
            let step = 0.05;
            let current = v.volume;
            let newVol = current + (e.deltaY < 0 ? step : -step);
            newVol = Math.max(0, Math.min(1, Math.round(newVol * 100) / 100));
            v.volume = newVol;
            v.muted = (newVol === 0);
            localStorage.setItem('tf_volume', newVol);
            showVideoToast(v, `Громкость: ${Math.round(newVol * 100)}%`);
        }, { passive: false });
    }

    // -------------------------------------------------------------
    // Feature 7: Picture-in-Picture (PiP)
    // -------------------------------------------------------------
    function togglePiP() {
        let v = getActiveVideo();
        if (!v) return;
        if (document.pictureInPictureElement) {
            document.exitPictureInPicture().catch(() => {});
            showVideoToast(v, 'PiP выключен');
        } else if (document.pictureInPictureEnabled) {
            v.requestPictureInPicture().then(() => {
                showVideoToast(v, 'Картинка в картинке');
            }).catch(() => {});
        }
    }

    function updatePiPButtons() {
        let videos = document.querySelectorAll('video');
        videos.forEach(v => {
            applySavedVolume(v);
            let container = v.closest('div[class*="DivVideoWrapper"]') ||
                            v.closest('div[class*="DivPlayerContainer"]') ||
                            v.closest('div[class*="ItemContainer"]') ||
                            v.parentElement;
            if (container) {
                bindWheelAndEvents(container);
                if (!container.querySelector('.tf-pip-btn')) {
                    let pipBtn = document.createElement('button');
                    pipBtn.className = 'tf-pip-btn';
                    pipBtn.title = 'Картинка в картинке (P)';
                    pipBtn.innerHTML = `
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                            <rect x="12" y="9" width="8" height="6" rx="1" ry="1" fill="currentColor"></rect>
                        </svg>
                    `;
                    pipBtn.style.cssText = `
                        position: absolute !important;
                        top: 14px !important;
                        right: 14px !important;
                        background: rgba(18, 18, 26, 0.7) !important;
                        backdrop-filter: blur(8px) !important;
                        border: 1px solid rgba(255, 255, 255, 0.2) !important;
                        border-radius: 50% !important;
                        width: 32px !important;
                        height: 32px !important;
                        display: flex !important;
                        align-items: center !important;
                        justify-content: center !important;
                        color: #ffffff !important;
                        cursor: pointer !important;
                        z-index: 2147483640 !important;
                        opacity: 0.75 !important;
                        transition: opacity 0.2s ease, transform 0.2s ease !important;
                        padding: 0 !important;
                        outline: none !important;
                    `;
                    pipBtn.onmouseover = () => { pipBtn.style.opacity = '1'; pipBtn.style.transform = 'scale(1.1)'; };
                    pipBtn.onmouseout = () => { pipBtn.style.opacity = '0.75'; pipBtn.style.transform = 'scale(1)'; };
                    pipBtn.onclick = (e) => {
                        e.stopPropagation();
                        togglePiP();
                    };
                    container.style.position = container.style.position || 'relative';
                    container.appendChild(pipBtn);
                }
            }
        });
    }

    // -------------------------------------------------------------
    // Feature 6: Copy Caption & Translate Description
    // -------------------------------------------------------------
    function updateDescriptionActions() {
        let descEls = document.querySelectorAll('h1[data-e2e="browse-video-desc"], div[data-e2e="browse-video-desc"], [data-e2e="user-post-item-desc"], div[class*="DivTextInfoContainer"] h1');
        descEls.forEach(el => {
            if (el.dataset.tfDescActionsBound) return;
            el.dataset.tfDescActionsBound = 'true';

            let rawText = el.innerText || '';
            if (!rawText.trim()) return;

            let actionsRow = document.createElement('div');
            actionsRow.className = 'tf-desc-actions';
            actionsRow.style.cssText = `
                display: flex !important;
                align-items: center !important;
                gap: 8px !important;
                margin-top: 6px !important;
                margin-bottom: 6px !important;
                user-select: none !important;
            `;

            // Copy button
            let copyBtn = document.createElement('button');
            copyBtn.textContent = 'Копировать текст';
            copyBtn.style.cssText = `
                background: rgba(255, 255, 255, 0.08) !important;
                border: 1px solid rgba(255, 255, 255, 0.16) !important;
                border-radius: 6px !important;
                padding: 3px 8px !important;
                font-size: 11px !important;
                font-weight: 600 !important;
                color: rgba(255, 255, 255, 0.85) !important;
                cursor: pointer !important;
                transition: background 0.15s ease !important;
            `;
            copyBtn.onmouseover = () => { copyBtn.style.background = 'rgba(255, 255, 255, 0.15)'; };
            copyBtn.onmouseout = () => { copyBtn.style.background = 'rgba(255, 255, 255, 0.08)'; };
            copyBtn.onclick = (e) => {
                e.stopPropagation();
                let clean = el.innerText.replace(/Копировать текст|Перевести|Скрыть перевод/g, '').trim();
                navigator.clipboard.writeText(clean).then(() => {
                    let prev = copyBtn.textContent;
                    copyBtn.textContent = 'Скопировано!';
                    setTimeout(() => { copyBtn.textContent = prev; }, 1500);
                });
            };
            actionsRow.appendChild(copyBtn);

            // Translate button (if contains Latin or other non-Cyrillic words)
            let hasForeign = /[a-zA-Z]{3,}/.test(rawText);
            if (hasForeign) {
                let transBtn = document.createElement('button');
                transBtn.textContent = 'Перевести';
                transBtn.style.cssText = copyBtn.style.cssText;
                transBtn.onmouseover = () => { transBtn.style.background = 'rgba(255, 255, 255, 0.15)'; };
                transBtn.onmouseout = () => { transBtn.style.background = 'rgba(255, 255, 255, 0.08)'; };

                let transBox = null;
                transBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (transBox) {
                        if (transBox.style.display === 'none') {
                            transBox.style.display = 'block';
                            transBtn.textContent = 'Скрыть перевод';
                        } else {
                            transBox.style.display = 'none';
                            transBtn.textContent = 'Перевести';
                        }
                        return;
                    }

                    transBtn.textContent = 'Перевод...';
                    let clean = el.innerText.replace(/Копировать текст|Перевести|Скрыть перевод/g, '').trim();
                    fetch(`http://127.0.0.1:28889/api/translate?text=${encodeURIComponent(clean)}`)
                        .then(r => r.json())
                        .then(d => {
                            if (d.success && d.translated) {
                                transBox = document.createElement('div');
                                transBox.className = 'tf-desc-translated';
                                transBox.style.cssText = `
                                    margin-top: 6px !important;
                                    padding-left: 10px !important;
                                    border-left: 2px solid #fe2c55 !important;
                                    color: rgba(255, 255, 255, 0.75) !important;
                                    font-size: 13px !important;
                                    line-height: 1.4 !important;
                                    font-style: italic !important;
                                `;
                                transBox.textContent = d.translated;
                                actionsRow.parentNode.insertBefore(transBox, actionsRow.nextSibling);
                                transBtn.textContent = 'Скрыть перевод';
                            } else {
                                transBtn.textContent = 'Перевести';
                            }
                        })
                        .catch(() => { transBtn.textContent = 'Перевести'; });
                };
                actionsRow.appendChild(transBtn);
            }

            el.parentNode.insertBefore(actionsRow, el.nextSibling);
        });
    }

    // -------------------------------------------------------------
    // Feature 14: Fast Translate for Comments
    // -------------------------------------------------------------
    function updateCommentsTranslation() {
        let commentContainers = document.querySelectorAll('div[data-e2e="comment-level-1"], div[data-e2e="comment-level-2"], div[class*="DivCommentItemContainer"]');
        commentContainers.forEach(container => {
            if (container.dataset.tfCommentBound) return;
            container.dataset.tfCommentBound = 'true';

            let pText = container.querySelector('p[data-e2e="comment-text"], span[class*="SpanCommentText"]');
            if (!pText) return;

            let text = pText.innerText || '';
            if (!/[a-zA-Z]{3,}/.test(text)) return;

            let btn = document.createElement('span');
            btn.className = 'tf-comment-translate-btn';
            btn.textContent = ' · Перевести';
            btn.style.cssText = `
                display: inline-block !important;
                margin-left: 6px !important;
                font-size: 12px !important;
                color: rgba(255, 255, 255, 0.5) !important;
                cursor: pointer !important;
                font-weight: 600 !important;
                user-select: none !important;
                transition: color 0.15s ease !important;
            `;
            btn.onmouseover = () => { btn.style.color = '#fe2c55'; };
            btn.onmouseout = () => { btn.style.color = 'rgba(255, 255, 255, 0.5)'; };

            let translationDiv = null;
            btn.onclick = (e) => {
                e.stopPropagation();
                if (translationDiv) {
                    if (translationDiv.style.display === 'none') {
                        translationDiv.style.display = 'block';
                        btn.textContent = ' · Скрыть перевод';
                    } else {
                        translationDiv.style.display = 'none';
                        btn.textContent = ' · Перевести';
                    }
                    return;
                }

                btn.textContent = ' · Перевод...';
                let commentContent = pText.innerText.trim();
                fetch(`http://127.0.0.1:28889/api/translate?text=${encodeURIComponent(commentContent)}`)
                    .then(r => r.json())
                    .then(d => {
                        if (d.success && d.translated) {
                            translationDiv = document.createElement('div');
                            translationDiv.className = 'tf-comment-translation-box';
                            translationDiv.style.cssText = `
                                margin-top: 4px !important;
                                padding-left: 8px !important;
                                border-left: 2px solid #fe2c55 !important;
                                color: rgba(255, 255, 255, 0.75) !important;
                                font-size: 13px !important;
                                line-height: 1.35 !important;
                            `;
                            translationDiv.textContent = d.translated;
                            pText.parentNode.insertBefore(translationDiv, pText.nextSibling);
                            btn.textContent = ' · Скрыть перевод';
                        } else {
                            btn.textContent = ' · Перевести';
                        }
                    })
                    .catch(() => { btn.textContent = ' · Перевести'; });
            };

            pText.appendChild(btn);
        });
    }

    // -------------------------------------------------------------
    // Feature 4: Download Audio / Sound (MP3)
    // -------------------------------------------------------------
    function downloadCurrentAudio(btn) {
        if (!btn) return;
        let origText = btn.textContent;
        btn.textContent = 'Поиск аудио...';

        let directUrl = null;
        let audioUrl = null;
        let pageUrl = window.location.href;
        let videoId = null;

        let videos = Array.from(document.querySelectorAll('video'));
        let activeVideo = videos.find(v => !v.paused && v.currentTime > 0) || videos[0];

        if (activeVideo) {
            let vData = getVideoDataFromElement(activeVideo);
            if (!vData && activeVideo.parentElement) {
                let container = activeVideo.closest('article[data-e2e="recommend-list-item-container"]') || 
                                activeVideo.closest('[data-e2e="recommend-list-item"]') || 
                                activeVideo.closest('div[class*="ItemContainer"]') ||
                                activeVideo.parentElement.parentElement;
                if (container) vData = getVideoDataFromElement(container);
            }
            if (vData) {
                if (vData.id) videoId = String(vData.id);
                if (vData.music) {
                    audioUrl = vData.music.playUrl || (vData.music.playUrl?.urlList?.[0]) || '';
                }
                if (vData.video) {
                    let vid = vData.video;
                    directUrl = (typeof vid.playAddr === 'string' ? vid.playAddr : (vid.playAddr?.urlList?.[0])) ||
                                (typeof vid.downloadAddr === 'string' ? vid.downloadAddr : (vid.downloadAddr?.urlList?.[0])) ||
                                (vid.bitrate?.[vid.bitrate.length - 1]?.playAddr?.urlList?.[0]);
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
            if (info.author && !pageUrl.includes('/video/')) {
                pageUrl = `https://www.tiktok.com/@${info.author}/video/${videoId}`;
            }
        }

        btn.textContent = 'Скачивание MP3...';

        fetch(`http://127.0.0.1:28889/api/download_audio?page=${encodeURIComponent(pageUrl)}&src=${encodeURIComponent(directUrl || '')}&audio_src=${encodeURIComponent(audioUrl || '')}`)
            .then(r => r.json())
            .then(data => {
                btn.textContent = origText;
                if (data.success) {
                    alert(`Аудиодорожка успешно сохранена в Загрузки!\\nФайл: ${data.filename}`);
                } else {
                    alert(`Ошибка скачивания: ${data.error || 'Не удалось получить аудио'}`);
                }
            })
            .catch(err => {
                btn.textContent = origText;
                alert(`Ошибка соединения: ${err}`);
            });
    }

    // 5. Video Downloader Engine (Direct CDN + Fallback)
    // -------------------------------------------------------------
    function downloadCurrentVideo(btn) {
        if (!btn) return;
        let origText = btn.textContent;
        btn.textContent = 'Поиск видео...';

        let directUrl = null;
        let pageUrl = window.location.href;
        let videoId = null;

        // 1. Find currently active/playing video
        let videos = Array.from(document.querySelectorAll('video'));
        let activeVideo = videos.find(v => !v.paused && v.currentTime > 0) || videos[0];

        if (activeVideo) {
            // Check direct URL on video element
            if (activeVideo.currentSrc && activeVideo.currentSrc.startsWith('http') && !activeVideo.currentSrc.startsWith('blob:')) {
                directUrl = activeVideo.currentSrc;
            }

            // Extract from React Fiber
            let vData = getVideoDataFromElement(activeVideo);
            if (!vData && activeVideo.parentElement) {
                let container = activeVideo.closest('article[data-e2e="recommend-list-item-container"]') || 
                                activeVideo.closest('[data-e2e="recommend-list-item"]') || 
                                activeVideo.closest('div[class*="ItemContainer"]') ||
                                activeVideo.parentElement.parentElement;
                if (container) vData = getVideoDataFromElement(container);
            }

            if (vData) {
                if (vData.id) videoId = String(vData.id);
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

        // 2. Check URL for /video/12345
        let m = window.location.href.match(/\/video\/(\d+)/);
        if (m) {
            videoId = m[1];
            pageUrl = window.location.href;
        }

        // 3. Check intercepted feed map
        if (videoId && window.__TIKTOK_FIX_VIDEOS && window.__TIKTOK_FIX_VIDEOS.has(videoId)) {
            let info = window.__TIKTOK_FIX_VIDEOS.get(videoId);
            if (info.url) directUrl = info.url;
            if (info.author && !pageUrl.includes('/video/')) {
                pageUrl = `https://www.tiktok.com/@${info.author}/video/${videoId}`;
            }
        }

        // 4. Check rehydration data
        if (!directUrl) {
            let rehydration = getRehydrationItems();
            let matched = videoId ? rehydration.find(it => String(it.id) === String(videoId)) : rehydration[0];
            if (matched && matched.video) {
                let vid = matched.video;
                directUrl = (typeof vid.playAddr === 'string' ? vid.playAddr : (vid.playAddr?.urlList?.[0])) ||
                            (typeof vid.downloadAddr === 'string' ? vid.downloadAddr : (vid.downloadAddr?.urlList?.[0])) ||
                            (vid.bitrate?.[vid.bitrate.length - 1]?.playAddr?.urlList?.[0]);
                if (matched.author && matched.author.uniqueId && matched.id) {
                    pageUrl = `https://www.tiktok.com/@${matched.author.uniqueId}/video/${matched.id}`;
                }
            }
        }

        btn.textContent = 'Скачивание...';

        fetch(`http://127.0.0.1:28889/api/download?page=${encodeURIComponent(pageUrl)}&src=${encodeURIComponent(directUrl || '')}`)
            .then(r => r.json())
            .then(data => {
                btn.textContent = origText;
                if (data.success) {
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

    // -------------------------------------------------------------
    // 6. Mod Settings Button (Bottom-Right Floating Gear, No Text)
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
    // 7. Native Settings Section on /setting (Clean TikTok UI)
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
                        <option value="DE">Германия (DE)</option>
                        <option value="NL">Нидерланды (NL)</option>
                        <option value="US">США (US)</option>
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
                <span style="font-size: 12px; color: rgba(255, 255, 255, 0.45);">Дата публикации, репосты и перевод отображаются автоматически</span>
            </div>
        `;

        manageContainer.parentNode.insertBefore(section, manageContainer);

        // Sidebar Navigation Item
        let navScroll = document.querySelector('div[class*="DivNavScrollContainer"]');
        if (navScroll && !document.getElementById('tf-nav-item')) {
            let navItem = document.createElement('div');
            navItem.id = 'tf-nav-item';
            navItem.className = 'css-q9noqo-7937d88b--DivNavItem e1fq0y1c7';
            navItem.style.cssText = 'cursor: pointer; margin-bottom: 8px;';
            navItem.innerHTML = `
                <span class="css-okyuyz-7937d88b--SpanItemContent e1fq0y1c9" style="color: #fe2c55; font-weight: 600;">
                    TikTok Fix
                </span>
            `;
            navItem.onclick = () => {
                let target = document.getElementById('tiktok-fix-native-section');
                if (target) target.scrollIntoView({ behavior: 'smooth' });
            };
            navItem.onmouseover = () => { navItem.style.background = 'rgba(255, 255, 255, 0.06)'; };
            navItem.onmouseout = () => { navItem.style.background = 'transparent'; };
            navScroll.insertBefore(navItem, navScroll.firstChild);
        }

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
    // 8. Floating Settings Panel (Clean Native Style, No Emojis)
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
                    <option value="DE">Германия (DE)</option>
                    <option value="NL">Нидерланды (NL)</option>
                    <option value="US">США (US)</option>
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
                <label style="display: block; font-size: 11px; color: rgba(255,255,255,0.55); margin-bottom: 4px; font-weight: 600;">Действия</label>
                <button id="tf-download" style="width: 100%; background: #fe2c55; border: none; color: #fff; border-radius: 6px; padding: 8px; font-size: 12px; font-weight: 600; cursor: pointer;">Скачать видео</button>
                <button id="tf-download-audio" style="width: 100%; background: #252533; color: #fff; border: 1px solid #3d3d50; border-radius: 6px; padding: 8px; font-size: 12px; font-weight: 600; cursor: pointer; margin-top: 6px;">Скачать звук (MP3)</button>
                <button id="tf-clear" style="width: 100%; background: #252533; color: #fff; border: 1px solid #3d3d50; border-radius: 6px; padding: 7px; font-size: 12px; font-weight: 600; cursor: pointer; margin-top: 6px;">Очистить кэш</button>
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
        let bAudioFloat = document.getElementById('tf-download-audio');
        if (bAudioFloat) {
            bAudioFloat.onclick = () => {
                downloadCurrentAudio(bAudioFloat);
            };
        }
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

    // Keyboard Hotkeys: Settings (Right Alt / 0), Speed, Rewind, PiP
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

        // ArrowLeft: Rewind 5s
        if (e.key === 'ArrowLeft' || e.code === 'ArrowLeft') {
            let v = getActiveVideo();
            if (v) {
                e.preventDefault();
                v.currentTime = Math.max(0, v.currentTime - 5);
                showVideoToast(v, '◄◄ 5 сек');
            }
        }
        // ArrowRight: Forward 5s
        else if (e.key === 'ArrowRight' || e.code === 'ArrowRight') {
            let v = getActiveVideo();
            if (v) {
                e.preventDefault();
                v.currentTime = Math.min(v.duration || 9999, v.currentTime + 5);
                showVideoToast(v, '5 сек ►►');
            }
        }
        // BracketLeft '[': Slow down
        else if (e.key === '[' || e.code === 'BracketLeft') {
            let v = getActiveVideo();
            if (v) {
                e.preventDefault();
                let speeds = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
                let cur = v.playbackRate || 1.0;
                let idx = speeds.findIndex(s => Math.abs(s - cur) < 0.05);
                if (idx === -1) idx = 2;
                let nextIdx = Math.max(0, idx - 1);
                v.playbackRate = speeds[nextIdx];
                showVideoToast(v, `Скорость: ${speeds[nextIdx]}x`);
            }
        }
        // BracketRight ']': Speed up
        else if (e.key === ']' || e.code === 'BracketRight') {
            let v = getActiveVideo();
            if (v) {
                e.preventDefault();
                let speeds = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
                let cur = v.playbackRate || 1.0;
                let idx = speeds.findIndex(s => Math.abs(s - cur) < 0.05);
                if (idx === -1) idx = 2;
                let nextIdx = Math.min(speeds.length - 1, idx + 1);
                v.playbackRate = speeds[nextIdx];
                showVideoToast(v, `Скорость: ${speeds[nextIdx]}x`);
            }
        }
        // Key P: Picture-in-Picture
        else if (e.key === 'p' || e.key === 'P' || e.code === 'KeyP') {
            e.preventDefault();
            togglePiP();
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
        updatePiPButtons();
        updateDescriptionActions();
        updateCommentsTranslation();
    };

    // Run interval
    setInterval(window.tikTokFixTick, 1000);
    window.tikTokFixTick();
})();
