// ==UserScript==
// @name         NodeSeek Plus
// @author       tom2almighty
// @description  NodeSeek / DeepFlood 论坛增强脚本：楼中楼树形讨论、头像面板拉黑、快捷回复、图床上传、下拉加载与关键字过滤。
// @namespace    nodeseek-plus
// @version      2.0.0
// @icon         https://www.google.com/s2/favicons?sz=64&domain=nodeseek.com
// @match        *://www.nodeseek.com/*
// @match        *://www.deepflood.com/*
// @require      https://s4.zstatic.net/ajax/libs/layui/2.10.3/layui.min.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @grant        GM.info
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// @grant        GM.listValues
// @grant        GM.xmlHttpRequest
// @run-at       document-idle
// @license      GPL-3.0
// ==/UserScript==
(function () {
    'use strict';
    function runNodeseekPro(apis) {
        const { GM_info, GM_getValue, GM_setValue, GM_xmlhttpRequest, unsafeWindow } = apis;

    // NSX Core - 核心
    const SITES = [
        { host: "www.nodeseek.com", code: "ns", name: "NodeSeek" },
        { host: "www.deepflood.com", code: "df", name: "DeepFlood" }
    ];

    const info = GM_info?.script || {};
    const site = SITES.find(s => s.host === location.host);
    let debug = false;
    try { debug = GM_getValue("settings", {})?.debug?.enabled; } catch { }

    // ===== 环境 =====
    const env = {
        info, site, BASE_URL: location.origin,
        log: (...a) => debug && console.log(`[NSX]`, ...a),
        warn: (...a) => debug && console.warn(`[NSX]`, ...a),
        error: (...a) => console.error(`[NSX]`, ...a)
    };

    // ===== DOM =====
    const $ = (s, r = document) => r?.querySelector(s);
    const $$ = (s, r = document) => [...(r?.querySelectorAll(s) || [])];
    const svgIcon = (id, size = 14, cls = "") => `<svg class="nsx-svg${cls ? " " + cls : ""}" style="width:${size}px;height:${size}px" aria-hidden="true"><use href="#${id}"></use></svg>`;

    function ensureIconGroup() {
        const head = document.querySelector('#nsk-head');
        if (!head) return null;

        const anchor = head.querySelector('.color-theme-switcher');
        const parent = head;

        let grp = document.getElementById('nsx-icon-group');
        if (!grp || grp.tagName !== 'DIV') {
            const old = grp;
            grp = document.createElement('div');
            grp.id = 'nsx-icon-group';
            grp.className = 'right-button-group';
            old?.replaceWith(grp);
        } else if (!grp.className) {
            grp.className = 'right-button-group';
        }

        const target = anchor && anchor.parentElement === parent ? anchor : null;
        if (target) {
            const alreadyInPlace = grp.parentElement === parent && grp.nextSibling === target;
            if (!alreadyInPlace) parent.insertBefore(grp, target);
        } else {
            const searchBox = head.querySelector('.search-box');
            if (searchBox && searchBox.parentElement === parent) {
                const alreadyInPlace = grp.parentElement === parent && grp.nextSibling === searchBox;
                if (!alreadyInPlace) parent.insertBefore(grp, searchBox);
            } else {
                const alreadyInPlace = grp.parentElement === parent && grp === parent.lastElementChild;
                if (!alreadyInPlace) parent.appendChild(grp);
            }
        }
        return grp;
    }

    function addStyle(id, val) {
        if (document.getElementById(id)) return;
        const isUrl = /^(https?:)?\/\//.test(val);
        const el = document.createElement(isUrl ? "link" : "style");
        el.id = id;
        isUrl ? (el.rel = "stylesheet", el.href = val) : (el.textContent = val);
        document.head?.appendChild(el);
    }

    const debounce = (fn, ms) => {
        let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
        d.cancel = () => clearTimeout(t); return d;
    };

    const throttle = (fn, ms) => {
        let last = 0;
        return (...a) => { const now = Date.now(); if (now - last >= ms) { last = now; fn(...a); } };
    };

    // ===== 存储 =====
    let cfgCache = null;
    const getPath = (o, p) => p.split(".").reduce((a, k) => a?.[k], o);
    const setPath = (o, p, v) => { const ks = p.split("."), l = ks.pop(); ks.reduce((a, k) => a[k] ??= {}, o)[l] = v; };

    const store = {
        _load() {
            if (!cfgCache) cfgCache = GM_getValue("settings", null) || {};
            return cfgCache;
        },
        get(p, fb) { const v = getPath(this._load(), p); return v === undefined ? fb : v; },
        set(p, v) { setPath(this._load(), p, v); GM_setValue("settings", cfgCache); }
    };

    // ===== 网络 =====
    const net = {
        async fetch(url, { method = "GET", data, headers = {}, type = "json" } = {}) {
            const r = await fetch(url.startsWith("http") ? url : env.BASE_URL + url, {
                method, credentials: "include",
                headers: { ...(data ? { "Content-Type": "application/json" } : {}), ...headers },
                body: data ? JSON.stringify(data) : undefined
            });
            return r[type]().catch(() => null);
        },
        get: (u, h, t) => net.fetch(u, { headers: h, type: t }),
        post: (u, d, h, t) => net.fetch(u, { method: "POST", data: d, headers: h, type: t })
    };

    // ===== 模块运行 =====
    function runModules(list, ctx) {
        list.filter(Boolean)
            .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
            .forEach(m => {
                if (m.match?.(ctx) === false) return;
                try { m.init?.(ctx); } catch (e) { env.error(m.id, e); }
            });
    }

    /* ==========================================================================
       [ 辅助工具 ] - 自动跳转外部链接
       ========================================================================== */
    const autoJump = {
        id: "autoJump",
        order: 210,
        match: () => true,
        init(ctx) {
            $$('a[href*="/jump?to="]').forEach(a => {
                try {
                    const to = new URL(a.href).searchParams.get("to");
                    if (to) a.href = decodeURIComponent(to);
                } catch { }
            });
            if (/^\/jump/.test(location.pathname)) ctx.$(".btn")?.click();
        }
    };

    /* ==========================================================================
       [ 辅助工具 ] - 下拉加载 / 自动翻页 (Infinite Scroll)
       ========================================================================== */

    const PROFILES = {
        list: { path: /^\/(categories\/|page|award|search|$)/, threshold: 1500, next: ".nsk-pager a.pager-next", list: "ul.post-list:not(.topic-carousel-panel)", pagerTop: "div.nsk-pager.pager-top", pagerBot: "div.nsk-pager.pager-bottom" },
        post: { path: /^\/post-/, threshold: 690, next: ".nsk-pager a.pager-next", list: "ul.comments", pagerTop: "div.nsk-pager.post-top-pager", pagerBot: "div.nsk-pager.post-bottom-pager" }
    };

    const autoLoading = {
        id: "autoLoading",
        order: 220,
        match: ctx => ctx.isList || ctx.isPost,
        init(ctx) {
            const profile = ctx.isList ? PROFILES.list : ctx.isPost ? PROFILES.post : null;
            if (!profile) return;

            const cfgKey = ctx.isList ? "loading_post.enabled" : "loading_comment.enabled";
            let isEnabled = ctx.store.get(cfgKey, false);

            // 注入快捷开关按钮：纯净创造节点，以原生的 class 和 CSS 层叠逻辑定位
            const navGroup = ctx.$("#fast-nav-button-group");
            if (navGroup) {
                const btn = document.createElement("a");
                btn.className = "nav-item-btn";
                btn.id = "nsx-toggle-autoload";
                btn.href = "javascript:void(0);";

                const updateBtn = () => {
                    // 开启时：绿色向下加载流水线； 关闭时：鲜红色带禁止图标
                    if (isEnabled) {
                        btn.title = "瀑布流自动加载：已开启 (点击休眠)";
                        btn.innerHTML = `<svg viewBox="0 0 48 48" fill="none" class="iconpark-icon" style="width:24px;height:24px;color:#4caf50;"><path d="M24 10V38M12 26L24 38L36 26" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
                    } else {
                        btn.title = "瀑布流自动加载：已休眠 (点击开启)";
                        btn.innerHTML = `<svg viewBox="0 0 48 48" fill="none" class="iconpark-icon" style="width:24px;height:24px;color:#f44336;"><path d="M24 10V38M12 26L24 38L36 26" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 8L40 40" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
                    }
                };
                updateBtn();

                btn.onclick = (e) => {
                    e.preventDefault();
                    isEnabled = !isEnabled;
                    ctx.store.set(cfgKey, isEnabled);
                    updateBtn();
                    ctx.ui?.[isEnabled ? "success" : "info"]?.(isEnabled ? "瀑布流向下加载已开启" : "瀑布流加载已停用");
                };

                // 置于结构序列的第一位，由扩展的 nth-last-child CSS 接管精准定位！
                navGroup.prepend(btn);
            }

            let busy = false, prevY = scrollY;

            const processCommentMenus = (commentElements) => {
                if (!ctx.isPost || !commentElements?.length) return;
                const existingMenu = document.querySelector(".comment-menu");
                const vue = existingMenu?.__vue__;
                if (!vue?.$root?.constructor || !vue?.$options) return;
                const startIndex = document.querySelectorAll(".content-item").length - commentElements.length;
                commentElements.forEach((comment, index) => {
                    const menuMount = document.createElement("div");
                    menuMount.className = "comment-menu-mount";
                    comment.appendChild(menuMount);
                    try {
                        const menuInstance = new vue.$root.constructor(vue.$options);
                        if (typeof menuInstance.setIndex === "function") menuInstance.setIndex(startIndex + index);
                        if (typeof menuInstance.$mount === "function") menuInstance.$mount(menuMount);
                    } catch { }
                });
            };

            const load = async () => {
                if (!isEnabled || busy) return;
                const atBottom = document.documentElement.scrollHeight <= innerHeight + scrollY + profile.threshold;
                if (!atBottom) return;
                const nextUrl = ctx.$(profile.next)?.href;
                if (!nextUrl) return;

                busy = true;
                try {
                    const html = await net.get(nextUrl, {}, "text");
                    const doc = new DOMParser().parseFromString(html, "text/html");

                    // 评论数据同步
                    if (ctx.isPost) {
                        const json = doc.getElementById("temp-script")?.textContent;
                        if (json) try {
                            const cfg = JSON.parse(decodeURIComponent(atob(json).split("").map(c => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join("")));
                            if (cfg?.postData?.comments) ctx.uw.__config__.postData.comments.push(...cfg.postData.comments);
                        } catch { }
                    }

                    const src = doc.querySelector(profile.list), dst = document.querySelector(profile.list);
                    if (src && dst) {
                        const appended = Array.from(src.children);
                        dst.append(...appended);
                        processCommentMenus(appended);
                        if (ctx.isPost) window.__nsxRuntime?.rebuildThreads?.();
                    }

                    [profile.pagerTop, profile.pagerBot].forEach(sel => {
                        const s = doc.querySelector(sel), d = document.querySelector(sel);
                        if (s && d) d.innerHTML = s.innerHTML;
                    });

                    history.pushState(null, null, nextUrl);
                } catch (e) { ctx.env.error("autoLoading", e); }
                busy = false;
            };

            const deb = debounce(load, 300);
            addEventListener("scroll", throttle(() => { if (scrollY > prevY) deb(); prevY = scrollY; }, 200), { passive: true });

            document.addEventListener('click', e => {
                const a = e.target.closest('a');
                if (a && (a.classList.contains('pager-pos') || a.classList.contains('pager-prev') || a.classList.contains('pager-next') || a.closest('.nsk-pager'))) {
                    a.target = '_self';
                    e.stopImmediatePropagation();
                }
            }, true);
        }
    };

    /* ==========================================================================
       [ 过滤设置 ] - 关键字过滤 (帖子屏蔽与高亮)
       ========================================================================== */
    const blockPosts = {
        id: "blockPosts",
        order: 380,
        match: ctx => ctx.isList || ctx.isPost,
        init(ctx) {
            const keywordsKey = 'nsx_advanced_keywords';
            const getMap = () => { try { return JSON.parse(localStorage.getItem(keywordsKey) || '{}'); } catch { return {}; } };
            const saveMap = (map) => localStorage.setItem(keywordsKey, JSON.stringify(map));
            const getDefaultHighlightColor = () => ctx.store.get("block_posts.highlight_color", "#fff9c4") || "#fff9c4";
            const setDefaultHighlightColor = (color) => ctx.store.set("block_posts.highlight_color", color || "#fff9c4");
            const toHexColor = (color, fallback = "#fff9c4") => {
                const s = String(color || "").trim();
                if (/^#[0-9a-f]{6}$/i.test(s)) return s;
                const m3 = s.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
                if (m3) return `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`;
                const rgb = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
                if (rgb) return "#" + [rgb[1], rgb[2], rgb[3]].map(n => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, "0")).join("");
                return fallback;
            };

            const runFilter = (els) => {
                const kws = getMap();
                const kwEntries = Object.entries(kws);
                if (!kwEntries.length) return;
                const hColor = getDefaultHighlightColor();

                els.forEach(item => {
                    if (item.dataset.nsxKwProcessed) return;
                    const titleEl = item.querySelector(".post-title>a");
                    const title = titleEl?.textContent?.toLowerCase() || "";
                    if (!title) return;

                    let matchedColors = [];
                    let shouldHide = false;
                    let foldWords = [];

                    for (const [word, info] of kwEntries) {
                        const groupWords = String(word || "").split(/[，,]/).map(s => s.trim().toLowerCase()).filter(Boolean);
                        if (!groupWords.length) continue;
                        const hit = groupWords.some(w => title.includes(w));
                        if (!hit) continue;

                        if (info.type === 'highlight') {
                            matchedColors.push(info.color || hColor);
                        } else if (info.type === 'block') {
                            if (info.mode === 'hide') {
                                shouldHide = true;
                                break;
                            } else {
                                foldWords.push(word);
                            }
                        }
                    }

                    if (shouldHide) {
                        item.style.display = 'none';
                    } else if (foldWords.length > 0) {
                        item.classList.add('nsx-post-folded');
                        if (!item.querySelector('.nsx-fold-notice')) {
                            const notice = document.createElement('div');
                            notice.className = 'nsx-fold-notice';
                            notice.style.padding = '10px 15px';
                            const kwText = foldWords.map(w => w.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])).join(', ');
                            notice.innerHTML = `<span>已折叠包含关键词 [<b>${kwText}</b>] 的主题</span><span class="nsx-unfold-btn" style="text-decoration:underline;cursor:pointer">点此查看</span>`;
                            notice.querySelector('.nsx-unfold-btn').onclick = () => { item.classList.remove('nsx-post-folded'); notice.style.display = 'none'; };
                            item.prepend(notice);
                        }
                    } else if (matchedColors.length > 0) {
                        item.style.transition = "background-color 0.3s, background 0.3s";
                        if (matchedColors.length === 1) {
                            item.style.backgroundColor = matchedColors[0];
                        } else {
                            const uniqueColors = [...new Set(matchedColors)];
                            if (uniqueColors.length === 1) {
                                item.style.backgroundColor = uniqueColors[0];
                            } else {
                                item.style.background = `linear-gradient(90deg, ${uniqueColors.join(', ')})`;
                            }
                        }
                    }

                    if (shouldHide || foldWords.length > 0 || matchedColors.length > 0) {
                        item.dataset.nsxKwProcessed = "1";
                    }
                });
            };

            const reapplyKeywords = () => {
                const all = $$(".post-list-item");
                all.forEach(item => {
                    delete item.dataset.nsxKwProcessed;
                    item.style.display = "";
                    item.style.backgroundColor = "";
                    item.style.background = "";
                    item.style.transition = "";
                    item.classList.remove("nsx-post-folded");
                    item.querySelectorAll(".nsx-fold-notice").forEach(n => n.remove());
                });
                runFilter(all);
            };

            runFilter($$(".post-list-item"));
            ctx.watch(".post-list-item", els => runFilter(els), { debounce: 150 });

            const panelCss = `.nsx-rel-header{display:flex;align-items:center;justify-content:space-between;padding:12px 12px 6px}.nsx-rel-title{font-size:15px;font-weight:600}.nsx-rel-action{border:0;background:0;color:#666;cursor:pointer;font-size:12px;padding:4px 8px;border-radius:6px}.nsx-rel-action:hover{background:#f2f3f5}.nsx-rel-search{display:flex;align-items:center;margin:0 12px 8px;border:1px solid #e1e1e1;border-radius:8px;padding:6px 10px;color:#888}.nsx-rel-search input{border:0;background:0;outline:0;width:100%;font-size:13px;color:inherit}.nsx-rel-tabs{display:flex;align-items:center;gap:16px;padding:0 12px 6px;border-bottom:1px solid #f0f0f0}.nsx-rel-tab{border:0;background:0;cursor:pointer;color:#6b6b6b;font-size:12px;padding:6px 0;font-weight:600;border-bottom:2px solid transparent;display:inline-flex;align-items:center}.nsx-rel-tab.is-active{color:#0a62ff;border-bottom-color:#0a62ff}.nsx-kw-default-color{margin-left:auto;display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#6b6b6b;cursor:pointer;user-select:none}.nsx-kw-default-color input[type="color"]{width:22px;height:22px;padding:0;border:1px solid #d4d4d8;border-radius:5px;background:transparent;cursor:pointer}.nsx-rel-list{flex:1;overflow-y:auto;padding:6px 8px 12px}.nsx-rel-item{display:flex;align-items:center;gap:8px;padding:8px 6px;border-radius:8px}.nsx-rel-item:hover{background:#f5f7fb}.nsx-rel-link{display:flex;align-items:center;gap:10px;flex:1;min-width:0;text-decoration:none;color:inherit}.nsx-rel-icon{width:36px;height:36px;border-radius:50%;background:#f0f0f0;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;color:#999;font-weight:bold;font-size:18px}.nsx-rel-info{display:flex;flex-direction:column;gap:2px;overflow:hidden;flex:1}.nsx-rel-item-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:bold;font-size:14px}.nsx-rel-remark{color:#888;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.nsx-rel-time{color:#aaa;font-size:11px}.nsx-rel-empty{padding:20px 6px;color:#999;font-size:13px;text-align:center}.nsx-rel-close{border:0;background:0;cursor:pointer;font-size:12px;padding:4px 8px;border-radius:6px;color:#999;display:none}.nsx-rel-item:hover .nsx-rel-close{display:block}.nsx-rel-close:hover{color:#f44336;background:#fee}.nsx-kw-nav-btn{cursor:pointer;white-space:nowrap;font-size:inherit;text-decoration:none}.nsx-kw-nav-btn.is-open{color:#0a62ff!important}.dark-layout .nsx-rel-action{color:#999}.dark-layout .nsx-rel-action:hover{background:#2a2a2a}.dark-layout .nsx-rel-search{border-color:#3a3a3a;color:#9aa4b2}.dark-layout .nsx-rel-search input{color:#e0e0e0}.dark-layout .nsx-rel-tabs{border-bottom-color:#3a3a3a}.dark-layout .nsx-rel-tab,.dark-layout .nsx-kw-default-color{color:#999}.dark-layout .nsx-kw-default-color input[type="color"]{border-color:#52525b}.dark-layout .nsx-rel-item:hover{background:#2a2a2a}.dark-layout .nsx-rel-icon{background:#3a3a3a}`;
            addStyle("nsx-filter-panel-style", panelCss);

            // --- 独立的关键字面板逻辑 ---
            let kwPanel = null, kwTrigger = null, pState = { open: false, kw: "", tab: "block" };
            const head = ctx.$("#nsk-head");
            if (head) {
                const KW_TRIGGER_ID = "nsx-kw-nav";
                const ensureKwTrigger = () => {
                    let trigger = document.getElementById(KW_TRIGGER_ID);
                    if (!trigger) {
                        trigger = document.createElement("a");
                        trigger.id = KW_TRIGGER_ID;
                        trigger.href = "javascript:void(0)";
                        trigger.setAttribute("role", "button");
                        trigger.textContent = "关键字过滤";
                        trigger.title = "关键字过滤管理";
                    }
                    kwTrigger = trigger;

                    const headerLinks = [...document.querySelectorAll("header a")];
                    const anchorLink = document.getElementById("nsx-email-nav")
                        || headerLinks.find(a => { const t = a.textContent.trim(); return t === "DeepFlood" || t === "DF"; });

                    if (anchorLink) {
                        trigger.className = `${anchorLink.className ? anchorLink.className + " " : ""}nsx-kw-nav-btn`;
                        trigger.style.marginLeft = "16px";
                        if (anchorLink.parentElement?.tagName === "LI" && anchorLink.parentElement.parentElement) {
                            let li = document.getElementById("nsx-kw-nav-item");
                            if (!li) {
                                li = document.createElement("li");
                                li.id = "nsx-kw-nav-item";
                                li.className = anchorLink.parentElement.className;
                            }
                            if (trigger.parentElement !== li) li.appendChild(trigger);
                            trigger.style.marginLeft = "";
                            if (li.previousElementSibling !== anchorLink.parentElement) anchorLink.parentElement.after(li);
                        } else if (trigger.previousElementSibling !== anchorLink) {
                            anchorLink.after(trigger);
                        }
                        return trigger;
                    }

                    const navLinks = document.querySelector("header .nav-links, header nav, #nsk-head .header-nav, #nsk-head .nav-menu");
                    if (navLinks) {
                        if (navLinks.tagName === "UL") {
                            const lastLi = [...navLinks.querySelectorAll(":scope > li:not(#nsx-kw-nav-item)")].pop();
                            let li = document.getElementById("nsx-kw-nav-item");
                            if (!li) {
                                li = document.createElement("li");
                                li.id = "nsx-kw-nav-item";
                                if (lastLi?.className) li.className = lastLi.className;
                            }
                            const refA = lastLi?.querySelector("a");
                            trigger.className = `${refA?.className ? refA.className + " " : ""}nsx-kw-nav-btn`;
                            trigger.style.marginLeft = "";
                            if (trigger.parentElement !== li) li.appendChild(trigger);
                            if (li.parentElement !== navLinks) navLinks.appendChild(li);
                        } else {
                            const lastLink = [...navLinks.querySelectorAll("a")].filter(a => a.id !== KW_TRIGGER_ID).pop();
                            trigger.className = `${lastLink?.className ? lastLink.className + " " : ""}nsx-kw-nav-btn`;
                            if (lastLink) {
                                trigger.style.marginLeft = "16px";
                                if (trigger.previousElementSibling !== lastLink) lastLink.after(trigger);
                            } else if (trigger.parentElement !== navLinks) {
                                navLinks.appendChild(trigger);
                            }
                        }
                        return trigger;
                    }

                    const grp = ensureIconGroup();
                    if (!grp) return null;
                    trigger.className = "filter-dropdown-on nsx-kw-nav-btn";
                    trigger.style.marginLeft = "";
                    trigger.style.fontSize = "13px";
                    if (trigger.parentElement !== grp) grp.appendChild(trigger);
                    return trigger;
                };

                if (!ensureKwTrigger()) return;

                const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

                const renderList = () => {
                    const map = getMap();
                    const defColor = getDefaultHighlightColor();
                    let list = Object.entries(map).map(([k, v]) => ({ word: k, ...v }));
                    if (pState.kw) list = list.filter(i => i.word.toLowerCase().includes(pState.kw));
                    list = list.filter(i => (pState.tab === 'highlight' ? i.type === 'highlight' : i.type !== 'highlight'));
                    list.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));

                    kwPanel.querySelectorAll('.nsx-rel-tab').forEach(b => b.classList.toggle('is-active', b.dataset.t === pState.tab));
                    const defInput = kwPanel.querySelector('#nsx-kw-default-color');
                    if (defInput) defInput.value = toHexColor(defColor);
                    const lEl = kwPanel.querySelector(".nsx-rel-list");
                    if (!list.length) { lEl.innerHTML = `<div class="nsx-rel-empty">当前分组没有关键字</div>`; return; }

                    lEl.innerHTML = list.map(i => {
                        let iconColor = i.type === 'highlight' ? (i.color || defColor) : "#9e9e9e";
                        return `<div class="nsx-rel-item">
                            <div class="nsx-rel-link">
                                <span class="nsx-rel-icon" style="color:white;background:${iconColor};opacity:0.8;font-size:14px;${i.type === 'highlight' ? 'border:1px solid rgba(0,0,0,0.1)' : ''}">#</span>
                                <div class="nsx-rel-info">
                                    <span class="nsx-rel-item-title" data-un="${esc(i.word)}">${esc(i.word)}</span>
                                    <span class="nsx-rel-remark" data-un="${esc(i.word)}">${i.type === 'highlight' ? '高亮 (颜色: ' + esc(i.color || defColor) + ')' : (i.mode === 'hide' ? '彻底隐藏' : '折叠展示')}（双击编辑）</span>
                                </div>
                            </div>
                            <span class="nsx-rel-time">${i.time ? i.time.split(' ')[0] : ''}</span>
                            <button class="nsx-rel-close" data-a="del" data-un="${esc(i.word)}">移除</button>
                        </div>`;
                    }).join("");
                };

                const openPanel = () => {
                    if (!kwPanel) {
                        kwPanel = document.createElement("div"); kwPanel.id = "nsx-filter-panel";
                        kwPanel.innerHTML = `
                                <div class="nsx-rel-header"><div class="nsx-rel-title">关键字过滤</div><div style="display:flex;gap:8px;"><button class="nsx-rel-action" data-a="add">新增</button><button class="nsx-rel-action" data-a="clear">清空当前组</button></div></div>
                                <div class="nsx-rel-search"><input placeholder="搜索关键字与配置..."/></div>
                                <div class="nsx-rel-tabs">
                                    <button class="nsx-rel-tab is-active" data-t="block">屏蔽</button>
                                    <button class="nsx-rel-tab" data-t="highlight">高亮</button>
                                    <label class="nsx-kw-default-color" title="设置默认高亮色"><span>默认色</span><input type="color" id="nsx-kw-default-color" value="${esc(toHexColor(getDefaultHighlightColor()))}"></label>
                                </div>
                                <div class="nsx-rel-list"></div>
                            `;
                        document.body.appendChild(kwPanel);

                        kwPanel.querySelector(".nsx-rel-search input").oninput = e => { pState.kw = e.target.value.toLowerCase(); renderList(); };
                        const defColorInp = kwPanel.querySelector("#nsx-kw-default-color");
                        defColorInp.oninput = e => { setDefaultHighlightColor(e.target.value); reapplyKeywords(); renderList(); };
                        defColorInp.onchange = () => { ctx.ui.toast?.("默认高亮色已更新"); };
                        kwPanel.onclick = e => {
                            e.stopPropagation();
                            const t = e.target.closest('[data-t]');
                            if (t) { pState.tab = t.dataset.t; renderList(); return; }
                            const a = e.target.closest("[data-a]"); if (!a) return;
                            const act = a.dataset.a, un = a.dataset.un;

                            if (act === "clear") {
                                ctx.ui.confirm("清空列表?", `确定要删除当前分组（${pState.tab === 'highlight' ? '高亮' : '屏蔽'}）的关键字吗？`, () => {
                                    const map = getMap();
                                    Object.keys(map).forEach(k => {
                                        const it = map[k] || {};
                                        const isHighlight = it.type === 'highlight';
                                        if ((pState.tab === 'highlight' && isHighlight) || (pState.tab === 'block' && !isHighlight)) delete map[k];
                                    });
                                    saveMap(map); reapplyKeywords(); renderList(); ctx.ui.toast("已清空");
                                });
                            }
                            if (act === "del") {
                                const map = getMap(); delete map[un]; saveMap(map); reapplyKeywords(); renderList(); ctx.ui.toast("已移除");
                            }
                            if (act === "add") {
                                const defColor = getDefaultHighlightColor();
                                const html = `
                                        <style>
                                            .nsx-kw-form .layui-form-label{width:76px;padding-left:0}
                                            .nsx-kw-form .layui-input-block{margin-left:96px}
                                            .nsx-mobile .nsx-kw-form .layui-form-label{width:auto;float:none;text-align:left;padding:0 0 4px}
                                            .nsx-mobile .nsx-kw-form .layui-input-block{margin-left:0}
                                        </style>
                                        <div class="layui-form nsx-kw-form" style="padding:20px 20px 0;">
                                            <div class="layui-form-item"><label class="layui-form-label">关键字</label><div class="layui-input-block"><input type="text" id="nkw-v" class="layui-input" placeholder="输入词语（可用 , 分隔，同一组）"></div></div>
                                            <div class="layui-form-item"><label class="layui-form-label">类型</label><div class="layui-input-block"><select id="nkw-t" lay-filter="nkw-t-filter"><option value="block" ${pState.tab === 'block' ? 'selected' : ''}>屏蔽</option><option value="highlight" ${pState.tab === 'highlight' ? 'selected' : ''}>高亮</option></select></div></div>
                                            <div class="layui-form-item" id="nkw-m-box"><label class="layui-form-label">模式</label><div class="layui-input-block"><select id="nkw-m"><option value="fold">优雅折叠</option><option value="hide">彻底隐藏</option></select></div></div>
                                            <div class="layui-form-item" id="nkw-c-box" style="display:none;"><label class="layui-form-label">高亮颜色</label><div class="layui-input-block">
                                                <div id="nkw-color-picker"></div>
                                                <input type="hidden" id="nkw-c-val" value="${esc(defColor)}">
                                            </div></div>
                                        </div>
                                    `;
                                ctx.ui.layer.open({
                                    title: '新增关键字', content: html, area: ['min(520px,94vw)', 'auto'], btn: ['添加', '取消'],
                                    success: (l) => {
                                        layui.use(['form', 'colorpicker'], function () {
                                            const form = layui.form;
                                            form.render('select');

                                            const syncTypeUI = (val) => {
                                                const isH = val === 'highlight';
                                                l.find('#nkw-m-box').toggle(!isH);
                                                l.find('#nkw-c-box').toggle(isH);
                                            };

                                            form.on('select(nkw-t-filter)', function (data) {
                                                syncTypeUI(data.value);
                                            });

                                            syncTypeUI(l.find('#nkw-t').val());

                                            layui.colorpicker.render({
                                                elem: '#nkw-color-picker',
                                                color: defColor,
                                                predefine: true,
                                                alpha: true,
                                                done: function (color) { l.find('#nkw-c-val').val(color || defColor); }
                                            });
                                        });
                                    },
                                    yes: (idx, l) => {
                                        const w = l.find('#nkw-v').val().trim();
                                        if (!w) return;
                                        const map = getMap();
                                        const type = l.find('#nkw-t').val();
                                        map[w] = {
                                            type,
                                            mode: type === 'block' ? l.find('#nkw-m').val() : null,
                                            color: type === 'highlight' ? l.find('#nkw-c-val').val() : null,
                                            time: new Date().toLocaleString()
                                        };
                                        saveMap(map); reapplyKeywords(); ctx.ui.layer.close(idx); renderList(); ctx.ui.toast("已添加");
                                    }
                                });
                            }
                        };
                        kwPanel.ondblclick = (e) => {
                            const target = e.target.closest('.nsx-rel-item-title,.nsx-rel-remark');
                            if (!target) return;
                            e.preventDefault();
                            e.stopPropagation();
                            const un = target.dataset.un;
                            const map = getMap();
                            const info = map[un];
                            if (!info) return;
                            const initColor = info.color || getDefaultHighlightColor();

                            const html = `
                                <style>
                                    .nsx-kw-form .layui-form-label{width:76px;padding-left:0}
                                    .nsx-kw-form .layui-input-block{margin-left:96px}
                                    .nsx-mobile .nsx-kw-form .layui-form-label{width:auto;float:none;text-align:left;padding:0 0 4px}
                                    .nsx-mobile .nsx-kw-form .layui-input-block{margin-left:0}
                                </style>
                                <div class="layui-form nsx-kw-form" style="padding:20px 20px 0;">
                                    <div class="layui-form-item"><label class="layui-form-label">关键字</label><div class="layui-input-block"><input type="text" id="nkw-e-v" class="layui-input" value="${esc(un)}" placeholder="可用 , 分隔，作为同一组"></div></div>
                                    <div class="layui-form-item"><label class="layui-form-label">类型</label><div class="layui-input-block"><select id="nkw-e-t" lay-filter="nkw-e-t-filter"><option value="block" ${info.type === 'highlight' ? '' : 'selected'}>屏蔽</option><option value="highlight" ${info.type === 'highlight' ? 'selected' : ''}>高亮</option></select></div></div>
                                    <div class="layui-form-item" id="nkw-e-m-box" style="${info.type === 'highlight' ? 'display:none;' : ''}"><label class="layui-form-label">模式</label><div class="layui-input-block"><select id="nkw-e-m"><option value="fold" ${info.mode === 'hide' ? '' : 'selected'}>优雅折叠</option><option value="hide" ${info.mode === 'hide' ? 'selected' : ''}>彻底隐藏</option></select></div></div>
                                    <div class="layui-form-item" id="nkw-e-c-box" style="${info.type === 'highlight' ? '' : 'display:none;'}"><label class="layui-form-label">高亮颜色</label><div class="layui-input-block"><div id="nkw-e-color-picker"></div><input type="hidden" id="nkw-e-c-val" value="${esc(initColor)}"></div></div>
                                </div>`;
                            ctx.ui.layer.open({
                                title: '编辑关键字', content: html, area: ['min(520px,94vw)', 'auto'], btn: ['保存', '取消'],
                                success: (l) => {
                                    layui.use(['form', 'colorpicker'], function () {
                                        const form = layui.form;
                                        form.render('select');
                                        form.on('select(nkw-e-t-filter)', function (data) {
                                            const isH = data.value === 'highlight';
                                            l.find('#nkw-e-m-box').toggle(!isH);
                                            l.find('#nkw-e-c-box').toggle(isH);
                                        });
                                        layui.colorpicker.render({ elem: '#nkw-e-color-picker', color: initColor, predefine: true, alpha: true, done: color => l.find('#nkw-e-c-val').val(color || initColor) });
                                    });
                                },
                                yes: (idx, l) => {
                                    const nw = l.find('#nkw-e-v').val().trim();
                                    if (!nw) return;
                                    const type = l.find('#nkw-e-t').val();
                                    delete map[un];
                                    map[nw] = { type, mode: type === 'block' ? l.find('#nkw-e-m').val() : null, color: type === 'highlight' ? l.find('#nkw-e-c-val').val() : null, time: new Date().toLocaleString() };
                                    saveMap(map); reapplyKeywords(); ctx.ui.layer.close(idx); renderList(); ctx.ui.toast('已更新');
                                }
                            });
                        };
                        document.addEventListener("click", e => {
                            const inLayer = !!e.target.closest('.layui-layer,.layui-layer-page,.layui-layer-dialog,.layui-colorpicker');
                            if (inLayer) return;
                            const hasTopLayer = !!document.querySelector('.layui-layer[style*="z-index"]');
                            if (hasTopLayer) return;
                            if (pState.open && !kwPanel.contains(e.target) && !kwTrigger.contains(e.target)) closePanel();
                        });
                        document.addEventListener("keydown", e => { if (pState.open && e.key === "Escape") closePanel(); });
                    }
                    const r = kwTrigger.getBoundingClientRect();
                    const top = Math.max(12, r.bottom + 8);
                    const panelW = Math.min(380, innerWidth * 0.94);
                    const left = Math.max(12, Math.min(r.left, innerWidth - panelW - 12));
                    kwPanel.style.top = `${top}px`;
                    kwPanel.style.left = `${left}px`;
                    kwPanel.style.right = `auto`;
                    kwPanel.style.height = `${Math.max(260, innerHeight - top - 16)}px`;
                    renderList(); kwPanel.classList.add("show"); pState.open = true;
                    kwTrigger.classList.add("is-open");
                };
                const closePanel = () => {
                    kwPanel?.classList.remove("show");
                    kwTrigger?.classList.remove("is-open");
                    pState.open = false;
                };
                const bindTrigger = () => {
                    const tr = ensureKwTrigger();
                    if (!tr) return;
                    tr.onclick = e => {
                        e.preventDefault();
                        e.stopPropagation();
                        pState.open ? closePanel() : openPanel();
                    };
                };
                bindTrigger();
                const header = document.querySelector("header");
                if (header) new MutationObserver(debounce(bindTrigger, 120)).observe(header, { childList: true, subtree: true });
            }
        }
    };

    /* ==========================================================================
       [ 辅助工具 ] - 快捷键回复 (Ctrl+Enter)
       ========================================================================== */
    const commentShortcut = {
        id: "commentShortcut",
        order: 135,
        match: ctx => ctx.isPost,
        init(ctx) {
            const getBtn = () => $(".md-editor button.submit.btn.focus-visible");
            $$(".CodeMirror").forEach(cmEl => {
                const cm = cmEl?.CodeMirror;
                if (!cm || cm.__nsx) return;
                cm.__nsx = true;
                const bind = () => {
                    const btn = getBtn();
                    if (btn && !/Ctrl\+Enter/i.test(btn.textContent)) btn.textContent += "(Ctrl+Enter)";
                    if (btn && !cm.__nsxMap) {
                        cm.__nsxMap = { "Ctrl-Enter": () => getBtn()?.click() };
                        cm.addKeyMap(cm.__nsxMap);
                    } else if (!btn && cm.__nsxMap) {
                        cm.removeKeyMap(cm.__nsxMap);
                        cm.__nsxMap = null;
                    }
                };
                bind();
                cmEl.addEventListener("focusin", bind, true);
                cmEl.addEventListener("focusout", bind, true);
            });
        }
    };

    /* ==========================================================================
       [ 辅助工具 ] - 网页预加载 (Instant Page)
       ========================================================================== */
    const instantPage = {
        id: "instantPage",
        order: 320,
        match: () => true,
        init(ctx) {
            const done = new Set();
            const inflight = new Set();
            document.body.addEventListener("mouseover", e => {
                const a = e.target.closest("a");
                if (!a?.href?.startsWith(`${location.origin}/post-`) || done.has(a.href) || inflight.has(a.href)) return;
                setTimeout(() => {
                    if (!a.matches(":hover") || done.has(a.href) || inflight.has(a.href)) return;
                    const link = document.createElement("link");
                    link.rel = "prefetch";
                    link.href = a.href;
                    inflight.add(a.href);
                    const clear = () => {
                        done.add(a.href);
                        inflight.delete(a.href);
                        link.remove();
                    };
                    link.addEventListener("load", clear, { once: true });
                    link.addEventListener("error", clear, { once: true });
                    document.head.appendChild(link);
                    setTimeout(clear, 5000);
                }, 65);
            }, { passive: true });
        }
    };


    /* ==========================================================================
       [ 辅助工具 ] - 快捷评论 (快捷回复区)
       ========================================================================== */

    const quickComment = {
        id: "quickComment",
        order: 120,
        match: ctx => ctx.loggedIn && ctx.isPost,
        init(ctx) {
            const editor = $(".md-editor"), parent = $("#back-to-parent"), group = $("#fast-nav-button-group");
            if (!editor || !parent || !group) return;
            let open = false;
            addStyle("nsx-quick-reply", `
.mde-toolbar > .sep{width:2px !important;height:20px !important;background:#e5e7eb !important;margin:0 6px !important;flex-shrink:0 !important;display:inline-block !important}
.nsx-quick-reply-wrap{position:relative;display:inline-flex;align-items:center}
.nsx-quick-reply-btn{height:auto;line-height:1;border:none;background:transparent;color:var(--text-color,#333);padding:0;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:4px}
.nsx-quick-reply-btn:hover{color:#1677ff}
.nsx-quick-reply-menu{position:absolute;left:0;top:36px;z-index:1002;min-width:280px;max-width:min(500px,88vw);background:var(--bg-color,#fff);border:1px solid var(--border-color,#e5e7eb);border-radius:10px;box-shadow:0 8px 22px rgba(0,0,0,.12);padding:8px;display:none}
.nsx-quick-reply-menu.show{display:block}
.nsx-quick-reply-tabs-wrap{display:flex;align-items:flex-start;gap:6px;padding-bottom:11px;margin-bottom:6px;border-bottom:1px solid #eee}
.nsx-quick-reply-tabs{flex:1;display:flex;gap:6px;overflow:auto hidden;scrollbar-width:thin;overflow-y:hidden}
.nsx-quick-reply-tab{flex:0 0 calc((100% - 12px)/3);max-width:calc((100% - 12px)/3);border:1px solid #e4e6eb;background:#fff;border-radius:999px;padding:3px 8px;cursor:pointer;font-size:12px;white-space:nowrap;overflow:hidden;text-align:center;display:flex;align-items:center;justify-content:center;gap:6px}
.nsx-quick-reply-tab .nsx-quick-reply-tab-text{min-width:0;overflow:hidden;text-overflow:ellipsis}
.nsx-quick-reply-tab .nsx-quick-reply-tab-del{flex:0 0 auto;border:0;background:transparent;color:#999;cursor:pointer;line-height:1;padding:0 2px;font-size:12px}
.nsx-quick-reply-tab .nsx-quick-reply-tab-del:hover{color:#ff4d4f}
.nsx-quick-reply-tab.active{background:#1677ff;color:#fff;border-color:#1677ff}
.nsx-quick-reply-tab.active .nsx-quick-reply-tab-del{color:rgba(255,255,255,.85)}
.nsx-quick-reply-tab.active .nsx-quick-reply-tab-del:hover{color:#fff}
.nsx-quick-reply-tab-add-fixed{flex:0 0 auto;border:1px dashed #1677ff;background:#fff;color:#1677ff;border-radius:999px;padding:3px 10px;cursor:pointer;font-size:12px;white-space:nowrap}
.nsx-quick-reply-list{height:216px;overflow-y:auto;overflow-x:hidden;padding-right:2px}
.nsx-quick-reply-item{display:flex;align-items:center;width:100%;text-align:left;border:0;background:transparent;color:inherit;cursor:pointer;border-radius:8px;padding:0 6px 0 10px;height:36px;box-sizing:border-box}
.nsx-quick-reply-item .nsx-quick-reply-item-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
.nsx-quick-reply-item .nsx-quick-reply-item-del{flex:0 0 auto;border:0;background:transparent;color:#999;cursor:pointer;line-height:1;padding:4px 6px;font-size:12px;border-radius:6px}
.nsx-quick-reply-item .nsx-quick-reply-item-del:hover{color:#ff4d4f;background:rgba(255,77,79,.12)}
.nsx-quick-reply-item:hover{background:var(--hover-color,#f3f4f6)}
.nsx-quick-reply-empty{padding:10px;color:#999;font-size:12px}
.nsx-quick-reply-foot{display:flex;justify-content:space-between;align-items:center;padding-top:6px;margin-top:6px;border-top:1px solid #eee}
.nsx-quick-reply-autosend-wrap{display:flex;align-items:center;gap:4px;font-size:12px;color:#666}
.nsx-quick-reply-autosend-check{width:14px;height:14px;cursor:pointer;accent-color:#1677ff}
.nsx-quick-reply-autosend-label{cursor:pointer;user-select:none}
.nsx-quick-reply-op{border:1px solid #e4e6eb;background:#fff;border-radius:6px;padding:2px 8px;cursor:pointer;font-size:12px}
.nsx-quick-reply-op:disabled{opacity:.45;cursor:not-allowed}
.nsx-quick-reply-add{border:1px solid #1677ff;background:#1677ff;color:#fff;border-radius:6px;padding:2px 8px;cursor:pointer;font-size:12px}
.dark-layout .mde-toolbar > .sep{background:#666 !important}
.dark-layout .nsx-quick-reply-btn:hover{color:#64b5f6}
.dark-layout .nsx-quick-reply-menu{background:#222;border-color:#3a3a3a;box-shadow:0 8px 22px rgba(0,0,0,.35)}
.dark-layout .nsx-quick-reply-tabs-wrap{border-bottom-color:#3a3a3a}
.dark-layout .nsx-quick-reply-tabs{border-bottom-color:#3a3a3a}
.dark-layout .nsx-quick-reply-tab{background:#2a2a2a;border-color:#444;color:#ddd}
.dark-layout .nsx-quick-reply-tab.active{background:#1677ff;border-color:#1677ff;color:#fff}
.dark-layout .nsx-quick-reply-tab-add-fixed{background:#2a2a2a;border-color:#1677ff;color:#8dbdff}
.dark-layout .nsx-quick-reply-item .nsx-quick-reply-item-del:hover{background:rgba(255,77,79,.18)}
.dark-layout .nsx-quick-reply-item:hover{background:#333}
.dark-layout .nsx-quick-reply-foot{border-top-color:#3a3a3a}
.dark-layout .nsx-quick-reply-autosend-wrap{color:#aaa}
.dark-layout .nsx-quick-reply-op{background:#2a2a2a;border-color:#444;color:#ddd}
`);

            const show = e => {
                if (open) return;
                e?.preventDefault?.();
                editor.style.cssText = `position:fixed;bottom:0;margin:0;width:100%;max-width:${editor.clientWidth || 720}px;z-index:999`;
                addClose();
                open = true;
            };

            const btn = parent.cloneNode(true);
            btn.id = "back-to-comment";
            btn.innerHTML = `<svg class="iconpark-icon" style="width:24px;height:24px"><use href="#comments"></use></svg>`;
            btn.onclick = show;
            parent.before(btn);

            $$(".nsk-post .comment-menu,.comment-container .comments").forEach(el => el.addEventListener("click", e => {
                if (["引用", "回复", "编辑"].includes(e.target?.textContent)) show(e);
            }, true));

            mountQuickReplyMenu();

            function addClose() {
                const tb = $("#editor-body .window_header > :last-child");
                if (!tb || $(".nsx-close-editor")) return;
                const cb = tb.cloneNode(true);
                cb.classList.add("nsx-close-editor");
                cb.title = "关闭";
                const sp = cb.querySelector("span");
                if (sp) {
                    sp.classList.replace("i-icon-full-screen-one", "i-icon-close");
                    sp.innerHTML = `<svg width="16" height="16" viewBox="0 0 48 48" fill="none"><path d="M8 8L40 40M8 40L40 8" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
                }
                cb.onclick = () => { editor.style.cssText = ""; cb.remove(); open = false; };
                tb.after(cb);
            }

            function mountQuickReplyMenu() {
                const bar = editor.querySelector(".mde-toolbar");
                if (!bar || bar.querySelector(".nsx-quick-reply-wrap")) return;
                const state = { groupIdx: 0 };

                const sep = document.createElement("div");
                const wrap = document.createElement("div");
                wrap.className = "nsx-quick-reply-wrap toolbar-item";
                const btn = document.createElement("span");
                btn.className = "nsx-quick-reply-btn i-icon";
                btn.title = "快捷回复 - NodeSeek Plus";
                btn.textContent = "快捷回复";
                const menu = document.createElement("div");
                menu.className = "nsx-quick-reply-menu";

                // 让菜单始终可见：窗口缩放/滚动时自动贴边，避免跑出视窗外
                const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
                const placeMenu = () => {
                    if (!menu.classList.contains("show")) return;

                    // 覆盖 CSS 里的 absolute，避免父容器溢出/裁剪导致看不到
                    menu.style.position = "fixed";
                    menu.style.margin = "0";

                    const pad = 8;
                    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
                    const vh = window.innerHeight || document.documentElement.clientHeight || 0;

                    const bRect = btn.getBoundingClientRect();
                    const mRect = menu.getBoundingClientRect();
                    const w = mRect.width || Math.min(500, Math.max(280, vw * 0.88));
                    const h = mRect.height || 320;

                    let left = clamp(bRect.left, pad, Math.max(pad, vw - w - pad));
                    let top = bRect.bottom + 6;

                    // 优先显示在按钮下方；放不下就翻到上方
                    if (top + h + pad > vh && bRect.top - 6 - h - pad >= 0) {
                        top = bRect.top - 6 - h;
                    }
                    top = clamp(top, pad, Math.max(pad, vh - h - pad));

                    menu.style.left = `${left}px`;
                    menu.style.top = `${top}px`;
                };

                // 支持拖拽移动：按住标签栏区域拖动菜单
                let dragOn = false, dragStartX = 0, dragStartY = 0, dragLeft = 0, dragTop = 0;
                const onDragMove = (e) => {
                    if (!dragOn) return;
                    const pad = 8;
                    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
                    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
                    const r = menu.getBoundingClientRect();
                    const nextLeft = clamp(dragLeft + (e.clientX - dragStartX), pad, Math.max(pad, vw - r.width - pad));
                    const nextTop = clamp(dragTop + (e.clientY - dragStartY), pad, Math.max(pad, vh - r.height - pad));
                    menu.style.left = `${nextLeft}px`;
                    menu.style.top = `${nextTop}px`;
                };
                const onDragEnd = () => { dragOn = false; };

                const tabsWrap = document.createElement("div");
                tabsWrap.className = "nsx-quick-reply-tabs-wrap";
                const tabs = document.createElement("div");
                tabs.className = "nsx-quick-reply-tabs";
                const addGroupTab = document.createElement("button");
                addGroupTab.type = "button";
                addGroupTab.className = "nsx-quick-reply-tab-add-fixed";
                addGroupTab.textContent = "+ 分组";
                addGroupTab.onclick = e => {
                    e.preventDefault();
                    e.stopPropagation();
                    openAddGroupDialog(() => {
                        state.groupIdx = Math.max(0, getQuickReplyGroups().length - 1);
                        state.page = 1;
                        renderMenu();
                    });
                };
                const list = document.createElement("div");
                list.className = "nsx-quick-reply-list";
                const foot = document.createElement("div");
                foot.className = "nsx-quick-reply-foot";
                tabsWrap.append(tabs, addGroupTab);
                menu.append(tabsWrap, list, foot);

                tabsWrap.style.cursor = "move";
                tabsWrap.addEventListener("pointerdown", (e) => {
                    if (!menu.classList.contains("show")) return;
                    if (e.button !== 0) return;
                    if (e.target?.closest?.("button,input,select,textarea,a,.nsx-quick-reply-tab,.nsx-quick-reply-tab-add-fixed")) return;
                    e.preventDefault();
                    e.stopPropagation();

                    placeMenu();
                    const r = menu.getBoundingClientRect();
                    dragOn = true;
                    dragStartX = e.clientX;
                    dragStartY = e.clientY;
                    dragLeft = r.left;
                    dragTop = r.top;
                    try { tabsWrap.setPointerCapture(e.pointerId); } catch { }
                }, { passive: false });
                tabsWrap.addEventListener("pointermove", onDragMove);
                tabsWrap.addEventListener("pointerup", onDragEnd);
                tabsWrap.addEventListener("pointercancel", onDragEnd);

                const renderMenu = () => {
                    const groups = getQuickReplyGroups();
                    tabs.innerHTML = "";
                    list.innerHTML = "";
                    foot.innerHTML = "";
                    if (!groups.length) {
                        const empty = document.createElement("div");
                        empty.className = "nsx-quick-reply-empty";
                        empty.textContent = "未找到快捷回复，请先在快捷回复面板中配置。";
                        list.appendChild(empty);
                        const addBtn = document.createElement("button");
                        addBtn.type = "button";
                        addBtn.className = "nsx-quick-reply-add";
                        addBtn.textContent = "新增";
                        addBtn.onclick = () => openAddDialog("", () => {
                            state.groupIdx = 0;
                            renderMenu();
                        });
                        foot.appendChild(addBtn);
                        return;
                    }

                    state.groupIdx = Math.max(0, Math.min(state.groupIdx, groups.length - 1));
                    groups.forEach((g, i) => {
                        // 不要在 button 里嵌套 button（浏览器行为不一致，可能导致误触发关闭）
                        const t = document.createElement("div");
                        t.className = `nsx-quick-reply-tab${i === state.groupIdx ? " active" : ""}`;
                        t.setAttribute("role", "button");
                        t.tabIndex = 0;

                        const label = g.name || `分组${i + 1}`;
                        const text = document.createElement("span");
                        text.className = "nsx-quick-reply-tab-text";
                        text.textContent = label;

                        const del = document.createElement("span");
                        del.className = "nsx-quick-reply-tab-del";
                        del.title = "删除分组";
                        del.innerHTML = svgIcon("nsx-close", 11);
                        del.setAttribute("role", "button");
                        del.tabIndex = 0;
                        del.onclick = (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const groupName = g.name || "";
                            if (!groupName) return;
                            const doDel = () => {
                                let parsed = {};
                                try { parsed = JSON.parse(localStorage.getItem("nodeseek_quick_reply") || "{}") || {}; } catch { parsed = {}; }
                                delete parsed[groupName];
                                localStorage.setItem("nodeseek_quick_reply", JSON.stringify(parsed));
                                state.groupIdx = Math.max(0, Math.min(state.groupIdx, Object.keys(parsed).length - 1));
                                renderMenu();
                            };
                            if (ctx.ui?.confirm) ctx.ui.confirm("确认删除?", `确定要删除分组【${groupName}】吗？（该分组下的快捷回复会一起删除）`, doDel);
                            else if (window.confirm(`确定要删除分组【${groupName}】吗？（该分组下的快捷回复会一起删除）`)) doDel();
                        };

                        const pick = (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            state.groupIdx = i;
                            renderMenu();
                        };
                        t.onclick = pick;
                        t.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") pick(e); };

                        t.append(text, del);
                        tabs.appendChild(t);
                    });
                    const curGroup = groups[state.groupIdx];
                    const curItems = curGroup.items || [];
                    if (!curItems.length) {
                        const empty = document.createElement("div");
                        empty.className = "nsx-quick-reply-empty";
                        empty.textContent = "当前分组暂无内容，点击右下角“新增”添加。";
                        list.appendChild(empty);
                    }

                    const curGroupName = curGroup?.name || "";
                    curItems.forEach((item, idx) => {
                        // 同理：避免在 button 里嵌套 button
                        const it = document.createElement("div");
                        it.className = "nsx-quick-reply-item";
                        it.setAttribute("role", "button");
                        it.tabIndex = 0;
                        it.title = item.text;

                        const text = document.createElement("span");
                        text.className = "nsx-quick-reply-item-text";
                        text.textContent = item.label;

                        const del = document.createElement("span");
                        del.className = "nsx-quick-reply-item-del";
                        del.title = "删除";
                        del.innerHTML = svgIcon("nsx-close", 12);
                        del.setAttribute("role", "button");
                        del.tabIndex = 0;
                        del.onclick = (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (!curGroupName) return;
                            const doDel = () => {
                                let parsed = {};
                                try { parsed = JSON.parse(localStorage.getItem("nodeseek_quick_reply") || "{}") || {}; } catch { parsed = {}; }
                                const raw = parsed[curGroupName];
                                const arr = normalizeItems(raw).map(x => ({ title: x.label, content: x.text }));
                                arr.splice(idx, 1);
                                parsed[curGroupName] = arr;
                                localStorage.setItem("nodeseek_quick_reply", JSON.stringify(parsed));
                                renderMenu();
                            };
                            if (ctx.ui?.confirm) ctx.ui.confirm("确认删除?", `确定要删除这条快捷回复吗？`, doDel);
                            else if (window.confirm("确定要删除这条快捷回复吗？")) doDel();
                        };

                        it.append(text, del);
                        const doInsert = (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            insertReplyText(item.text);
                            menu.classList.remove("show");
                            // 检查是否自动点击提交按钮
                            const autoSendCheck = document.getElementById("nsx-quick-reply-autosend");
                            if (autoSendCheck && autoSendCheck.checked) {
                                setTimeout(() => {
                                    const submitBtn = editor.querySelector(".md-editor button.submit.btn");
                                    if (submitBtn) submitBtn.click();
                                }, 100);
                            }
                        };
                        it.onclick = doInsert;
                        it.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") doInsert(e); };
                        list.appendChild(it);
                    });

                    // 自动发送勾选框
                    const autoSendWrap = document.createElement("div");
                    autoSendWrap.className = "nsx-quick-reply-autosend-wrap";
                    const autoSendCheck = document.createElement("input");
                    autoSendCheck.type = "checkbox";
                    autoSendCheck.id = "nsx-quick-reply-autosend";
                    autoSendCheck.className = "nsx-quick-reply-autosend-check";
                    // 从localStorage读取上次设置（兼容NS综合.js的key）
                    const savedAutoSend = localStorage.getItem("nodeseek_quick_reply_auto_submit") === "true";
                    autoSendCheck.checked = savedAutoSend;
                    const autoSendLabel = document.createElement("label");
                    autoSendLabel.htmlFor = "nsx-quick-reply-autosend";
                    autoSendLabel.className = "nsx-quick-reply-autosend-label";
                    autoSendLabel.textContent = "自动提交";
                    // 保存设置到localStorage（使用NS综合.js的key保持兼容）
                    autoSendCheck.onchange = () => {
                        localStorage.setItem("nodeseek_quick_reply_auto_submit", autoSendCheck.checked);
                    };
                    autoSendWrap.append(autoSendCheck, autoSendLabel);

                    const addBtn = document.createElement("button");
                    addBtn.type = "button";
                    addBtn.className = "nsx-quick-reply-add";
                    addBtn.textContent = "新增";
                    addBtn.onclick = () => openAddDialog(curGroup.name || "", () => renderMenu());
                    foot.append(autoSendWrap, addBtn);
                };

                btn.onclick = e => {
                    e.preventDefault();
                    e.stopPropagation();
                    renderMenu();
                    menu.classList.toggle("show");
                    if (menu.classList.contains("show")) requestAnimationFrame(placeMenu);
                };

                document.addEventListener("click", e => {
                    // 当 layui 弹窗打开时（例如“新建分组”的确认/取消），不要自动关闭快捷回复面板
                    // 处理两类情况：1) 点击发生在 layer 内部；2) layer 存在时点击落在外部但仍希望保持面板不被误关
                    if (e.target?.closest?.(".layui-layer,.layui-layer-page,.layui-layer-dialog,.layui-layer-content,.layui-layer-btn,.layui-layer-shade,.layui-colorpicker,.layui-form-select")) return;
                    if (menu.classList.contains("show") && document.querySelector(".layui-layer")) return;
                    if (!wrap.contains(e.target)) menu.classList.remove("show");
                });

                // 窗口变化时重新定位，避免面板被挤出屏幕
                addEventListener("resize", placeMenu, { passive: true });
                addEventListener("scroll", placeMenu, { passive: true });

                sep.className = "sep";
                wrap.append(btn, menu);
                const lastEl = bar.lastElementChild;
                if (lastEl?.classList?.contains("sep")) {
                    bar.append(wrap);
                } else {
                    bar.append(sep, wrap);
                }
            }

            function insertReplyText(text) {
                if (!text) return;
                const cm = editor.querySelector(".CodeMirror")?.CodeMirror;
                if (cm) {
                    const doc = cm.getDoc();
                    const cur = doc.getCursor();
                    doc.replaceRange(text, cur);
                    cm.focus();
                    return;
                }
                const ta = editor.querySelector("textarea");
                if (!ta) return;
                const start = ta.selectionStart ?? ta.value.length;
                const end = ta.selectionEnd ?? ta.value.length;
                ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
                const pos = start + text.length;
                ta.setSelectionRange(pos, pos);
                ta.dispatchEvent(new Event("input", { bubbles: true }));
                ta.focus();
            }

            function getQuickReplyGroups() {
                const raw = localStorage.getItem("nodeseek_quick_reply");
                if (!raw) return [];
                let parsed;
                try { parsed = JSON.parse(raw); } catch { return []; }
                if (!parsed || typeof parsed !== "object") return [];
                const groups = [];
                Object.entries(parsed).forEach(([name, val]) => {
                    const items = normalizeItems(val);
                    groups.push({ name, items });
                });
                return groups;
            }

            function openAddGroupDialog(onDone) {
                const layer = ctx.ui?.layer;
                if (!layer) {
                    const val = window.prompt("请输入分组名：", "默认");
                    const groupName = String(val ?? "").trim();
                    if (!groupName) return;
                    ensureQuickReplyGroup(groupName);
                    ctx.ui?.success?.("分组已创建");
                    onDone?.();
                    return;
                }
                layer.prompt({ title: "新建分组", formType: 0, value: "默认" }, (val, idx) => {
                    const groupName = String(val ?? "").trim();
                    if (!groupName) return ctx.ui?.warning?.("分组名不能为空");
                    ensureQuickReplyGroup(groupName);
                    layer.close(idx);
                    ctx.ui?.success?.("分组已创建");
                    onDone?.();
                });
            }

            function openAddDialog(defaultGroupName, onDone) {
                const layer = ctx.ui?.layer;
                let groups = getQuickReplyGroups().map(g => g.name).filter(Boolean);
                if (!layer || !window.layui) {
                    const ask = (label, def = "") => {
                        const v = window.prompt(label, def);
                        return v == null ? null : String(v).trim();
                    };
                    const group = ask("请输入分组名：", defaultGroupName || groups[0] || "默认");
                    if (group == null) return;
                    if (!group) { ctx.ui?.warning?.("分组名不能为空"); return; }
                    const content = ask("请输入快捷回复内容：", "");
                    if (content == null) return;
                    if (!content.trim()) { ctx.ui?.warning?.("内容不能为空"); return; }
                    const title = ask("请输入标题（可留空自动截断内容）：", "") || shrink(content);
                    saveQuickReplyItem(group, { title, content: content.trim() });
                    ctx.ui?.success?.("快捷回复已添加");
                    onDone?.();
                    return;
                }

                // 没有任何分组时，先创建一个默认分组，避免下拉为空无法选择
                if (!groups.length) {
                    ensureQuickReplyGroup("默认");
                    groups = getQuickReplyGroups().map(g => g.name).filter(Boolean);
                }

                const escHtml = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
                const defaultGroup = defaultGroupName || groups[0] || "默认";
                const optsHtml = groups.map(g => `<option value="${escHtml(g)}"${g === defaultGroup ? " selected" : ""}>${escHtml(g)}</option>`).join("");
                const html = `
                    <style>
                        .nsx-qr-form .layui-form-label{width:70px}
                        .nsx-qr-form .layui-input-block{margin-left:100px}
                        .nsx-qr-tip{font-size:12px;color:#999;margin-top:4px}
                    </style>
                    <div class="layui-form nsx-qr-form" style="padding:16px 16px 0;">
                        <div class="layui-form-item">
                            <label class="layui-form-label">分组</label>
                            <div class="layui-input-block">
                                <select id="nsx-qr-group">
                                    ${optsHtml}
                                </select>
                                <div class="nsx-qr-tip">需要新分组请点工具栏右侧的“+ 分组”。</div>
                            </div>
                        </div>
                        <div class="layui-form-item">
                            <label class="layui-form-label">内容</label>
                            <div class="layui-input-block">
                                <textarea id="nsx-qr-content" class="layui-textarea" style="min-height:130px" placeholder="输入快捷回复正文"></textarea>
                                <div class="nsx-qr-tip">支持多行文本，插入时会保持换行。标题将自动使用内容前 28 字。</div>
                            </div>
                        </div>
                    </div>
                `;
                layer.open({
                    type: 1,
                    title: "新增快捷回复",
                    area: [window.layui.device().mobile ? "95%" : "560px", "420px"],
                    btn: ["保存", "取消"],
                    content: html,
                    success: ly => {
                        const r = ly?.[0] || ly;
                        if (window.layui?.form) {
                            layui.use("form", () => {
                                const form = layui.form;
                                form.render("select");
                            });
                        }
                        const c = r?.querySelector?.("#nsx-qr-content");
                        c?.focus?.();
                    },
                    yes: idx => {
                        const r = document.getElementById("layui-layer" + idx) || document;
                        const group = r.querySelector("#nsx-qr-group")?.value?.trim() || "";
                        const content = r.querySelector("#nsx-qr-content")?.value || "";
                        if (!group) return ctx.ui?.warning?.("分组名不能为空");
                        if (!content.trim()) return ctx.ui?.warning?.("内容不能为空");
                        const title = shrink(content);
                        saveQuickReplyItem(group, { title, content: content.trim() });
                        layer.close(idx);
                        ctx.ui?.success?.("快捷回复已添加");
                        onDone?.();
                    }
                });
            }

            function ensureQuickReplyGroup(groupName) {
                let parsed = {};
                try { parsed = JSON.parse(localStorage.getItem("nodeseek_quick_reply") || "{}") || {}; } catch { parsed = {}; }
                if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) parsed = {};
                if (!Object.prototype.hasOwnProperty.call(parsed, groupName)) parsed[groupName] = [];
                localStorage.setItem("nodeseek_quick_reply", JSON.stringify(parsed));
            }

            function saveQuickReplyItem(groupName, item) {
                let parsed = {};
                try { parsed = JSON.parse(localStorage.getItem("nodeseek_quick_reply") || "{}") || {}; } catch { parsed = {}; }
                if (!parsed[groupName]) parsed[groupName] = [];
                if (Array.isArray(parsed[groupName])) {
                    parsed[groupName].push(item);
                } else if (parsed[groupName] && typeof parsed[groupName] === "object") {
                    const arr = normalizeItems(parsed[groupName]).map(i => ({ title: i.label, content: i.text }));
                    arr.push(item);
                    parsed[groupName] = arr;
                } else {
                    parsed[groupName] = [item];
                }
                localStorage.setItem("nodeseek_quick_reply", JSON.stringify(parsed));
            }

            function normalizeItems(src) {
                const arr = Array.isArray(src) ? src : (src && typeof src === "object" ? Object.values(src) : []);
                return arr.map(v => {
                    if (typeof v === "string") return { label: shrink(v), text: v };
                    if (!v || typeof v !== "object") return null;
                    const text = String(v.content ?? v.text ?? v.value ?? "").trim();
                    if (!text) return null;
                    const label = String(v.title ?? v.name ?? v.label ?? shrink(text));
                    return { label, text };
                }).filter(Boolean);
            }

            function shrink(s) {
                const t = String(s).replace(/\s+/g, " ").trim();
                return t.length > 28 ? `${t.slice(0, 28)}...` : t;
            }
        }
    };


    /* ==========================================================================
       [ 辅助工具 ] - 网页平滑滚动
       ========================================================================== */
    const smoothScroll = {
        id: "smoothScroll",
        order: 340,
        match: () => true,
        init() {
            addStyle("nsx-smooth", "html{scroll-behavior:smooth}");
        }
    };

    /* ==========================================================================
       [ 辅助工具 ] - 侧边卡片通知增强
       ========================================================================== */

    class Broadcast {
        static ins = new Map();
        constructor(name) {
            if (Broadcast.ins.has(name)) return Broadcast.ins.get(name);
            this.myId = `${Date.now()}-${Math.random()}`;
            this.recv = [];
            this.KEY = `nsx_tab_${name}`;
            try { this.ch = new BroadcastChannel(name); this.ch.onmessage = e => this.recv.forEach(f => f(e.data)); } catch { this.ch = null; }
            addEventListener("storage", e => { if (e.key === this.KEY) { e.newValue || localStorage.setItem(this.KEY, this.myId); this._up(); } });
            addEventListener("beforeunload", () => { if (this.active) localStorage.removeItem(this.KEY); });
            localStorage.setItem(this.KEY, this.myId);
            this._up();
            Broadcast.ins.set(name, this);
        }
        _up() { this.active = localStorage.getItem(this.KEY) === this.myId; }
        on(fn) { this.recv.push(fn); }
        send(data) { if (!this.ch) return; const m = { sender: this.myId, data }; this.ch.postMessage(m); this.recv.forEach(f => f(m)); }
        task(fn, ms) {
            let timer = null;
            let backoff = 1;
            const run = async () => {
                if (!this.active || document.hidden) {
                    timer = setTimeout(run, ms);
                    return;
                }
                try {
                    const d = await fn();
                    if (d !== undefined) this.send(d);
                    backoff = 1;
                } catch {
                    backoff = Math.min(backoff * 2, 6);
                }
                timer = setTimeout(run, ms * backoff);
            };
            run();
            return () => timer && clearTimeout(timer);
        }
    }

    const userCardExt = {
        id: "userCardExt",
        order: 200,
        match: ctx => ctx.loggedIn && (ctx.isPost || ctx.isList),
        async init(ctx) {
            const bn = new Broadcast("nsx_notify");
            const card = $(".user-card .user-stat");
            const last = card?.querySelector(".stat-block:first-child > :last-child");
            if (!card || !last) return;

            const atEl = last.cloneNode(true), msgEl = last.cloneNode(true);
            last.after(atEl);
            card.querySelector(".stat-block:last-child")?.append(msgEl);

            const up = (el, href, icon, text, cnt) => {
                const a = el.querySelector("a");
                if (!a) return;
                a.href = href;
                el.querySelector("a svg use")?.setAttribute("href", icon);
                const t = el.querySelector("a > :nth-child(2)");
                if (t) t.textContent = `${text} `;
                const c = el.querySelector("a > :last-child");
                if (c) { c.textContent = cnt; c.classList.toggle("notify-count", cnt > 0); }
            };
            const upAll = c => { up(atEl, "/notification#/atMe", "#at-sign", "我", c.atMe); up(msgEl, "/notification#/message?mode=list", "#envelope-one", "私信", c.message); up(last, "/notification#/reply", "#remind-6nce9p47", "回复", c.reply); };

            bn.on(({ data }) => { if (data?.type === "unreadCount" && data.counts) upAll(data.counts); });
            bn.send({ type: "unreadCount", counts: ctx.user?.unViewedCount || {}, timestamp: Date.now() });
            bn.task(async () => {
                const r = await fetch("/api/notification/unread-count", { credentials: "include" });
                if (!r.ok) throw 0;
                const d = await r.json();
                if (d?.success && d.unreadCount) return { type: "unreadCount", counts: d.unreadCount, timestamp: Date.now() };
                throw 0;
            }, 5000);
        }
    };

    /* ==========================================================================
       [ 辅助工具 ] - 邮箱导航入口
       ========================================================================== */
    const EMAIL_LINK_URL = "https://seek.li/";

    const emailNavLink = {
        id: "emailNavLink",
        order: 205,
        match: () => true,
        init(ctx) {
            const TEXT_LINK_ID = "nsx-email-nav";
            const ICON_LINK_ID = "nsx-email-icon-link";

            const isMobile = document.documentElement.classList.contains("nsx-mobile");

            const ensureEntry = () => {
                const headerLinks = [...document.querySelectorAll("header a")];
                const deepFloodLink = headerLinks.find(a => {
                    const t = a.textContent.trim();
                    return t === "DeepFlood" || t === "DF";
                });
                const textLink = document.getElementById(TEXT_LINK_ID);
                const iconLink = document.getElementById(ICON_LINK_ID);

                // 手机端或找到 DF/DeepFlood 链接时，使用文字链接
                if (deepFloodLink || isMobile) {
                    iconLink?.remove();
                    if (textLink) {
                        if (deepFloodLink && textLink.previousElementSibling !== deepFloodLink) deepFloodLink.after(textLink);
                        return true;
                    }

                    const newLink = document.createElement("a");
                    newLink.id = TEXT_LINK_ID;
                    newLink.href = EMAIL_LINK_URL;
                    newLink.textContent = "邮箱";
                    newLink.target = "_blank";
                    newLink.rel = "noopener noreferrer";
                    if (deepFloodLink) {
                        newLink.className = deepFloodLink.className;
                        newLink.style.marginLeft = "16px";
                        deepFloodLink.after(newLink);
                    } else {
                        // 手机端没有 DF 链接时，追加到 header 导航最后
                        const navLinks = document.querySelector("header .nav-links, header nav, #nsk-head .header-nav");
                        if (navLinks) {
                            const lastLink = [...navLinks.querySelectorAll("a")].pop();
                            if (lastLink) {
                                newLink.className = lastLink.className;
                                newLink.style.marginLeft = "16px";
                                lastLink.after(newLink);
                            } else {
                                navLinks.appendChild(newLink);
                            }
                        }
                    }
                    return true;
                }

                // 桌面端无 DeepFlood 链接时，使用图标
                const grp = ensureIconGroup();
                if (!grp) return false;

                if (textLink) textLink.remove();
                if (iconLink) return true;

                const newIconLink = document.createElement("a");
                newIconLink.id = ICON_LINK_ID;
                newIconLink.href = EMAIL_LINK_URL;
                newIconLink.target = "_blank";
                newIconLink.rel = "noopener noreferrer";
                newIconLink.className = "email-dropdown-on";
                newIconLink.title = "邮箱";
                newIconLink.innerHTML = `<svg class="iconpark-icon" style="width:17px;height:17px"><use href="#envelope-one"></use></svg>`;
                grp.appendChild(newIconLink);
                return true;
            };

            ensureEntry();

            const header = document.querySelector("header");
            if (!header) return;
            const syncEntry = debounce(() => { ensureEntry(); }, 120);
            new MutationObserver(syncEntry).observe(header, { childList: true, subtree: true });
        }
    };


    /* ==========================================================================
       [ 辅助工具 ] - 楼中楼嵌套讨论串
       ========================================================================== */
    const nestedComments = {
        id: "nestedComments",
        deps: ["ui"],
        order: 115,
        match: ctx => ctx.isPost,
        init(ctx) {
            const escText = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
            const defaultExpanded = true;
            const autoCollapseQuote = true;
            const limitHeight = true;

            addStyle("nsx-nested-comments-css", `
                :root{--nsx-tree-line:#cbd5e1;--nsx-tree-line-active:#2563eb;--nsx-card-bg:rgba(125,140,160,.045);--nsx-card-bd:rgba(125,140,160,.16)}
                .dark-layout,html.dark{--nsx-tree-line:#47505e;--nsx-tree-line-active:#60a5fa;--nsx-card-bg:rgba(255,255,255,.028);--nsx-card-bd:rgba(255,255,255,.09)}
                .nsx-thread-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:10px 0 12px;padding:7px 10px;border-radius:10px;background:var(--nsx-card-bg);border:1px solid var(--nsx-card-bd);font-size:12px}
                .nsx-thread-seg{display:inline-flex;padding:2px;border-radius:7px;background:rgba(125,140,160,.12)}
                .nsx-thread-btn{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border:0;border-radius:5px;background:transparent;color:inherit;font-size:12px;line-height:1.4;cursor:pointer;transition:background-color .15s ease,color .15s ease}
                .nsx-thread-btn:hover{background:rgba(125,140,160,.14)}
                .nsx-thread-btn.is-active{background:#fff;color:#2563eb;font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.08)}
                .dark-layout .nsx-thread-btn.is-active,html.dark .nsx-thread-btn.is-active{background:#27272a;color:#60a5fa}
                .nsx-thread-stats{margin-left:auto;color:#71717a;font-size:12px;font-variant-numeric:tabular-nums}
                .dark-layout .nsx-thread-stats,html.dark .nsx-thread-stats{color:#a1a1aa}
                .nsx-thread-branch{position:relative;margin-top:0;padding-top:2px;padding-left:26px}
                .nsx-thread-branch[data-nsx-root]{margin-top:4px;padding-top:0;padding-left:0}
                .nsx-thread-scroll{position:relative;padding-top:2px;padding-left:28px}
                .nsx-thread-scroll.has-height-limit{max-height:min(460px,58vh);overflow-y:auto;overscroll-behavior:auto;scrollbar-gutter:stable;padding-right:4px}
                .nsx-thread-branch.nsx-thread-branch-flat,.nsx-thread-branch.nsx-thread-branch-flat>.nsx-thread-scroll{padding-left:0}
                .nsx-thread-guide{position:absolute;left:2px;top:0;bottom:0;width:18px;padding:0;border:0;background:transparent;cursor:pointer;z-index:1}
                .nsx-thread-guide::after{content:"";position:absolute;left:7px;top:0;bottom:0;width:2px;border-radius:2px;background:transparent;transition:background-color .15s ease}
                .nsx-thread-guide:hover::after{background:rgba(37,99,235,.2)}
                .nsx-thread-branch-flat>.nsx-thread-guide,.nsx-thread-branch-flat>.nsx-thread-scroll>.nsx-thread-guide{display:none}
                .nsx-thread-children{list-style:none!important;margin:0!important;padding:0!important}
                .nsx-thread-children>li.content-item{position:relative;margin:0!important;padding:5px 0 3px 0!important;border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;min-height:0!important;box-sizing:border-box}
                .nsx-thread-children>li.content-item::before{content:"";position:absolute;left:-17px;top:-2px;width:14px;height:17px;border-left:2px solid var(--nsx-tree-line);border-bottom:2px solid var(--nsx-tree-line);border-bottom-left-radius:6px;pointer-events:none;transition:border-color .15s ease}
                .nsx-thread-children>li.content-item:not(.nsx-thread-last):not(:last-child)::after{content:"";position:absolute;left:-17px;top:9px;bottom:-2px;border-left:2px solid var(--nsx-tree-line);pointer-events:none;transition:border-color .15s ease}
                .nsx-thread-children>li.content-item.nsx-thread-last::after{display:none!important}
                .nsx-thread-guide:hover~.nsx-thread-children>li.content-item::before,
                .nsx-thread-guide:hover~.nsx-thread-children>li.content-item:not(.nsx-thread-last):not(:last-child)::after{border-color:var(--nsx-tree-line-active)}
                .nsx-thread-branch-flat>.nsx-thread-children>li.content-item::before,
                .nsx-thread-branch-flat>.nsx-thread-children>li.content-item::after,
                .nsx-thread-branch-flat>.nsx-thread-scroll>.nsx-thread-children>li.content-item::before,
                .nsx-thread-branch-flat>.nsx-thread-scroll>.nsx-thread-children>li.content-item::after{display:none!important}
                /* Connect parent avatar stem down into nested branch */
                .nsx-thread-children li.content-item.nsx-has-children:not(.nsx-branch-collapsed)>.post-content::before{content:"";position:absolute;left:9px;top:0;bottom:-4px;border-left:2px solid var(--nsx-tree-line);pointer-events:none}
                .nsx-thread-children li.content-item.nsx-has-children:not(.nsx-branch-collapsed)>.topic-warning:not(:empty){position:relative;padding-left:26px}
                .nsx-thread-children li.content-item.nsx-has-children:not(.nsx-branch-collapsed)>.topic-warning:not(:empty)::before{content:"";position:absolute;left:9px;top:-4px;bottom:-4px;border-left:2px solid var(--nsx-tree-line);pointer-events:none}
                .nsx-thread-children li.content-item.nsx-has-children:not(.nsx-branch-collapsed).nsx-menu-expanded>.comment-menu::before{content:"";position:absolute;left:9px;top:-4px;bottom:-4px;border-left:2px solid var(--nsx-tree-line);pointer-events:none}
                /* Compact nested reply layout without card wrapper */
                .nsx-thread-children li.content-item>.nsk-content-meta-info{display:flex!important;align-items:center!important;gap:6px!important;padding:0!important;margin:0 0 2px!important;min-height:20px}
                .nsx-thread-children li.content-item>.nsk-content-meta-info .avatar-wrapper{display:flex;align-items:center;flex-shrink:0;margin:0!important}
                .nsx-thread-children li.content-item>.nsk-content-meta-info .avatar-wrapper img.avatar-normal{width:20px!important;height:20px!important;border-radius:5px!important;object-fit:cover}
                .nsx-thread-children li.content-item>.nsk-content-meta-info>div:not(.avatar-wrapper):not(.floor-link-wrapper){display:flex;align-items:center;min-width:0;flex:1 1 auto}
                .nsx-thread-children li.content-item>.nsk-content-meta-info .author-info{display:flex;align-items:center;flex-wrap:wrap;gap:5px;margin:0!important}
                .nsx-thread-children li.content-item>.nsk-content-meta-info .content-info{display:none!important}
                .nsx-thread-children li.content-item>.nsk-content-meta-info .floor-link-wrapper{position:static!important;top:auto!important;right:auto!important;bottom:auto!important;left:auto!important;display:inline-flex!important;align-items:center;gap:4px;margin-left:auto!important;flex-shrink:0;opacity:.72}
                .nsx-reply-menu-toggle{display:inline-flex;align-items:center;gap:2px;margin:0;padding:1px 6px;border:1px solid var(--nsx-card-bd);border-radius:4px;background:transparent;color:#71717a;font-size:11px;line-height:1.35;cursor:pointer;flex-shrink:0;transition:color .15s ease,border-color .15s ease,background-color .15s ease}
                .nsx-reply-menu-toggle:hover,.nsx-reply-menu-toggle.is-open{color:#2563eb;border-color:rgba(37,99,235,.4);background:rgba(37,99,235,.08)}
                .dark-layout .nsx-reply-menu-toggle,html.dark .nsx-reply-menu-toggle{color:#a1a1aa}
                .dark-layout .nsx-reply-menu-toggle:hover,.dark-layout .nsx-reply-menu-toggle.is-open,html.dark .nsx-reply-menu-toggle:hover,html.dark .nsx-reply-menu-toggle.is-open{color:#60a5fa;border-color:rgba(96,165,250,.45);background:rgba(96,165,250,.12)}
                .nsx-thread-children li.content-item>.post-content{position:relative;font-size:var(--nsx-comment-fs,14px);margin:0!important;padding-left:26px!important;overflow-wrap:anywhere}
                .nsx-thread-children li.content-item>.post-content>p:first-child{margin-top:0}
                .nsx-thread-children li.content-item>.post-content>p:last-child{margin-bottom:0}
                .nsx-thread-children li.content-item>.post-content img{max-width:100%;max-height:220px;width:auto;height:auto;border-radius:6px}
                .nsx-thread-children li.content-item .signature{display:none!important}
                .nsx-thread-children li.content-item>.topic-warning:empty{display:none!important}
                .nsx-thread-children li.content-item>.comment-menu{display:none!important;position:relative;margin-top:4px;padding:0 0 0 26px!important;opacity:.92}
                .nsx-thread-children li.content-item.nsx-menu-expanded>.comment-menu{display:flex!important}
                .nsx-thread-children li.content-item>.comment-menu .menu-item{margin-right:10px!important}
                .nsx-thread-branch.is-collapsed>.nsx-thread-scroll,.nsx-thread-branch.is-collapsed>.nsx-thread-children,.nsx-thread-branch.is-collapsed>.nsx-thread-guide{display:none}
                .nsx-thread-expand-bar{display:inline-flex;align-items:center;gap:5px;margin:4px 0 2px 26px;padding:3px 10px;border:1px dashed rgba(37,99,235,.42);border-radius:999px;background:rgba(37,99,235,.06);color:#2563eb;font-size:12px;cursor:pointer}
                .nsx-thread-branch[data-nsx-root]>.nsx-thread-expand-bar{margin-left:0}
                .nsx-thread-expand-bar:hover{background:rgba(37,99,235,.12)}
                .dark-layout .nsx-thread-expand-bar,html.dark .nsx-thread-expand-bar{color:#60a5fa;border-color:rgba(96,165,250,.4);background:rgba(96,165,250,.1)}
                .nsx-reply-to-badge{display:inline-flex;align-items:center;gap:3px;margin-left:4px;padding:1px 6px;border-radius:4px;font-size:11px;color:#4b5563;background:rgba(125,140,160,.12);cursor:pointer;vertical-align:middle}
                .nsx-reply-to-badge:hover{color:#2563eb;background:rgba(37,99,235,.1)}
                .dark-layout .nsx-reply-to-badge,html.dark .nsx-reply-to-badge{color:#cbd5e1;background:rgba(255,255,255,.1)}
                .nsx-quote-toggle{display:inline-flex;align-items:center;gap:6px;max-width:100%;margin:3px 0;padding:2px 8px;border:1px solid var(--nsx-card-bd);border-radius:5px;background:rgba(125,140,160,.07);color:#71717a;font-size:12px;line-height:1.4;cursor:pointer;text-align:left}
                .nsx-quote-toggle:hover{color:#2563eb;border-color:rgba(37,99,235,.38)}
                .dark-layout .nsx-quote-toggle,html.dark .nsx-quote-toggle{color:#a1a1aa;background:rgba(255,255,255,.05)}
                .nsx-quote-preview{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:340px}
                .nsx-quote-action{flex-shrink:0;color:#2563eb;font-weight:500}
                .dark-layout .nsx-quote-action,html.dark .nsx-quote-action{color:#60a5fa}
                .nsx-quote-collapsed{display:none!important}
                ul.comments li.content-item.nsx-thread-hidden,.nsx-thread-children>li.content-item.nsx-thread-hidden,.nsx-thread-hidden{display:none!important}
                .nsx-thread-highlight{outline:2px solid #2563eb;outline-offset:2px;transition:outline-color .4s ease}
                .nsx-mobile .nsx-thread-branch:not([data-nsx-root]){padding-left:24px}
                .nsx-mobile .nsx-thread-scroll{padding-left:24px}
                .nsx-mobile .nsx-thread-children>li.content-item{padding:4px 0 3px 0!important}
                .nsx-mobile .nsx-thread-children>li.content-item::before,.nsx-mobile .nsx-thread-children>li.content-item:not(.nsx-thread-last):not(:last-child)::after{left:-15px}
                .nsx-mobile .nsx-thread-children>li.content-item::before{width:12px;height:16px}
                .nsx-mobile .nsx-quote-preview{max-width:180px}
            `);

            let viewMode = "tree"; // 'tree' | 'flat'
            let onlyOp = false;
            let initializedExpandState = false;
            const collapsedSet = new Set();
            let origSeq = 0;
            let toolbar = null;
            let isRebuilding = false;
            let listObserver = null;
            let cachedOp = null;

            const getListEl = () => $(".comment-container ul.comments, ul.comments");
            const getOpIdentity = () => {
                const postAuthor = $(".nsk-post .nsk-content-meta-info .author-info a[href*='/space/']") || $(".nsk-post .author-info a[href*='/space/']");
                const pd = ctx.uw?.__config__?.postData;
                const opCfg = pd?.op;
                const uid = postAuthor?.href?.match(/\/space\/(\d+)/)?.[1]
                    || (opCfg?.uid != null ? String(opCfg.uid) : opCfg?.id != null ? String(opCfg.id) : opCfg?.member_id != null ? String(opCfg.member_id) : pd?.op_id != null ? String(pd.op_id) : "");
                const name = (postAuthor?.textContent || opCfg?.name || opCfg?.member_name || pd?.author || "").trim();
                if (uid || name) cachedOp = { uid, name };
                return cachedOp || { uid: "", name: "" };
            };
            const isOpMatch = (uid, name, op) => {
                if (op.uid && uid) return String(uid) === String(op.uid);
                if (op.name && name) return name.trim().toLowerCase() === op.name.trim().toLowerCase();
                return false;
            };

            const collectItems = listEl => {
                const rawItems = [...listEl.querySelectorAll("li.content-item")];
                rawItems.forEach(li => {
                    if (!li.dataset.nsxOrigIdx) li.dataset.nsxOrigIdx = String(++origSeq);
                });
                rawItems.sort((a, b) => Number(a.dataset.nsxOrigIdx) - Number(b.dataset.nsxOrigIdx));
                return rawItems;
            };

            const extractMeta = li => {
                const floorEl = [...li.children].find(c => !c.classList.contains("nsx-thread-branch"))?.querySelector?.(".floor-link") || li.querySelector(".nsk-content-meta-info .floor-link");
                const floorMatch = floorEl?.textContent?.match(/(\d+)/);
                const floor = floorMatch ? Number(floorMatch[1]) : Number(li.dataset.nsxOrigIdx || 0);
                li.dataset.nsxFloor = String(floor);

                const authorLink = li.querySelector(".nsk-content-meta-info .author-info a[href*='/space/']") || li.querySelector(".author-info a[href*='/space/']");
                const author = authorLink?.textContent?.trim() || "";
                const authorUid = authorLink?.href?.match(/\/space\/(\d+)/)?.[1] || "";

                const contentEl = [...li.children].find(c => !c.classList.contains("nsx-thread-branch"))?.classList?.contains("post-content")
                    ? [...li.children].find(c => c.classList.contains("post-content"))
                    : li.querySelector(":scope > .post-content, :scope > div > .post-content, .post-content");

                return { li, floor, author, authorUid, contentEl };
            };

            const getOwnBlockquotes = (li, contentEl) => {
                if (!contentEl) return [];
                return [...contentEl.querySelectorAll("blockquote")].filter(bq => bq.closest("li.content-item") === li);
            };

            const unwrapQuotes = li => {
                li.querySelectorAll(":scope .nsx-quote-toggle").forEach(btn => {
                    if (btn.closest("li.content-item") === li) btn.remove();
                });
                li.querySelectorAll(":scope blockquote.nsx-quote-collapsed").forEach(bq => {
                    if (bq.closest("li.content-item") === li) bq.classList.remove("nsx-quote-collapsed");
                });
            };

            const collapseOwnQuotes = li => {
                if (!autoCollapseQuote) return;
                const bqs = getOwnBlockquotes(li, li.querySelector(".post-content"));
                bqs.forEach(bq => {
                    if (bq.previousElementSibling?.classList?.contains("nsx-quote-toggle")) return;
                    const text = bq.textContent.replace(/\s+/g, " ").trim();
                    if (!text) return;
                    const preview = text.length > 48 ? `${text.slice(0, 48)}...` : text;
                    const btn = document.createElement("button");
                    btn.type = "button";
                    btn.className = "nsx-quote-toggle";
                    btn.innerHTML = `${svgIcon("nsx-quote", 12)}<span class="nsx-quote-preview">${escText(preview)}</span><span class="nsx-quote-action">展开引用</span>`;
                    bq.classList.add("nsx-quote-collapsed");
                    btn.onclick = e => {
                        e.preventDefault();
                        e.stopPropagation();
                        const collapsed = bq.classList.toggle("nsx-quote-collapsed");
                        const act = btn.querySelector(".nsx-quote-action");
                        if (act) act.textContent = collapsed ? "展开引用" : "收起引用";
                    };
                    bq.before(btn);
                });
            };

            const findParent = (item, idx, items, byFloor) => {
                const ce = item.contentEl;
                if (!ce) return null;
                const bqs = getOwnBlockquotes(item.li, ce);
                const candidates = [];

                // Strategy 1: quoted floor link or href=#N
                for (const bq of bqs) {
                    bq.querySelectorAll("a.floor-link, a[href*='#']").forEach(a => {
                        const m = (a.getAttribute("href") || "").match(/#(\d+)/) || a.textContent.match(/#(\d+)/);
                        if (m) candidates.push(Number(m[1]));
                    });
                    const tm = bq.textContent.match(/#(\d+)/);
                    if (tm) candidates.push(Number(tm[1]));
                }
                ce.querySelectorAll("a.floor-link").forEach(a => {
                    if (a.closest("li.content-item") !== item.li) return;
                    const m = a.textContent.match(/#(\d+)/) || (a.getAttribute("href") || "").match(/#(\d+)/);
                    if (m) candidates.push(Number(m[1]));
                });
                const headText = (ce.textContent || "").trim().slice(0, 80);
                const headFloor = headText.match(/^@[^\s#]+\s*#(\d+)/) || headText.match(/^#(\d+)\b/);
                if (headFloor) candidates.push(Number(headFloor[1]));

                for (const f of candidates) {
                    const p = byFloor.get(f);
                    if (p && p.floor < item.floor) return p;
                }

                // Strategy 2 & 3: @username mention in blockquote or leading text -> nearest earlier floor by user
                let targetName = "";
                for (const bq of bqs) {
                    const sp = bq.querySelector("a[href*='/space/']");
                    if (sp?.textContent?.trim()) { targetName = sp.textContent.trim().replace(/^@/, ""); break; }
                    const at = bq.textContent.match(/@([^\s@,，:：()（）\[\]]+)/);
                    if (at) { targetName = at[1]; break; }
                }
                if (!targetName) {
                    const firstLink = [...ce.querySelectorAll("a[href*='/space/']")].find(a => a.closest("li.content-item") === item.li);
                    if (firstLink?.textContent?.trim()) targetName = firstLink.textContent.trim().replace(/^@/, "");
                }
                if (!targetName) {
                    const at = headText.match(/@([^\s@,，:：()（）\[\]]+)/);
                    if (at) targetName = at[1];
                }
                if (targetName) {
                    const lower = targetName.toLowerCase();
                    for (let j = idx - 1; j >= 0; j--) {
                        if (items[j].author.toLowerCase() === lower && items[j].floor < item.floor) {
                            return items[j];
                        }
                    }
                }
                return null;
            };

            const countDescendants = node => node.children.reduce((s, c) => s + 1 + countDescendants(c), 0);

            const collectStats = listEl => {
                if (!listEl) return { total: 0, visible: 0, roots: 0, rootsWithChildren: 0, collapsedRoots: 0 };
                const all = [...listEl.querySelectorAll("li.content-item")];
                const total = all.length;
                const visible = all.filter(li => !li.classList.contains("nsx-thread-hidden")).length;
                const roots = [...listEl.children].filter(el => el.matches?.("li.content-item") && !el.classList.contains("nsx-thread-hidden")).length;
                const rootBranches = [...listEl.querySelectorAll(".nsx-thread-branch[data-nsx-root]")].filter(b => !b.closest("li.content-item")?.classList.contains("nsx-thread-hidden"));
                const rootsWithChildren = rootBranches.length;
                const collapsedRoots = rootBranches.filter(b => b.classList.contains("is-collapsed")).length;
                return { total, visible, roots, rootsWithChildren, collapsedRoots };
            };

            const ensureToolbar = (listEl, stats) => {
                if (!toolbar || !toolbar.isConnected) {
                    toolbar = document.createElement("div");
                    toolbar.className = "nsx-thread-toolbar";
                    toolbar.innerHTML = `
                        <div class="nsx-thread-seg">
                            <button type="button" class="nsx-thread-btn" data-nsx-tact="mode-tree">${svgIcon("nsx-tree", 13)}<span>楼中楼</span></button>
                            <button type="button" class="nsx-thread-btn" data-nsx-tact="mode-flat">${svgIcon("nsx-list", 13)}<span>原版时间序</span></button>
                        </div>
                        <button type="button" class="nsx-thread-btn" data-nsx-tact="toggle-op"><span>只看楼主</span></button>
                        <button type="button" class="nsx-thread-btn" data-nsx-tact="toggle-all">${svgIcon("nsx-chevron", 12)}<span>全部折叠</span></button>
                        <span class="nsx-thread-stats"></span>
                    `;
                    toolbar._refs = {
                        btnTree: toolbar.querySelector('[data-nsx-tact="mode-tree"]'),
                        btnFlat: toolbar.querySelector('[data-nsx-tact="mode-flat"]'),
                        btnOp: toolbar.querySelector('[data-nsx-tact="toggle-op"]'),
                        btnAll: toolbar.querySelector('[data-nsx-tact="toggle-all"]'),
                        stats: toolbar.querySelector('.nsx-thread-stats')
                    };
                    toolbar.onclick = e => {
                        const btn = e.target.closest("[data-nsx-tact]");
                        if (!btn) return;
                        e.preventDefault();
                        const act = btn.dataset.nsxTact;
                        if (act === "mode-tree" && viewMode !== "tree") {
                            viewMode = "tree";
                            window.__nsxRuntime?.rebuildThreads?.cancel?.();
                            rebuild();
                        } else if (act === "mode-flat" && viewMode !== "flat") {
                            viewMode = "flat";
                            window.__nsxRuntime?.rebuildThreads?.cancel?.();
                            rebuild();
                        } else if (act === "toggle-op") {
                            onlyOp = !onlyOp;
                            window.__nsxRuntime?.rebuildThreads?.cancel?.();
                            rebuild();
                        } else if (act === "toggle-all") {
                            const curList = getListEl();
                            const branches = [...curList?.querySelectorAll(".nsx-thread-branch[data-nsx-root]") || []];
                            const curStats = collectStats(curList);
                            const allCollapsedNow = curStats.rootsWithChildren > 0 && curStats.collapsedRoots >= curStats.rootsWithChildren;
                            if (allCollapsedNow) {
                                collapsedSet.clear();
                                branches.forEach(b => {
                                    b.classList.remove("is-collapsed");
                                    const bar = b.querySelector(":scope > .nsx-thread-expand-bar");
                                    if (bar) bar.style.display = "none";
                                });
                            } else {
                                branches.forEach(b => {
                                    const f = Number(b.dataset.nsxRoot);
                                    if (Number.isFinite(f)) collapsedSet.add(f);
                                    b.classList.add("is-collapsed");
                                    const bar = b.querySelector(":scope > .nsx-thread-expand-bar");
                                    if (bar) bar.style.display = "inline-flex";
                                });
                            }
                            ensureToolbar(curList, collectStats(curList));
                        }
                    };
                    listEl.before(toolbar);
                }
                const refs = toolbar._refs;
                const allCollapsed = stats.rootsWithChildren > 0 && stats.collapsedRoots >= stats.rootsWithChildren;
                refs.btnTree.classList.toggle("is-active", viewMode === "tree");
                refs.btnFlat.classList.toggle("is-active", viewMode === "flat");
                refs.btnOp.classList.toggle("is-active", onlyOp);
                const showToggleAll = viewMode === "tree" && stats.rootsWithChildren > 0 && !onlyOp;
                refs.btnAll.style.display = showToggleAll ? "inline-flex" : "none";
                const allLabel = refs.btnAll.querySelector("span");
                if (allLabel) allLabel.textContent = allCollapsed ? "全部展开" : "全部折叠";
                refs.stats.textContent = onlyOp
                    ? `只看楼主 ${stats.visible} / 共 ${stats.total} 条评论`
                    : (viewMode === "tree" ? `共 ${stats.total} 条评论 · ${stats.roots} 个讨论串` : `共 ${stats.total} 条评论`);
            };

            const attachWheelPassthrough = scrollBox => {
                scrollBox.addEventListener("wheel", event => {
                    if (event.ctrlKey || event.defaultPrevented || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
                    const max = Math.max(0, scrollBox.scrollHeight - scrollBox.clientHeight);
                    if (max <= 0) return;
                    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scrollBox.clientHeight : 1);
                    const next = Math.max(0, Math.min(max, scrollBox.scrollTop + delta));
                    const remainder = delta - (next - scrollBox.scrollTop);
                    if (Math.abs(remainder) > 0.5 && event.cancelable) {
                        event.preventDefault();
                        scrollBox.scrollTop = next;
                        window.scrollBy({ top: remainder, left: 0, behavior: "instant" });
                    }
                }, { passive: false });
            };

            const observeList = () => {
                const listEl = getListEl();
                if (listEl && listObserver) listObserver.observe(listEl, { childList: true });
            };

            const rebuild = () => {
                if (isRebuilding) return;
                const listEl = getListEl();
                if (!listEl) return;
                isRebuilding = true;
                listObserver?.disconnect();
                try {
                    const rawItems = collectItems(listEl);
                    const op = getOpIdentity();

                    // Cleanup previous tree scaffolding while keeping items intact.
                    rawItems.forEach(li => {
                        li.querySelectorAll(":scope > .nsx-thread-branch").forEach(b => b.remove());
                        li.querySelectorAll(":scope .nsx-reply-to-badge, :scope .nsx-reply-menu-toggle").forEach(b => {
                            if (b.closest("li.content-item") === li) b.remove();
                        });
                        li.classList.remove("nsx-thread-hidden", "nsx-thread-last", "nsx-has-children", "nsx-branch-collapsed", "nsx-menu-expanded");
                        unwrapQuotes(li);
                    });

                    if (viewMode === "flat") {
                        const frag = document.createDocumentFragment();
                        rawItems.forEach(li => {
                            if (onlyOp) {
                                const authorLink = li.querySelector(".nsk-content-meta-info .author-info a[href*='/space/']") || li.querySelector(".author-info a[href*='/space/']");
                                const uid = authorLink?.href?.match(/\/space\/(\d+)/)?.[1] || "";
                                const name = authorLink?.textContent?.trim() || "";
                                li.classList.toggle("nsx-thread-hidden", !isOpMatch(uid, name, op));
                            }
                            frag.appendChild(li);
                        });
                        listEl.appendChild(frag);
                        ensureToolbar(listEl, collectStats(listEl));
                        return;
                    }

                    const items = rawItems.map(li => ({ ...extractMeta(li), parent: null, children: [], depth: 0 }));
                    const byFloor = new Map(items.map(it => [it.floor, it]));

                    const wouldCycle = (child, candParent) => {
                        let cur = candParent;
                        while (cur) {
                            if (cur === child) return true;
                            cur = cur.parent;
                        }
                        return false;
                    };

                    items.forEach((it, idx) => {
                        const p = findParent(it, idx, items, byFloor);
                        if (p && !wouldCycle(it, p)) {
                            it.parent = p;
                            p.children.push(it);
                        }
                    });

                    const isMobile = document.documentElement.classList.contains("nsx-mobile") || window.innerWidth <= 760;
                    const maxVisualDepth = isMobile ? 2 : 4;

                    const isOpItem = it => isOpMatch(it.authorUid, it.author, op);
                    const hasOpInSubtree = it => isOpItem(it) || it.children.some(hasOpInSubtree);

                    const roots = items.filter(it => !it.parent);
                    if (!initializedExpandState) {
                        initializedExpandState = true;
                        if (!defaultExpanded) {
                            roots.forEach(r => { if (r.children.length) collapsedSet.add(r.floor); });
                        }
                    }

                    const mountBranch = (node, depth) => {
                        node.depth = depth;
                        if (onlyOp && !hasOpInSubtree(node)) node.li.classList.add("nsx-thread-hidden");

                        if (depth >= 1) {
                            collapseOwnQuotes(node.li);
                            const metaInfo = [...node.li.children].find(c => c.classList.contains("nsk-content-meta-info")) || node.li.querySelector(".nsk-content-meta-info");
                            const replyMenu = [...node.li.children].find(c => c.classList.contains("comment-menu"));
                            if (metaInfo && replyMenu) {
                                const menuBtn = document.createElement("button");
                                menuBtn.type = "button";
                                menuBtn.className = "nsx-reply-menu-toggle";
                                menuBtn.textContent = "操作";
                                menuBtn.title = "展开/收起操作栏";
                                menuBtn.setAttribute("aria-expanded", "false");
                                menuBtn.onclick = e => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    const expanded = node.li.classList.toggle("nsx-menu-expanded");
                                    menuBtn.classList.toggle("is-open", expanded);
                                    menuBtn.textContent = expanded ? "收起" : "操作";
                                    menuBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
                                };
                                metaInfo.appendChild(menuBtn);
                            }
                            if (depth > maxVisualDepth && node.parent) {
                                const authorWrap = node.li.querySelector(".nsk-content-meta-info .author-info");
                                if (authorWrap) {
                                    const badge = document.createElement("span");
                                    badge.className = "nsx-reply-to-badge";
                                    badge.textContent = `回复 @${node.parent.author || "匿名"} #${node.parent.floor}`;
                                    badge.title = "点击定位到被回复楼层";
                                    badge.onclick = e => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        node.parent.li.scrollIntoView({ behavior: "smooth", block: "center" });
                                        node.parent.li.classList.add("nsx-thread-highlight");
                                        setTimeout(() => node.parent.li.classList.remove("nsx-thread-highlight"), 1400);
                                    };
                                    authorWrap.appendChild(badge);
                                }
                            }
                        }

                        if (!node.children.length) return;
                        const branch = document.createElement("div");
                        const isFlatIndent = depth + 1 > maxVisualDepth;
                        branch.className = `nsx-thread-branch${isFlatIndent ? " nsx-thread-branch-flat" : ""}`;
                        if (depth === 0) branch.dataset.nsxRoot = String(node.floor);

                        const descCount = countDescendants(node);
                        const isCollapsed = !onlyOp && collapsedSet.has(node.floor);
                        if (isCollapsed) branch.classList.add("is-collapsed");

                        const expandBar = document.createElement("button");
                        expandBar.type = "button";
                        expandBar.className = "nsx-thread-expand-bar";
                        expandBar.innerHTML = `${svgIcon("nsx-chevron", 12)}<span>展开 ${descCount} 条回复</span>`;
                        expandBar.style.display = isCollapsed ? "inline-flex" : "none";

                        const guide = document.createElement("button");
                        guide.type = "button";
                        guide.className = "nsx-thread-guide";
                        guide.title = "点击折叠/展开此讨论分支";

                        const toggleBranch = e => {
                            e?.preventDefault?.();
                            e?.stopPropagation?.();
                            const nextCollapsed = branch.classList.toggle("is-collapsed");
                            node.li.classList.toggle("nsx-branch-collapsed", nextCollapsed);
                            if (nextCollapsed) collapsedSet.add(node.floor);
                            else collapsedSet.delete(node.floor);
                            expandBar.style.display = nextCollapsed ? "inline-flex" : "none";
                            ensureToolbar(listEl, collectStats(listEl));
                        };
                        guide.onclick = toggleBranch;
                        expandBar.onclick = toggleBranch;

                        const ul = document.createElement("ul");
                        ul.className = "nsx-thread-children";
                        node.children.forEach(child => {
                            ul.appendChild(child.li);
                            mountBranch(child, depth + 1);
                        });
                        const visibleChildren = node.children.filter(c => !c.li.classList.contains("nsx-thread-hidden"));
                        if (onlyOp && !visibleChildren.length) return;
                        const lastVisible = visibleChildren[visibleChildren.length - 1];
                        if (lastVisible) lastVisible.li.classList.add("nsx-thread-last");

                        if (!isFlatIndent) node.li.classList.add("nsx-has-children");
                        if (isCollapsed) node.li.classList.add("nsx-branch-collapsed");

                        if (depth === 0) {
                            const scrollBox = document.createElement("div");
                            scrollBox.className = `nsx-thread-scroll${limitHeight ? " has-height-limit" : ""}`;
                            if (limitHeight) attachWheelPassthrough(scrollBox);
                            scrollBox.append(guide, ul);
                            branch.append(expandBar, scrollBox);
                        } else {
                            branch.append(expandBar, guide, ul);
                        }
                        node.li.appendChild(branch);
                    };

                    const frag = document.createDocumentFragment();
                    roots.forEach(root => {
                        frag.appendChild(root.li);
                        mountBranch(root, 0);
                    });
                    listEl.appendChild(frag);
                    const sampleRoot = roots.find(r => r.contentEl)?.contentEl;
                    if (sampleRoot) {
                        const fs = getComputedStyle(sampleRoot).fontSize;
                        if (fs) listEl.style.setProperty("--nsx-comment-fs", fs);
                    }
                    ensureToolbar(listEl, collectStats(listEl));
                } finally {
                    listObserver?.takeRecords();
                    observeList();
                    isRebuilding = false;
                }
            };

            window.__nsxRuntime ||= {};
            window.__nsxRuntime.rebuildThreads = debounce(rebuild, 80);

            const initWhenReady = () => {
                const listEl = getListEl();
                if (!listEl) return;
                listObserver = new MutationObserver(muts => {
                    if (isRebuilding) return;
                    const hasNewItem = muts.some(m => [...m.addedNodes].some(n => {
                        if (n.nodeType !== 1) return false;
                        if (n.matches?.("li.content-item") && !n.dataset.nsxOrigIdx) return true;
                        return !![...n.querySelectorAll?.("li.content-item") || []].some(el => !el.dataset.nsxOrigIdx);
                    }));
                    if (hasNewItem) window.__nsxRuntime.rebuildThreads();
                });
                rebuild();
            };
            initWhenReady();
        }
    };

    // ===== SVG 图标 =====
    const SVG_SPRITE = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">
<symbol id="comments" viewBox="0 0 48 48"><g fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="4"><path d="M44 6H4v30h8.5v7l9-7H44V6Z"/><path stroke-linecap="round" d="M14 19.5h20M14 27.5h12"/></g></symbol>
<symbol id="at-sign" viewBox="0 0 48 48"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="4"><path d="M24 44c11.046 0 20-8.954 20-20S35.046 4 24 4 4 12.954 4 24s8.954 20 20 20"/><path d="M32 24c0 4.418-3.582 10-8 10s-8-5.582-8-10 3.582-8 8-8 8 3.582 8 8m0 0v10c0 3 3 6 6 6"/></g></symbol>
<symbol id="envelope-one" viewBox="0 0 48 48"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="4"><path d="M4 39h40V9H4z"/><path d="m4 9 20 15L44 9"/></g></symbol>
<symbol id="remind-6nce9p47" viewBox="0 0 48 48"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="4"><path d="M24 44c1.387 0 2.732-.123 4.023-.357M44 24a20 20 0 0 0-40 0c0 4.59 1.55 8.82 4.157 12.194L4 44l7.806-4.157A19.9 19.9 0 0 0 24 44a20 20 0 0 0 4.023-.357"/><path d="M33.805 40a6 6 0 1 0 5.857-9.805"/></g></symbol>
<symbol id="nsx-plus" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M12 5v14M5 12h14"/></symbol>
<symbol id="nsx-close" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M18 6 6 18M6 6l12 12"/></symbol>
<symbol id="nsx-bolt" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/></symbol>
<symbol id="nsx-quote" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M10 11H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3a1 1 0 0 1 1 1v6c0 2.5-1.5 4.5-4 5m14-6h-4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3a1 1 0 0 1 1 1v6c0 2.5-1.5 4.5-4 5"/></symbol>
<symbol id="nsx-tree" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M5 4v14h5m-5-7h5"/><rect width="8" height="4" x="10" y="9" fill="none" stroke="currentColor" stroke-width="1.8" rx="1"/><rect width="8" height="4" x="10" y="16" fill="none" stroke="currentColor" stroke-width="1.8" rx="1"/><rect width="10" height="4" x="3" y="2" fill="none" stroke="currentColor" stroke-width="1.8" rx="1"/></symbol>
<symbol id="nsx-list" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8" d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></symbol>
<symbol id="nsx-chevron" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="m6 9 6 6 6-6"/></symbol>
</svg>`;

    // ===== 基础 CSS =====
    const BASE_CSS = `.nsx-svg{display:inline-block;vertical-align:-0.15em;fill:none;stroke:currentColor;flex-shrink:0}.nsx-post-folded>*:not(.nsx-fold-notice){display:none!important}.nsx-post-folded{background-color:rgba(244,67,54,.05)!important;padding:0!important}.nsx-fold-notice{font-size:12px;color:#f44336;padding:10px;opacity:.8;display:flex;justify-content:space-between;align-items:center}.nsx-unfold-btn{cursor:pointer;text-decoration:underline}.nsx-post-hidden{display:none!important}#nsx-toggle-autoload{display:flex;justify-content:center;align-items:center}#back-to-comment{display:flex}#fast-nav-button-group .nav-item-btn:nth-last-child(4){bottom:120px}#fast-nav-button-group .nav-item-btn:nth-last-child(5){bottom:160px}#fast-nav-button-group .nav-item-btn:nth-last-child(6){bottom:200px}#fast-nav-button-group .nav-item-btn:nth-last-child(7){bottom:240px}#nsx-icon-group{display:flex;align-items:center;gap:0!important;list-style:none;border-left:1px solid var(--border-color,#e5e7eb);margin-left:6px!important;padding-left:6px!important;height:30px}#nsx-icon-group:empty{display:none!important}#nsx-icon-group>.filter-dropdown-on,#nsx-icon-group>.email-dropdown-on{cursor:pointer;display:flex!important;align-items:center;justify-content:center;height:30px!important;padding:0 6px!important;min-width:auto!important;width:auto!important;margin:0!important;position:relative!important;top:0!important;transition:opacity .1s;color:inherit;text-decoration:none}#nsx-icon-group>.filter-dropdown-on svg,#nsx-icon-group>.email-dropdown-on svg{display:block!important;width:16px!important;height:16px!important;transform:translateY(0)!important}#nsx-icon-group>.filter-dropdown-on:hover,#nsx-icon-group>.email-dropdown-on:hover{opacity:.6}#nsx-filter-panel{position:fixed;right:12px;top:60px;width:min(380px,94vw);height:min(700px,80vh);background:#fff;border:1px solid #e4e4e4;border-radius:12px;box-shadow:0 16px 32px rgba(0,0,0,.12);z-index:99999;display:none;flex-direction:column;overflow:hidden}#nsx-filter-panel.show{display:flex}.dark-layout #nsx-filter-panel{background:#1e1e1e;border-color:#3a3a3a;color:#e0e0e0}.dark-layout #nsx-icon-group{border-left-color:#3a3a3a}.msc-overlay{background-color:var(--bg-sub-color)}.nsx-mobile .md-editor .mde-toolbar{display:flex;flex-wrap:wrap;align-items:center;height:auto!important;min-height:40px;padding-right:4px;overflow:visible}.nsx-mobile .md-editor .mde-toolbar>*{flex:0 0 auto}.nsx-mobile .md-editor .mde-toolbar .toolbar-item{height:30px;line-height:30px}.nsx-mobile .md-editor .mde-toolbar .toolbar-item.right{margin-left:auto}.nsx-mobile .md-editor .mde-toolbar .toolbar-tabs{width:100%;order:-1}.nsx-mobile .layui-layer{max-width:94vw!important}.nsx-mobile .layui-layer .layui-form-label{width:auto!important;float:none!important;text-align:left!important;padding:0 0 4px!important}.nsx-mobile .layui-layer .layui-input-block{margin-left:0!important}`;

    // ===== Observer =====
    class Observer {
        constructor() { this.listeners = []; this.mo = null; }
        watch(sel, fn, opts = {}) {
            this.listeners.push({ sel, fn, opts });
            if (!this.mo) {
                this.mo = new MutationObserver(debounce((muts) => {
                    if (!muts?.some(m => m.addedNodes?.length)) return;
                    this._run();
                }, 50));
                this.mo.observe(document.body, { childList: true, subtree: true });
            }
        }
        _run() {
            this.listeners.forEach(({ sel, fn, opts }) => {
                const els = $$(sel);
                if (els.length) fn(els, opts);
            });
        }
    }

    // ===== 创建 ctx =====
    function createCtx(obs) {
        const uw = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
        return {
            env, $, $$, addStyle, store, net,
            uw,
            get loggedIn() { return !!uw?.__config__?.user; },
            get user() { return uw?.__config__?.user; },
            get uid() { return uw?.__config__?.user?.member_id; },
            site: env.site,
            isPost: /^\/post-/.test(location.pathname),
            isList: /^\/(categories\/|page|award|search|$)/.test(location.pathname),
            watch: obs.watch.bind(obs),
            ui: {}
        };
    }

    // ===== 启动 =====
    function start() {
        const isMobileClient = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.matchMedia?.("(hover: none) and (pointer: coarse)")?.matches;
        if (isMobileClient) document.documentElement.classList.add("nsx-mobile");

        // 注入资源
        document.body?.insertAdjacentHTML("beforeend", SVG_SPRITE);
        addStyle("nsx-base", BASE_CSS);
        // layui CSS
        addStyle("nsx-layui-css", "https://s.cfn.pp.ua/layui/2.10.3/css/layui.css");
        addStyle("nsx-layui-dark", "https://s.cfn.pp.ua/layui/theme-dark/2.10.3/css/layui-theme-dark-selector.css");

        // 同步 Layui 深色主题类
        const syncDarkClass = () => {
            document.documentElement.classList.toggle("dark", document.body.classList.contains("dark-layout"));
        };
        syncDarkClass();
        new MutationObserver(syncDarkClass).observe(document.body, { attributes: true, attributeFilter: ["class"] });

        // 创建 Observer & ctx
        const obs = new Observer();
        const ctx = createCtx(obs);
        ensureIconGroup();
        const headEl = document.querySelector('#nsk-head');
        if (headEl) {
            let syncingIconGroup = false;
            const syncIconGroup = debounce(() => {
                if (syncingIconGroup) return;
                syncingIconGroup = true;
                try { ensureIconGroup(); } finally { syncingIconGroup = false; }
            }, 120);
            new MutationObserver(syncIconGroup).observe(headEl, { childList: true });
        }

        // 初始化 UI (依赖 layui)
        const initUI = () => {
            if (!window.layui?.layer) return (ctx.ui = {});
            const layer = window.layui.layer, uw = ctx.uw;
            ctx.ui = {
                layer,
                toast: (text, style) => { const idx = layer.msg(text, { offset: 't', area: ['100%', 'auto'], anim: 'slideDown' }); layer.style(idx, Object.assign({ opacity: 0.9 }, style)); return idx; },
                info: msg => ctx.ui.toast(msg, { "background-color": "#4D82D6" }),
                success: msg => ctx.ui.toast(msg, { "background-color": "#57BF57" }),
                warning: msg => ctx.ui.toast(msg, { "background-color": "#D6A14D" }),
                error: msg => ctx.ui.toast(msg, { "background-color": "#E1715B" }),
                alert: (t, c, fn) => uw?.mscAlert ? (c === undefined ? uw.mscAlert(t) : uw.mscAlert(t, c)) : layer.alert(c, { title: t, icon: 0, btn: ["确定"] }, fn),
                confirm: (t, c, y, n) => uw?.mscConfirm ? uw.mscConfirm(t, c, y, n) : layer.confirm(c, { title: t, icon: 0, btn: ["确定", "取消"] }, y, n),
                tips: (msg, el, opts) => layer.tips(msg, el, opts)
            };
        };
        initUI();
        if (!ctx.ui.layer) {
            const timer = setInterval(() => { if (window.layui?.layer) { initUI(); clearInterval(timer); } }, 100);
            setTimeout(() => clearInterval(timer), 5000);
        }

        /* ==========================================================================
           [ 基础功能 ] - 图床上传助手 (NodeImage)
           ========================================================================== */
        const imageUpload = {
            id: "imageUpload",
            order: 150,
            match: ctx => ctx.isPost || location.pathname.startsWith('/new-discussion') || location.pathname.startsWith('/notification'),
            init(ctx) {
                const APP = {
                    api: {
                        key: ctx.store.get("image_upload.api_key", ""),
                        setKey: key => {
                            ctx.store.set("image_upload.api_key", key);
                            APP.api.key = key;
                            UI.updateState();
                        },
                        clearKey: () => {
                            ctx.store.set("image_upload.api_key", "");
                            APP.api.key = '';
                            UI.updateState();
                        },
                        endpoints: {
                            upload: 'https://api.nodeimage.com/api/upload',
                            apiKey: 'https://api.nodeimage.com/api/user/api-key'
                        }
                    },
                    site: { url: 'https://www.nodeimage.com' },
                    storage: {
                        keys: { loginCheck: 'nodeimage_login_check', loginStatus: 'nodeimage_login_status', logout: 'nodeimage_logout' },
                        get: key => localStorage.getItem(APP.storage.keys[key]),
                        set: (key, value) => localStorage.setItem(APP.storage.keys[key], value),
                        remove: key => localStorage.removeItem(APP.storage.keys[key])
                    },
                    retry: { max: 2, delay: 1000 },
                    statusTimeout: 2000,
                    auth: { recentLoginGracePeriod: 30000, loginCheckInterval: 3000, loginCheckTimeout: 300000 }
                };

                const SELECTORS = { editor: '.CodeMirror', toolbar: '.mde-toolbar', imgBtn: '.toolbar-item.i-icon.i-icon-pic[title="图片"]', container: '#nodeimage-toolbar-container' };

                const STATUS = {
                    SUCCESS: { class: 'success', color: '#42d392' },
                    ERROR: { class: 'error', color: '#f56c6c' },
                    WARNING: { class: 'warning', color: '#e6a23c' },
                    INFO: { class: 'info', color: '#0078ff' }
                };

                const MESSAGE = { READY: '图床已就绪', UPLOADING: '上传中...', UPLOAD_SUCCESS: '上传成功！', LOGIN_EXPIRED: '图床登录已失效', LOGOUT: '图床已退出登录', RETRY: (c, m) => `重试 (${c}/${m})` };

                const DOM = {
                    editor: null,
                    statusElements: new Set(),
                    loginButtons: new Set(),
                    getEditor: () => DOM.editor?.CodeMirror
                };

                addStyle("nsx-image-upload", `
                #nodeimage-status { margin-left: 10px; display: inline-block; font-size: 13px; height: 28px; line-height: 28px; transition: all 0.3s ease; }
                #nodeimage-status.success { color: ${STATUS.SUCCESS.color}; }
                #nodeimage-status.error { color: ${STATUS.ERROR.color}; }
                #nodeimage-status.warning { color: ${STATUS.WARNING.color}; }
                #nodeimage-status.info { color: ${STATUS.INFO.color}; }
                .nodeimage-login-btn { cursor: pointer; margin-left: 10px; color: ${STATUS.WARNING.color}; font-size: 13px; background: rgba(230,162,60,0.1); padding: 3px 8px; border-radius: 4px; border: 1px solid rgba(230,162,60,0.2); }
                .nodeimage-key-btn { cursor: pointer; margin-left: 8px; color: #71717a; font-size: 12px; background: rgba(125,140,160,0.1); padding: 2px 7px; border-radius: 4px; border: 1px solid rgba(125,140,160,0.22); }
                .nodeimage-key-btn:hover { color: #1677ff; border-color: rgba(22,119,255,0.4); }
                .dark-layout .nodeimage-key-btn { color: #a1a1aa; }
                .nodeimage-toolbar-container { display: flex; align-items: center; margin-left: auto; margin-right: 10px; }
            `);

                const Utils = {
                    waitForElement: selector => new Promise(res => {
                        const el = document.querySelector(selector);
                        if (el) return res(el);
                        new MutationObserver((_, o) => { const found = document.querySelector(selector); if (found) { o.disconnect(); res(found); } }).observe(document.body, { childList: true, subtree: true });
                    }),
                    isEditingInEditor: () => { const a = document.activeElement; return a && (a.classList.contains('CodeMirror') || a.closest('.CodeMirror') || a.tagName === 'TEXTAREA'); },
                    getActiveCodeMirror: (evtTarget = null) => {
                        const fromTarget = evtTarget?.closest?.('.CodeMirror')?.CodeMirror;
                        if (fromTarget) return fromTarget;
                        const active = document.activeElement;
                        const fromActive = active?.closest?.('.CodeMirror')?.CodeMirror || (active?.classList?.contains('CodeMirror') ? active.CodeMirror : null);
                        if (fromActive) return fromActive;
                        return DOM.getEditor();
                    },
                    createFileInput: cb => { const i = Object.assign(document.createElement('input'), { type: 'file', multiple: true, accept: 'image/*' }); i.onchange = e => cb([...e.target.files]); i.click(); },
                    delay: ms => new Promise(r => setTimeout(r, ms))
                };

                const API = {
                    request: ({ url, method = 'GET', data = null, headers = {}, withAuth = false }) => {
                        return new Promise((resolve, reject) => {
                            GM_xmlhttpRequest({
                                method, url,
                                headers: { 'Accept': 'application/json', ...(withAuth && APP.api.key ? { 'X-API-Key': APP.api.key } : {}), ...headers },
                                data, withCredentials: true, responseType: 'json',
                                onload: response => { if (response.status === 200 && response.response) resolve(response.response); else reject(response); },
                                onerror: reject
                            });
                        });
                    },
                    checkLoginAndGetKey: async () => {
                        try {
                            const response = await API.request({ url: APP.api.endpoints.apiKey });
                            if (response.api_key) { APP.api.setKey(response.api_key); return true; }
                            if (response.error) APP.api.clearKey();
                            return false;
                        } catch (error) { APP.api.clearKey(); return false; }
                    },
                    uploadImage: async (file, retries = 0) => {
                        try {
                            const formData = new FormData();
                            formData.append('image', file);
                            const result = await API.request({ url: APP.api.endpoints.upload, method: 'POST', data: formData, withAuth: true });
                            if (result.success) return { url: result.links.direct, markdown: result.links.markdown };
                            else {
                                const errorMsg = result.error || '未知错误';
                                if (errorMsg.toLowerCase().match(/unauthorized|invalid api key|未授权|无效的api密钥/)) { APP.api.clearKey(); throw new Error(MESSAGE.LOGIN_EXPIRED); }
                                throw new Error(errorMsg);
                            }
                        } catch (error) {
                            if (error.status === 401 || error.status === 403) { APP.api.clearKey(); throw new Error(MESSAGE.LOGIN_EXPIRED); }
                            if (retries < APP.retry.max) {
                                setStatus(STATUS.WARNING.class, MESSAGE.RETRY(retries + 1, APP.retry.max));
                                await Utils.delay(APP.retry.delay);
                                return API.uploadImage(file, retries + 1);
                            }
                            throw error instanceof Error ? error : new Error(String(error));
                        }
                    }
                };

                const setStatus = (cls, msg, ttl = 0) => { DOM.statusElements.forEach(el => { el.className = cls; el.textContent = msg; }); if (ttl) return Utils.delay(ttl).then(UI.updateState); };

                const UI = {
                    updateState: () => {
                        const isLoggedIn = Boolean(APP.api.key);
                        DOM.loginButtons.forEach(btn => { btn.style.display = isLoggedIn ? 'none' : 'inline-block'; });
                        DOM.statusElements.forEach(el => {
                            if (isLoggedIn) { el.className = STATUS.SUCCESS.class; el.textContent = MESSAGE.READY; }
                            else { el.textContent = ''; }
                        });
                    },
                    openLogin: () => { APP.storage.set('loginStatus', 'login_pending'); window.open(APP.site.url, '_blank'); },
                    promptKey: () => {
                        const current = APP.api.key || '';
                        if (!ctx.ui.layer?.open) {
                            const res = window.prompt('输入 NodeImage API Key（留空清除）:', current);
                            if (res === null) return;
                            const val = res.trim();
                            if (val) { APP.api.setKey(val); ctx.ui.success?.('NodeImage API Key 已保存'); }
                            else { APP.api.clearKey(); ctx.ui.info?.('已清除 NodeImage API Key'); }
                            return;
                        }
                        ctx.ui.layer.open({
                            title: 'NodeImage API Key',
                            area: ['min(380px,92vw)', 'auto'],
                            content: `<div style="padding:16px 18px 6px;"><input type="text" id="nsx-nodeimage-key-inp" class="layui-input" placeholder="留空可清除本地 API Key"></div>`,
                            btn: ['保存', '清空', '取消'],
                            success: ly => {
                                const r = ly?.[0] || ly;
                                const inp = r?.querySelector?.('#nsx-nodeimage-key-inp');
                                if (inp) { inp.value = current; inp.focus(); }
                            },
                            yes: (idx, ly) => {
                                const r = ly?.[0] || ly;
                                const val = (r?.querySelector?.('#nsx-nodeimage-key-inp')?.value || '').trim();
                                if (val) { APP.api.setKey(val); ctx.ui.success?.('NodeImage API Key 已保存'); }
                                else { APP.api.clearKey(); ctx.ui.info?.('已清除 NodeImage API Key'); }
                                ctx.ui.layer.close(idx);
                            },
                            btn2: idx => {
                                APP.api.clearKey();
                                ctx.ui.info?.('已清除 NodeImage API Key');
                                ctx.ui.layer.close(idx);
                                return false;
                            }
                        });
                    },
                    setupToolbar: toolbar => {
                        if (!toolbar || toolbar.querySelector(SELECTORS.container)) return;
                        const container = document.createElement('div'); container.id = 'nodeimage-toolbar-container'; container.className = 'nodeimage-toolbar-container';

                        const fullScreenBtn = toolbar.querySelector('.i-icon-full-screen-one')?.parentElement || toolbar.querySelector('.i-icon-off-screen-one')?.parentElement || toolbar.querySelector('.toolbar-item.right');
                        if (fullScreenBtn) {
                            toolbar.insertBefore(container, fullScreenBtn);
                        } else {
                            toolbar.appendChild(container);
                        }

                        const imgBtn = toolbar.querySelector(SELECTORS.imgBtn);
                        if (imgBtn) {
                            const newBtn = imgBtn.cloneNode(true);
                            imgBtn.parentNode.replaceChild(newBtn, imgBtn);
                            newBtn.addEventListener('click', async () => {
                                DOM.editor = document.activeElement?.closest?.('.CodeMirror') || DOM.editor;
                                if (!APP.api.key || !(await Auth.checkLoginIfNeeded())) { UI.openLogin(); return; }
                                const targetCm = Utils.getActiveCodeMirror();
                                Utils.createFileInput(files => ImageHandler.handleFiles(files, targetCm));
                            });
                        }

                        const statusEl = document.createElement('div'); statusEl.id = 'nodeimage-status'; statusEl.className = STATUS.INFO.class;
                        container.appendChild(statusEl); DOM.statusElements.add(statusEl);
                        const loginBtn = document.createElement('div'); loginBtn.className = 'nodeimage-login-btn'; loginBtn.textContent = '登录 NodeImage';
                        loginBtn.addEventListener('click', UI.openLogin); loginBtn.style.display = 'none';
                        container.appendChild(loginBtn); DOM.loginButtons.add(loginBtn);
                        const keyBtn = document.createElement('div'); keyBtn.className = 'nodeimage-key-btn'; keyBtn.textContent = 'API Key';
                        keyBtn.title = '查看或手动设置 NodeImage API Key';
                        keyBtn.addEventListener('click', UI.promptKey);
                        container.appendChild(keyBtn);
                        UI.updateState();
                    }
                };

                const ImageHandler = {
                    handlePaste: e => {
                        if (!Utils.isEditingInEditor()) return;
                        const targetCm = Utils.getActiveCodeMirror(e.target);
                        if (targetCm?.getWrapperElement) DOM.editor = targetCm.getWrapperElement();
                        const dt = e.clipboardData || e.originalEvent?.clipboardData; if (!dt) return;
                        let files = [];
                        if (dt.files && dt.files.length) { files = Array.from(dt.files).filter(f => f.type.startsWith('image/')); }
                        else if (dt.items && dt.items.length) { files = Array.from(dt.items).filter(i => i.kind === 'file' && i.type.startsWith('image/')).map(i => i.getAsFile()).filter(Boolean); }
                        if (files.length) {
                            e.preventDefault(); e.stopPropagation();
                            if (!APP.api.key) { UI.openLogin(); return; }
                            ImageHandler.handleFiles(files, targetCm);
                        }
                    },
                    handleFiles: (files, targetCm = null) => {
                        if (!APP.api.key) { UI.openLogin(); return; }
                        files.filter(file => file?.type.startsWith('image/')).forEach(file => ImageHandler.uploadAndInsert(file, targetCm));
                    },
                    uploadAndInsert: async (file, targetCm = null) => {
                        setStatus(STATUS.INFO.class, MESSAGE.UPLOADING);
                        try {
                            const result = await API.uploadImage(file);
                            ImageHandler.insertMarkdown(result.markdown, targetCm);
                            await setStatus(STATUS.SUCCESS.class, MESSAGE.UPLOAD_SUCCESS, APP.statusTimeout);
                        } catch (error) {
                            if (error.message === MESSAGE.LOGIN_EXPIRED) await Auth.checkLoginIfNeeded(true);
                            console.error('[NodeImage]', error);
                            await setStatus(STATUS.ERROR.class, `上传失败: ${error.message}`, APP.statusTimeout);
                            ctx.ui.error?.(`图片上传失败: ${error.message}`);
                        }
                    },
                    insertMarkdown: (markdown, preferredCm = null) => {
                        const cm = preferredCm || Utils.getActiveCodeMirror();
                        if (cm) { const cursor = cm.getCursor(); cm.replaceRange(`\n${markdown}\n`, cursor); }
                    }
                };

                const Auth = {
                    checkLoginIfNeeded: async (forceCheck = false) => {
                        if (APP.api.key && !forceCheck) return true;
                        const isLoggedIn = await API.checkLoginAndGetKey();
                        if (!isLoggedIn && APP.api.key) setStatus(STATUS.WARNING.class, MESSAGE.LOGIN_EXPIRED);
                        UI.updateState();
                        return isLoggedIn;
                    },
                    checkLogoutFlag: () => { if (APP.storage.get('logout') === 'true') { APP.api.clearKey(); APP.storage.remove('logout'); setStatus(STATUS.WARNING.class, MESSAGE.LOGOUT); } },
                    checkRecentLogin: async () => { const lastLoginCheck = APP.storage.get('loginCheck'); if (lastLoginCheck && (Date.now() - parseInt(lastLoginCheck) < APP.auth.recentLoginGracePeriod)) { await API.checkLoginAndGetKey(); APP.storage.remove('loginCheck'); } },
                    setupStorageListener: () => {
                        window.addEventListener('storage', event => {
                            const { loginStatus, logout } = APP.storage.keys;
                            if (event.key === loginStatus && event.newValue === 'login_success') { API.checkLoginAndGetKey(); localStorage.removeItem(loginStatus); }
                            else if (event.key === logout && event.newValue === 'true') { APP.api.clearKey(); localStorage.removeItem(logout); }
                        });
                    }
                };

                const initModule = async () => {
                    document.addEventListener('paste', ImageHandler.handlePaste, true);
                    window.addEventListener('focus', () => Auth.checkLoginIfNeeded());
                    Utils.waitForElement(SELECTORS.editor).then(editor => {
                        DOM.editor = editor;
                        editor.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
                        editor.addEventListener('drop', e => {
                            e.preventDefault();
                            const targetCm = Utils.getActiveCodeMirror(e.target);
                            if (targetCm?.getWrapperElement) DOM.editor = targetCm.getWrapperElement();
                            ImageHandler.handleFiles(Array.from(e.dataTransfer.files), targetCm);
                        });
                    });
                    Utils.waitForElement(SELECTORS.toolbar).then(UI.setupToolbar);
                    const syncEditor = () => {
                        const editor = document.querySelector(SELECTORS.editor);
                        if (editor) DOM.editor = editor;
                        const toolbar = document.querySelector(SELECTORS.toolbar);
                        if (toolbar && !toolbar.querySelector(SELECTORS.container)) UI.setupToolbar(toolbar);
                    };
                    ctx.watch(SELECTORS.toolbar, syncEditor, { debounce: 200 });
                    const observer = new MutationObserver(muts => {
                        if (muts.some(m => m.addedNodes.length)) syncEditor();
                    });
                    observer.observe(document.body, {
                        childList: true,
                        subtree: true
                    });
                    document.addEventListener('click', e => {
                        if (e.target.closest('.tab-option')) {
                            setTimeout(syncEditor, 100);
                        }
                    });

                    Auth.checkLogoutFlag(); Auth.setupStorageListener(); await Auth.checkRecentLogin(); await Auth.checkLoginIfNeeded();
                };

                initModule();
            }
        };


        /* ==========================================================================
           [ 辅助工具 ] - 楼层快捷回复 (挂载于评论菜单 引用/回复 后)
           ========================================================================== */
        const floorQuickReply = {
            id: 'floorQuickReply', order: 396,
            match: ctx => ctx.isPost && ctx.loggedIn,
            init(ctx) {
                const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
                const defaults = () => [
                    { name:'赞一个', text:'good！！:xhj002: :xhj002: :xhj002:' },
                    { name:'赞同', text:'赞同！:xhj002: :xhj002: :xhj002:' },
                    { name:'收藏', text:'收藏了，谢谢！:xhj002:' },
                    { name:'同问', text:'同问！！:xhj002: :xhj002: :xhj002:' }
                ];
                const readPresets = () => {
                    try { const raw=ctx.store.get('floor_quick_reply.presets','');if(!raw)return defaults();const data=JSON.parse(raw);return Array.isArray(data)?data.filter(x=>x&&typeof x.text==='string'&&x.text.trim()):defaults(); }catch{return defaults();}
                };
                const make = (tag, text, cls) => {const el=document.createElement(tag);if(text!=null)el.textContent=text;if(cls)el.className=cls;return el;};
                addStyle('nsx-floor-quick-style', `
                    .nsx-reply-dialog{width:min(820px,92vw);max-height:85vh;box-sizing:border-box;padding:24px;border:0;border-radius:16px;background:#fff;color:#273141;box-shadow:0 20px 60px #0003;overflow:auto;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
                    .nsx-reply-dialog::backdrop{background:#17213355;backdrop-filter:blur(5px)}
                    .nsx-reply-dialog>header{position:static!important;width:auto!important;height:auto!important;min-height:0!important;padding:0!important;background:transparent!important;box-shadow:none!important;border:0!important;display:flex;align-items:center;justify-content:space-between;font-size:19px;font-weight:600;margin-bottom:18px}
                    .nsx-reply-dialog button{cursor:pointer;border:1px solid #dbe1e8;border-radius:6px;background:transparent;color:inherit;padding:8px 12px;font:inherit;display:inline-flex;align-items:center;gap:5px}
                    .nsx-reply-dialog>footer{position:static!important;width:auto!important;height:auto!important;padding:0!important;background:transparent!important;box-shadow:none!important;border:0!important;display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}
                    .nsx-reply-edit-row{display:grid;grid-template-columns:minmax(0,1fr) 60px;gap:10px;align-items:center;padding:14px;margin-bottom:12px;background:#f5f7fa;border-radius:10px}
                    .nsx-reply-edit-row input,.nsx-reply-edit-row textarea{box-sizing:border-box;width:100%;min-width:0;border:1px solid #d9dfe6;border-radius:6px;background:#fff;color:inherit;padding:10px;font:inherit}
                    .nsx-reply-edit-row textarea{min-height:44px;resize:vertical}
                    .nsx-reply-dialog .nsx-reply-save{background:#4679aa;color:#fff;border-color:#4679aa}
                    .dark-layout .nsx-reply-dialog,.dark .nsx-reply-dialog{background:#252b34;color:#e2e7ef}
                    .dark-layout .nsx-reply-edit-row,.dark .nsx-reply-edit-row{background:#303742}
                    .dark-layout .nsx-reply-edit-row input,.dark-layout .nsx-reply-edit-row textarea,.dark .nsx-reply-edit-row input,.dark .nsx-reply-edit-row textarea{background:#252b34;border-color:#515a69}
                    @media(max-width:600px){.nsx-reply-edit-row{grid-template-columns:minmax(0,1fr) 60px}.nsx-reply-dialog{padding:16px}}
                    .comment-menu .nsx-quick-reply-btn{display:inline-flex;align-items:center}
                    .comment-menu .nsx-quick-reply-btn .nsx-svg{width:1em!important;height:1em!important;margin-right:4px}
                    .nsx-qr-popover{position:fixed;z-index:2147483600;width:248px;max-width:calc(100vw - 16px);overflow:auto;overscroll-behavior:contain;padding:8px;box-sizing:border-box;border-radius:10px;border:1px solid #e4e4e7;background:#fff;color:#09090b;box-shadow:0 10px 28px rgba(0,0,0,.12),0 2px 6px rgba(0,0,0,.06);font:12px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
                    .dark-layout .nsx-qr-popover,html.dark .nsx-qr-popover{background:#18181b;border-color:#27272a;color:#fafafa;box-shadow:0 12px 32px rgba(0,0,0,.45)}
                    .nsx-qr-head{display:flex;align-items:center;justify-content:space-between;padding:2px 4px 6px;margin-bottom:6px;border-bottom:1px solid #f4f4f5;font-size:11.5px;font-weight:600;color:#71717a}
                    .dark-layout .nsx-qr-head,html.dark .nsx-qr-head{border-bottom-color:#27272a;color:#a1a1aa}
                    .nsx-qr-manage{border:0;background:transparent;color:#2563eb;font-size:11.5px;font-weight:500;cursor:pointer;padding:2px 5px;border-radius:4px}
                    .nsx-qr-manage:hover{background:rgba(37,99,235,.1)}
                    .dark-layout .nsx-qr-manage,html.dark .nsx-qr-manage{color:#60a5fa}
                    .nsx-qr-list{display:flex;flex-direction:column;gap:4px}
                    .nsx-qr-item{display:block;width:100%;padding:6px 8px;border:1px solid transparent;border-radius:6px;background:#f4f4f5;color:inherit;text-align:left;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;cursor:pointer;transition:background-color .14s,border-color .14s}
                    .nsx-qr-item:hover{background:#e4e4e7;border-color:#d4d4d8}
                    .dark-layout .nsx-qr-item,html.dark .nsx-qr-item{background:#27272a}
                    .dark-layout .nsx-qr-item:hover,html.dark .nsx-qr-item:hover{background:#3f3f46;border-color:#52525b}
                    .nsx-qr-empty{padding:6px 4px;color:#71717a;font-size:11.5px}
                `);
                const dialog = title => {
                    document.querySelectorAll('dialog.nsx-reply-dialog').forEach(x=>{x.close();x.remove();});
                    const d=make('dialog',null,'nsx-reply-dialog'),header=make('header'),heading=make('span',title),close=make('button','','nsx-reply-close');close.type='button';close.innerHTML=svgIcon('nsx-close',14);close.setAttribute('aria-label','关闭');header.append(heading,close);d.append(header);document.body.append(d);close.onclick=()=>d.close();d.addEventListener('close',()=>d.remove(),{once:true});d.showModal();return d;
                };
                const manage = () => {
                    const d=dialog('管理快捷回复'),list=make('div'),footer=make('footer');d.append(list,footer);
                    const addRow = item => {
                        const row=make('div',null,'nsx-reply-edit-row');
                        for(const [key,label]of [['text','回复内容']]){const input=make(key==='text'?'textarea':'input');input.value=item[key]||'';input.dataset.field=key;input.placeholder=label;input.setAttribute('aria-label',label);row.append(input);}
                        const remove=make('button','删除');remove.type='button';remove.style.color='#e05c65';remove.onclick=()=>row.remove();row.append(remove);list.append(row);
                    };
                    readPresets().forEach(addRow);
                    const add=make('button',''),reset=make('button','恢复默认'),save=make('button','保存', 'nsx-reply-save'),cancel=make('button','取消');
                    add.innerHTML=`${svgIcon('nsx-plus',13)}<span>添加快捷回复</span>`;
                    for(const button of [add,reset,save,cancel])button.type='button';footer.append(add,reset,save,cancel);
                    add.onclick=()=>addRow({name:'',text:''});reset.onclick=()=>{list.replaceChildren();defaults().forEach(addRow);};cancel.onclick=()=>d.close();
                    save.onclick=()=>{const items=[...list.children].map(row=>Object.fromEntries([...row.querySelectorAll('[data-field]')].map(el=>[el.dataset.field,el.value.trim()])));if(items.some(x=>!x.text)){ctx.ui.error?.('请填写每条预设的回复内容');return;}ctx.store.set('floor_quick_reply.presets',JSON.stringify(items));d.close();ctx.ui.toast?.('快捷回复已保存');};
                };
                let sending = false;
                const editorState = () => {
                    const editor=document.querySelector('.md-editor');
                    const cm=editor?.querySelector('.CodeMirror')?.CodeMirror,ta=editor?.querySelector('textarea');
                    return {editor,cm,ta,text:cm?cm.getValue():(ta?.value||'')};
                };
                const sendPreset = async (target, item) => {
                    if(sending)return;
                    if(editorState().text.trim()){ctx.ui.error?.('编辑器已有草稿，请先发送或清空草稿，再使用快捷回复');return;}
                    sending=true;
                    try {
                        const post = target?.closest?.('.nsk-post, .comments > li, .comment-item, .content-item') || target;
                        const nativeReply = post && [...post.querySelectorAll('.comment-menu .menu-item, .comment-menu a, .comment-menu button')].find(x => (x.querySelector('span')?.textContent || x.textContent).trim() === '回复');
                        if(nativeReply)nativeReply.click();else document.querySelector('#back-to-comment')?.click();
                        let state;
                        for(let i=0;i<20;i++){await new Promise(resolve=>setTimeout(resolve,100));state=editorState();if(state.cm||state.ta)break;}
                        if(!state?.cm&&!state?.ta)throw Error('未找到回复编辑器，请先登录并确认可以回复');
                        const username=post?.querySelector?.('.author-info a[href*="/space/"]')?.textContent.trim()||'';
                        const floor=post?.querySelector?.('.floor-link')?.textContent.trim()||'';
                        const prefix=!nativeReply&&username?`@${username}${floor?' '+floor:''} `:'';
                        const content=state.text+prefix+item.text;
                        if(state.cm){state.cm.setValue(content);}
                        else{state.ta.value=content;state.ta.dispatchEvent(new Event('input',{bubbles:true}));}
                        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
                        const submit=state.editor.querySelector('button.submit.btn,button.submit,button[type="submit"]');
                        if(!submit||submit.disabled||submit.getAttribute('aria-disabled')==='true')throw Error('发布按钮暂不可用，内容已保留在编辑器');
                        if(editorState().text!==content)throw Error('回复内容发生变化，已取消自动发送');
                        submit.click();
                    } catch(error){ctx.ui.error?.(error.message||'快捷回复失败');}
                    finally{setTimeout(()=>{sending=false;},1800);}
                };

                let popover = null;
                let popoverAnchor = null;

                const closePopover = () => {
                    if (!popover) return;
                    popover.hidden = true;
                    popoverAnchor?.setAttribute('aria-expanded', 'false');
                    popoverAnchor = null;
                };
                const positionPopover = () => {
                    if (!popover || popover.hidden || !popoverAnchor?.isConnected) {
                        if (popover && !popover.hidden) closePopover();
                        return;
                    }
                    const view = window.visualViewport;
                    const left = (view?.offsetLeft || 0) + 8;
                    const top = (view?.offsetTop || 0) + 8;
                    const right = left + (view?.width || document.documentElement.clientWidth) - 16;
                    const bottom = top + (view?.height || window.innerHeight) - 16;
                    popover.style.maxHeight = `${Math.max(120, bottom - top)}px`;
                    popover.style.maxWidth = `${Math.max(200, right - left)}px`;
                    const anchor = popoverAnchor.getBoundingClientRect();
                    const rect = popover.getBoundingClientRect();
                    const below = bottom - anchor.bottom - 6;
                    const above = anchor.top - top - 6;
                    const y = rect.height <= below || below >= above ? anchor.bottom + 6 : anchor.top - rect.height - 6;
                    popover.style.left = `${Math.max(left, Math.min(anchor.right - rect.width, right - rect.width))}px`;
                    popover.style.top = `${Math.max(top, Math.min(y, bottom - rect.height))}px`;
                };
                const ensurePopover = () => {
                    if (popover && popover.isConnected) return popover;
                    popover = document.createElement('div');
                    popover.id = 'nsx-qr-popover';
                    popover.className = 'nsx-qr-popover';
                    popover.setAttribute('role', 'dialog');
                    popover.hidden = true;
                    popover.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
                    document.body.appendChild(popover);
                    return popover;
                };
                const openPopover = (anchorBtn, postEl) => {
                    if (popoverAnchor === anchorBtn && popover && !popover.hidden) {
                        closePopover();
                        return;
                    }
                    closePopover();
                    const pop = ensurePopover();
                    popoverAnchor = anchorBtn;
                    anchorBtn.setAttribute('aria-expanded', 'true');
                    const presets = readPresets();
                    pop.innerHTML = `
                        <div class="nsx-qr-head">
                            <span>快捷回复</span>
                            <button type="button" class="nsx-qr-manage" data-qr="manage">管理</button>
                        </div>
                        <div class="nsx-qr-list">
                            ${presets.length
                                ? presets.map((p, idx) => `<button type="button" class="nsx-qr-item" data-qr-idx="${idx}">${escapeHtml(p.text)}</button>`).join('')
                                : '<div class="nsx-qr-empty">暂无预设，点击右上角管理添加</div>'}
                        </div>
                    `;
                    pop.onclick = e => {
                        e.stopPropagation();
                        const itemBtn = e.target.closest('[data-qr-idx]');
                        if (itemBtn) {
                            e.preventDefault();
                            const preset = presets[Number(itemBtn.dataset.qrIdx)];
                            closePopover();
                            if (preset) sendPreset(postEl, preset);
                            return;
                        }
                        if (e.target.closest('[data-qr="manage"]')) {
                            e.preventDefault();
                            closePopover();
                            manage();
                        }
                    };
                    pop.hidden = false;
                    positionPopover();
                    requestAnimationFrame(positionPopover);
                };

                document.addEventListener('click', e => {
                    if (popover && !popover.hidden && !popover.contains(e.target) && !popoverAnchor?.contains(e.target)) closePopover();
                });
                document.addEventListener('keydown', e => {
                    if (e.key === 'Escape' && popover && !popover.hidden) {
                        const a = popoverAnchor;
                        closePopover();
                        a?.focus?.();
                    }
                });
                window.addEventListener('resize', positionPopover, { passive: true });
                window.addEventListener('scroll', e => {
                    if (e.target?.nodeType && popover?.contains(e.target)) return;
                    positionPopover();
                }, { capture: true, passive: true });
                window.visualViewport?.addEventListener('resize', positionPopover);
                window.addEventListener('pagehide', closePopover);

                const injectMenuButtons = (root = document) => {
                    root.querySelectorAll('.comment-menu').forEach(menu => {
                        if (menu.querySelector('.nsx-quick-reply-btn')) return;
                        const items = [...menu.querySelectorAll(':scope > .menu-item')];
                        const replyItem = items.find(el => (el.querySelector('span')?.textContent || el.textContent).trim() === '回复');
                        const quoteItem = items.find(el => (el.querySelector('span')?.textContent || el.textContent).trim() === '引用');
                        const anchorItem = replyItem || quoteItem;
                        if (!anchorItem) return;

                        const btn = document.createElement('div');
                        btn.className = 'menu-item nsx-quick-reply-btn';
                        btn.title = '快捷回复';
                        btn.setAttribute('role', 'button');
                        btn.setAttribute('tabindex', '0');
                        btn.setAttribute('aria-haspopup', 'dialog');
                        btn.setAttribute('aria-expanded', 'false');
                        btn.innerHTML = `${svgIcon('nsx-bolt', 14, 'iconpark-icon')}<span>快捷回复</span>`;

                        const postEl = menu.closest('.nsk-post, .comments > li, .comment-item, .content-item');
                        const trigger = e => {
                            e.preventDefault();
                            e.stopPropagation();
                            openPopover(btn, postEl);
                        };
                        btn.onclick = trigger;
                        btn.onkeydown = e => {
                            if (e.key === 'Enter' || e.key === ' ') trigger(e);
                        };
                        anchorItem.after(btn);
                    });
                };

                injectMenuButtons(document);
                ctx.watch('.comment-menu', () => injectMenuButtons(document), { debounce: 80 });
            }
        };

        /* ==========================================================================
           [ 社交关系 ] - 头像面板拉黑
           ========================================================================== */
        const userRelation = {
            id: "userRelation",
            order: 390,
            match: () => true,
            init(ctx) {
                const blacklistKey = 'nsx_advanced_blacklist';
                const getMap = (key) => {
                    try { return JSON.parse(localStorage.getItem(key) || '{}'); }
                    catch { return {}; }
                };
                const saveMap = (key, map) => localStorage.setItem(key, JSON.stringify(map));
                const formatNow = () => {
                    const d = new Date(), p = n => String(n).padStart(2, '0');
                    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
                };
                const confirmAction = (title, msg, onOk) => {
                    if (ctx.ui.confirm) ctx.ui.confirm(title, msg, onOk);
                    else if (window.confirm(msg)) onOk();
                };

                const state = {
                    blacklist: getMap(blacklistKey)
                };

                let processAll = () => { };
                let processList = () => { };
                let syncHoverCard = () => { };

                const reapplyRelation = () => {
                    state.blacklist = getMap(blacklistKey);
                    ctx.$$(".nsx-post-hidden").forEach(el => el.classList.remove("nsx-post-hidden"));
                    ctx.$$('[data-nsx-relation-processed],[data-nsx-relation-list-processed]').forEach(el => {
                        delete el.dataset.nsxRelationProcessed;
                        delete el.dataset.nsxRelationListProcessed;
                    });
                    processAll();
                    processList();
                    syncHoverCard();
                };

                const toggleBlacklist = (username, userId) => {
                    state.blacklist = getMap(blacklistKey);
                    const existing = state.blacklist[username];
                    if (existing) {
                        confirmAction("取消拉黑", `确定将 ${username} 移出黑名单吗？`, async () => {
                            const targetId = existing.userId || userId;
                            if (targetId && /^\d+$/.test(String(targetId))) {
                                try {
                                    await ctx.net.post("/api/block-list/del", { block_member_id: Number(targetId) });
                                } catch (err) {
                                    env.error("Official Unblock Failed", err);
                                }
                            }
                            delete state.blacklist[username];
                            saveMap(blacklistKey, state.blacklist);
                            ctx.ui.toast?.(`已将 ${username} 移出黑名单`);
                            reapplyRelation();
                        });
                        return;
                    }

                    confirmAction("拉黑用户", `确定要拉黑 ${username} 吗？`, async () => {
                        try {
                            const r = await ctx.net.post("/api/block-list/add", { block_member_name: username });
                            if (!r?.success) ctx.ui.toast?.(r?.message || "官方屏蔽接口调用失败，已保存本地状态");
                        } catch (err) {
                            env.error("Official Block Failed", err);
                        }
                        state.blacklist[username] = { userId: String(userId || ""), time: formatNow() };
                        saveMap(blacklistKey, state.blacklist);
                        ctx.ui.toast?.(`已拉黑 ${username}`);
                        reapplyRelation();
                    });
                };

                let isSyncingCard = false;
                syncHoverCard = () => {
                    if (isSyncingCard) return;
                    const card = document.querySelector('.user-card.hover-user-card');
                    if (!card || getComputedStyle(card).display === 'none') return;
                    const group = card.querySelector('.usercard-button-group');
                    const userLink = card.querySelector('.user-head .menu a.Username[href*="/space/"], .user-head a.Username[href*="/space/"], a.Username[href*="/space/"]');
                    isSyncingCard = true;
                    try {
                        if (!group || !userLink) {
                            card.querySelectorAll('.nsx-card-block-btn').forEach(el => el.remove());
                            return;
                        }
                        const username = userLink.textContent.trim();
                        const uidMatch = (userLink.getAttribute('href') || '').match(/\/space\/(\d+)/);
                        const targetUid = uidMatch ? uidMatch[1] : '';
                        const isSelf = !username
                            || (ctx.user?.member_name && username === ctx.user.member_name)
                            || (ctx.uid && targetUid && String(ctx.uid) === String(targetUid));
                        if (isSelf) {
                            card.querySelectorAll('.nsx-card-block-btn').forEach(el => el.remove());
                            return;
                        }

                        state.blacklist = getMap(blacklistKey);

                        let blBtn = group.querySelector('.nsx-card-block-btn');
                        if (!blBtn) {
                            blBtn = document.createElement('a');
                            blBtn.href = 'javascript:void(0)';
                            blBtn.className = 'btn nsx-card-block-btn';
                            group.appendChild(blBtn);
                        }
                        const isBlocked = !!state.blacklist[username];
                        const nextText = isBlocked ? '取消拉黑' : '拉黑';
                        if (blBtn.textContent !== nextText) blBtn.textContent = nextText;
                        blBtn.classList.toggle('is-active-block', isBlocked);
                        blBtn.onclick = (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            card.querySelector('.closeBtn')?.click();
                            toggleBlacklist(username, targetUid);
                        };
                    } finally {
                        isSyncingCard = false;
                    }
                };

                let cardSyncRaf = 0;
                const scheduleCardSync = () => {
                    if (cardSyncRaf) return;
                    cardSyncRaf = requestAnimationFrame(() => {
                        cardSyncRaf = 0;
                        syncHoverCard();
                    });
                };
                const bindHoverCardObserver = () => {
                    document.querySelectorAll('.user-card.hover-user-card').forEach(card => {
                        if (card.dataset.nsxCardObserved) return;
                        card.dataset.nsxCardObserved = '1';
                        new MutationObserver(() => {
                            if (!isSyncingCard) scheduleCardSync();
                        }).observe(card, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
                        scheduleCardSync();
                    });
                };
                bindHoverCardObserver();
                ctx.watch('.user-card.hover-user-card', bindHoverCardObserver, { debounce: 50 });

                addStyle("nsx-user-relation", `
                .user-card.hover-user-card .usercard-button-group { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
                .user-card.hover-user-card .usercard-button-group .btn { margin-right: 0 !important; }
                .user-card.hover-user-card .usercard-button-group .nsx-card-block-btn { background: #ef4444 !important; border-color: #ef4444 !important; color: #fff !important; }
                .user-card.hover-user-card .usercard-button-group .nsx-card-block-btn:hover { background: #dc2626 !important; border-color: #dc2626 !important; color: #fff !important; }
                .user-card.hover-user-card .usercard-button-group .nsx-card-block-btn.is-active-block { color: #ef4444 !important; background: rgba(239, 68, 68, .15) !important; border-color: rgba(239, 68, 68, .55) !important; }
                .user-card.hover-user-card .usercard-button-group .nsx-card-block-btn.is-active-block:hover { background: rgba(239, 68, 68, .24) !important; }
                `);

                // 帖子页处理逻辑
                if (ctx.isPost) {
                    const processPostItem = (authorLink) => {
                        const postEl = authorLink.closest('.nsk-post, .comments > li, li.comment-item, .comment-item, li');
                        if (!postEl || postEl.dataset.nsxRelationProcessed) return;

                        const username = authorLink.textContent.trim();
                        if (!username) return;

                        postEl.dataset.nsxRelationProcessed = "1";
                        if (state.blacklist[username]) {
                            postEl.classList.add('nsx-post-hidden');
                        }
                    };

                    processAll = () => ctx.$$('.nsk-content-meta-info .author-info > a[href^="/space/"]').forEach(processPostItem);
                    processAll();
                    ctx.watch('.nsk-content-meta-info', processAll, { debounce: 200 });
                }

                // 列表页处理逻辑 (讨论列表)
                if (ctx.isList || location.pathname === '/' || location.pathname.startsWith('/categories') || location.pathname.startsWith('/board')) {
                    const processListItem = (itemEl) => {
                        if (itemEl.dataset.nsxRelationListProcessed) return;
                        itemEl.dataset.nsxRelationListProcessed = "1";

                        const authorEl = itemEl.querySelector('.info-author, .post-author');
                        if (!authorEl) return;
                        const username = authorEl.textContent.trim();

                        if (state.blacklist[username]) {
                            itemEl.classList.add('nsx-post-hidden');
                        }
                    };

                    processList = () => ctx.$$('.post-list-item, .post-list .list-item').forEach(processListItem);
                    processList();
                    ctx.watch('.post-list, .post-list-item', processList, { debounce: 200 });
                }
            }
        };

        if (ctx.isPost) {
            addStyle('nsx-responsive-author-actions', `
                @media (max-width:760px){
                    .nsk-content-meta-info{display:flex!important;flex-wrap:wrap!important;align-items:center!important;gap:4px 6px!important;min-width:0!important}
                    .nsk-content-meta-info>.author-info{flex:1 1 auto!important;min-width:0!important;max-width:100%!important;padding-right:0!important;margin-right:0!important}
                    .nsk-content-meta-info .author-info>a{overflow-wrap:anywhere}
                }
                .nsx-thread-branch .nsk-content-meta-info{flex-wrap:wrap!important;gap:4px 6px!important}
            `);
        }

        runModules([
            nestedComments,
            quickComment,
            commentShortcut,
            imageUpload,
            userCardExt,
            emailNavLink,
            autoJump,
            autoLoading,
            instantPage,
            smoothScroll,
            blockPosts,
            userRelation,
            floorQuickReply
        ], ctx);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start);
    } else {
        start();
    }

    // END BASELINE CORE
    }
    // Invoked only by the Userscripts branch; native GM environments skip this function.
    async function createUserscriptsAdapter(nativeGM) {
        if (nativeGM?.info?.scriptHandler !== 'Userscripts') {
            throw new Error('Userscripts 适配器仅能在 Userscripts 环境初始化');
        }
        for (const name of ['getValue', 'setValue', 'deleteValue', 'listValues']) {
            if (typeof nativeGM[name] !== 'function') throw new Error(`Userscripts 缺少 GM.${name}`);
        }
        const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
        const notice = (id, message) => {
            let node = document.getElementById(id);
            if (!node) {
                node = document.createElement('div'); node.id = id; node.setAttribute('role', 'alert');
                node.style.cssText = 'position:fixed;inset:0 0 auto;padding:10px;background:#fff3cd;color:#664d03;z-index:2147483647;font:14px sans-serif';
                document.body.append(node);
            }
            node.textContent = message;
        };
        let config = null;
        const capture = node => {
            if (node?.nodeType !== 1) return;
            const candidates = node.id === 'temp-script' ? [node] : node.querySelectorAll('#temp-script');
            for (const candidate of candidates) {
                try {
                    const bytes = Uint8Array.from(atob(candidate.textContent.trim()), char => char.charCodeAt(0));
                    const decoded = JSON.parse(new TextDecoder().decode(bytes));
                    if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) config = decoded;
                } catch { /* A streaming parser may not have inserted the full text yet. */ }
            }
        };
        capture(document.documentElement);
        const observer = new MutationObserver(records => {
            for (const record of records) {
                capture(record.target.nodeType === 1 ? record.target : record.target.parentElement);
                for (const node of [...record.addedNodes, ...record.removedNodes]) capture(node);
            }
        });
        observer.observe(document, { subtree: true, childList: true, characterData: true });
        const values = new Map(), revisions = new Map(), dirty = new Set();
        let writeTail = Promise.resolve(), syncJob = null;
        const sync = async () => {
            const before = new Map(revisions);
            const keys = await nativeGM.listValues();
            if (!Array.isArray(keys) || keys.some(key => typeof key !== 'string')) throw new Error('Userscripts 存储键格式异常');
            const known = new Set(keys);
            const unchanged = key => !dirty.has(key) && (revisions.get(key) || 0) === (before.get(key) || 0);
            for (let offset = 0; offset < keys.length; offset += 16) {
                await Promise.all(keys.slice(offset, offset + 16).map(async key => {
                    const value = await nativeGM.getValue(key);
                    if (unchanged(key)) values.set(key, clone(value));
                }));
            }
            for (const key of values.keys()) if (!known.has(key) && unchanged(key)) values.delete(key);
        };
        // Observe configuration before the first asynchronous extension round trip.
        try {
            await sync();
            if (document.readyState === 'loading') await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
            if (!config) {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 10000);
                try {
                    const response = await window.fetch(location.href.split('#')[0], { credentials: 'same-origin', signal: controller.signal });
                    if (!response.ok) throw new Error(`读取论坛配置失败：HTTP ${response.status}`);
                    const html = await response.text();
                    capture(new DOMParser().parseFromString(html, 'text/html').documentElement);
                } finally { clearTimeout(timer); }
            }
            if (!config) throw new Error('未找到论坛初始化配置，请确认页面加载正常后刷新');
        } finally { observer.disconnect(); }
        const write = (key, operation) => {
            const version = (revisions.get(key) || 0) + 1;
            revisions.set(key, version); dirty.add(key);
            const task = writeTail.then(operation);
            // Keep later writes ordered even when an earlier operation fails.
            writeTail = task.catch(() => {});
            task.then(() => {
                if (revisions.get(key) === version) dirty.delete(key);
            }, error => {
                console.error('[NSX iOS] storage write failed', error);
                notice('nsx-ios-storage-error', 'NSX：设置未能保存，请检查 Userscripts。');
            });
            return task;
        };
        const refresh = () => {
            if (!syncJob) syncJob = sync().catch(error => {
                console.error('[NSX iOS] storage refresh failed', error);
                notice('nsx-ios-storage-error', 'NSX：读取更新设置失败，暂时保留本页已有数据。');
            }).finally(() => { syncJob = null; });
            return syncJob;
        };
        window.addEventListener('focus', refresh);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
        return {
            info: nativeGM.info,
            page: { __config__: config, indexedDB: window.indexedDB },
            getValue: (key, fallback) => values.has(key) ? clone(values.get(key)) : clone(fallback),
            setValue: (key, value) => { const copy = clone(value); values.set(key, copy); return write(key, () => nativeGM.setValue(key, copy)); },
            request: details => {
                const request = nativeGM.xmlHttpRequest(details);
                Promise.resolve(request).catch(() => {}); // Original modules use the native callbacks.
                return { abort: () => request.abort?.() };
            }
        };
    }

    // Userscripts always provides GM_info as well as GM.info. Prefer the legacy
    // descriptor, when present, so other managers keep their existing GM path.
    const managerInfo = typeof GM_info === 'object' && GM_info ? GM_info :
        (typeof GM === 'object' && GM ? GM.info : undefined);
    if (managerInfo?.scriptHandler !== 'Userscripts') {
        runNodeseekPro({
            GM_info: typeof GM_info === 'object' ? GM_info : undefined,
            GM_getValue: typeof GM_getValue === 'function' ? GM_getValue : undefined,
            GM_setValue: typeof GM_setValue === 'function' ? GM_setValue : undefined,
            GM_xmlhttpRequest: typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : undefined,
            unsafeWindow: typeof unsafeWindow !== 'undefined' ? unsafeWindow : undefined
        });
        return;
    }
    // Avoid duplicate Userscripts instances in subframes, without changing how
    // existing managers interpret the original metadata.
    if (window.self !== window.top) return;
    (async () => {
        const adapter = await createUserscriptsAdapter(typeof GM === 'object' ? GM : null);
        runNodeseekPro({
            GM_info: adapter.info,
            GM_getValue: adapter.getValue, GM_setValue: adapter.setValue,
            GM_xmlhttpRequest: adapter.request, unsafeWindow: adapter.page
        });
    })().catch(error => {
        console.error('[NSX Userscripts] startup failed', error);
        const show = () => {
            if (document.getElementById('nsx-ios-startup-error')) return;
            const node = document.createElement('div'); node.id = 'nsx-ios-startup-error'; node.setAttribute('role', 'alert');
            node.textContent = 'NSX Userscripts 未能启动：' + error.message;
            node.style.cssText = 'position:fixed;inset:0 0 auto;padding:10px;background:#fff3cd;color:#664d03;z-index:2147483647;font:14px sans-serif';
            document.body.append(node);
        };
        if (document.body) show(); else document.addEventListener('DOMContentLoaded', show, { once: true });
    });
})();
