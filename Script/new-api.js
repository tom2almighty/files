/******************************
脚本功能：通用签到（适配所有 NewAPI 源码搭建的中转站）
适用环境：Surge iOS / macOS (Module Mode)
更新时间：2026-05-28
模块入口：new-api.sgmodule

使用说明：
1. 在 Surge 中安装 new-api.sgmodule，开启 MITM 与对应 hostname。
2. 在浏览器中打开任意 NewAPI 站点个人中心一次（自动触发 /api/user/self），
   脚本会拦截并保存所需请求头（按 域名 + new-api-user 隔离）。
3. 之后由 cron 任务自动签到，多站点、多账户均会依次执行。

可在 sgmodule 中通过 #!arguments 配置：
- cron_expr / notify_success / notify_skipped / host_filter
*******************************/

const HEADER_KEY_PREFIX = "UniversalCheckin_Headers";
const HOSTS_LIST_KEY = "UniversalCheckin_HostsList";
const FAILED_KEY_PREFIX = "UniversalCheckin_Failed";
const isGetHeader = typeof $request !== "undefined";

const NEED_KEYS = [
  "Host",
  "User-Agent",
  "Accept",
  "Accept-Language",
  "Accept-Encoding",
  "Origin",
  "Referer",
  "Cookie",
  "new-api-user",
];

function parseArgs(str) {
  const out = {};
  if (!str) return out;
  for (const part of String(str).split("&")) {
    const seg = part.trim();
    if (!seg) continue;
    const idx = seg.indexOf("=");
    if (idx === -1) {
      out[decodeURIComponent(seg)] = "";
    } else {
      out[decodeURIComponent(seg.slice(0, idx))] = decodeURIComponent(seg.slice(idx + 1));
    }
  }
  return out;
}

function parseBool(v, defaultVal = false) {
  if (v === undefined || v === null || v === "") return defaultVal;
  const s = String(v).toLowerCase().trim();
  return s === "true" || s === "1" || s === "yes" || s === "on";
}

const args = parseArgs(typeof $argument !== "undefined" ? $argument : "");
const NOTIFY_SUCCESS = parseBool(args.notify_success, true);
const NOTIFY_SKIPPED = parseBool(args.notify_skipped, false);
const HOST_FILTER = (args.host_filter || "").trim();

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch (_) {
    return null;
  }
}

function notify(title, subtitle, body) {
  $notification.post(title, subtitle, body);
}

function storeRead(key) {
  return $persistentStore.read(key);
}

function storeWrite(value, key) {
  return $persistentStore.write(value, key);
}

function storeClear(key) {
  return $persistentStore.write("", key);
}

function getSavedHosts() {
  try {
    const raw = storeRead(HOSTS_LIST_KEY);
    if (!raw) return [];
    const hosts = safeJsonParse(raw) || [];
    return Array.isArray(hosts) ? hosts.filter(h => h && typeof h === "string") : [];
  } catch (e) {
    console.log("[NewAPI] Error reading saved hosts:", e);
    return [];
  }
}

function addHostToList(host) {
  try {
    const hosts = getSavedHosts();
    if (!hosts.includes(host)) {
      hosts.push(host);
      storeWrite(JSON.stringify(hosts), HOSTS_LIST_KEY);
      console.log("[NewAPI] Updated hosts list:", hosts.join(", "));
    }
  } catch (e) {
    console.log("[NewAPI] Error adding host to list:", e);
  }
}

function addAccountToHost(host, account) {
  try {
    if (!account || !account.trim()) return;
    const key = `${HEADER_KEY_PREFIX}:Accounts:${host}`;
    const raw = storeRead(key);
    const accounts = safeJsonParse(raw) || [];
    if (!accounts.includes(account)) {
      accounts.push(account);
      storeWrite(JSON.stringify(accounts), key);
      console.log(`[NewAPI] Account added to ${host}:`, account);
    }
  } catch (e) {
    console.log("[NewAPI] Error adding account:", e);
  }
}

function getAccountsForHost(host) {
  try {
    const key = `${HEADER_KEY_PREFIX}:Accounts:${host}`;
    const raw = storeRead(key);
    const accounts = safeJsonParse(raw) || [];
    return accounts.length > 0 ? accounts : [""];
  } catch (e) {
    console.log("[NewAPI] Error reading accounts:", e);
    return [""];
  }
}

function isAccountFailed(host, account) {
  try {
    const v = storeRead(`${FAILED_KEY_PREFIX}:${host}:${account}`);
    return v === "true";
  } catch (e) {
    return false;
  }
}

function markAccountFailed(host, account) {
  try {
    storeWrite("true", `${FAILED_KEY_PREFIX}:${host}:${account}`);
    console.log(`[NewAPI] Marked ${notifyTitleForHost(host, account)} as failed`);
  } catch (e) {
    console.log("[NewAPI] Error marking account failed:", e);
  }
}

function clearAccountFailed(host, account) {
  try {
    storeClear(`${FAILED_KEY_PREFIX}:${host}:${account}`);
    console.log(`[NewAPI] Cleared failed status for ${notifyTitleForHost(host, account)}`);
  } catch (e) {
    console.log("[NewAPI] Error clearing failed status:", e);
  }
}

function pickNeedHeaders(src = {}) {
  const dst = {};
  const lower = {};
  for (const k of Object.keys(src || {})) lower[k.toLowerCase()] = src[k];
  const get = name => src[name] ?? lower[name.toLowerCase()];
  for (const k of NEED_KEYS) {
    const v = get(k);
    if (v !== undefined) dst[k] = v;
  }
  return dst;
}

function headerKeyForHost(host, account) {
  if (account && account.trim()) return `${HEADER_KEY_PREFIX}:${host}:${account}`;
  return `${HEADER_KEY_PREFIX}:${host}`;
}

function getHostFromRequest() {
  const h = ($request && $request.headers) || {};
  const host = h.Host || h.host;
  if (host) return String(host).trim();
  try {
    return new URL($request.url).hostname;
  } catch (_) {
    return "";
  }
}

function originFromHost(host) { return `https://${host}`; }
function refererFromHost(host) { return `https://${host}/console/personal`; }

function notifyTitleForHost(host, account) {
  let siteName = host;
  try {
    let name = host.replace(/^www\./, "");
    const parts = name.split(".");
    name = parts[0].trim() || parts[1] || host;
    name = name
      .replace(/[-_]api$/i, "")
      .replace(/[-_]service$/i, "")
      .replace(/[-_]app$/i, "")
      .replace(/^api[-_]/i, "");
    siteName = name.toUpperCase() || host.toUpperCase();
  } catch (_) {}
  return account && account.trim() ? `${siteName}(${account})` : siteName;
}

function httpRequest(opts) {
  return new Promise((resolve, reject) => {
    const method = (opts.method || "GET").toLowerCase();
    const fn = $httpClient[method];
    if (typeof fn !== "function") {
      reject({ error: `Unsupported method: ${opts.method}` });
      return;
    }
    fn(opts, (error, response, body) => {
      if (error) {
        reject({ error });
      } else {
        resolve({
          statusCode: response.status,
          headers: response.headers,
          body: body || "",
        });
      }
    });
  });
}

if (isGetHeader) {
  const allHeaders = $request.headers || {};
  const host = getHostFromRequest();
  const picked = pickNeedHeaders(allHeaders);

  if (!host || !picked || !picked.Cookie || !picked["new-api-user"]) {
    console.log("[NewAPI] header capture failed:", JSON.stringify(allHeaders));
    notify(
      "通用签到",
      "未抓到关键信息",
      "请在触发 /api/user/self 请求时抓包（需要包含 Cookie 和 new-api-user）。"
    );
    $done({});
  } else {
    const account = (picked["new-api-user"] || "").trim();
    const key = headerKeyForHost(host, account);
    const ok = storeWrite(JSON.stringify(picked), key);

    const title = notifyTitleForHost(host, account);
    if (ok) {
      addHostToList(host);
      if (account) addAccountToHost(host, account);
      clearAccountFailed(host, account);
      notify(`${title} 参数获取成功`, "失败标记已清除", "");
    } else {
      notify(`${title} 参数保存失败`, "", "");
    }
    $done({});
  }
} else {
  const hostsToRun = HOST_FILTER ? [HOST_FILTER] : getSavedHosts();

  if (hostsToRun.length === 0) {
    console.log("[NewAPI] No saved hosts found. Please capture /api/user/self first.");
    notify("通用签到", "无可用站点", "请先访问任意 NewAPI 站点个人中心抓包保存请求头。");
    $done();
  } else {
    const doCheckin = async (host, account = "") => {
      if (isAccountFailed(host, account)) {
        const title = notifyTitleForHost(host, account);
        console.log(`[NewAPI] ${title} 已标记失败，跳过执行`);
        if (NOTIFY_SKIPPED) {
          notify(title, "已跳过", "账户已标记登录失效，请重新抓包以恢复");
        }
        return;
      }

      const key = headerKeyForHost(host, account);
      const raw = storeRead(key);
      if (!raw) {
        notify(notifyTitleForHost(host, account), "缺少参数", "请先抓包保存一次 /api/user/self 的请求头。");
        return;
      }

      const savedHeaders = safeJsonParse(raw);
      if (!savedHeaders) {
        notify(notifyTitleForHost(host, account), "参数异常", "已保存的请求头解析失败，请重新抓包保存。");
        return;
      }

      const headers = {
        Host: savedHeaders.Host || host,
        Accept: savedHeaders.Accept || "application/json, text/plain, */*",
        "Accept-Language": savedHeaders["Accept-Language"] || "zh-CN,zh-Hans;q=0.9",
        "Accept-Encoding": savedHeaders["Accept-Encoding"] || "gzip, deflate, br",
        Origin: savedHeaders.Origin || originFromHost(host),
        Referer: savedHeaders.Referer || refererFromHost(host),
        "User-Agent": savedHeaders["User-Agent"] || "Surge",
        Cookie: savedHeaders.Cookie || "",
        "new-api-user": savedHeaders["new-api-user"] || "",
      };

      const title = notifyTitleForHost(host, account);

      try {
        const resp = await httpRequest({
          url: `https://${host}/api/user/checkin`,
          method: "POST",
          headers,
          body: "",
          timeout: 30,
        });

        const status = resp.statusCode;
        const body = resp.body || "";
        const obj = safeJsonParse(body) || {};
        const success = Boolean(obj.success);
        const message = obj.message ? String(obj.message) : "";
        const checkinDate = obj?.data?.checkin_date ? String(obj.data.checkin_date) : "";
        const quotaAwarded = obj?.data?.quota_awarded !== undefined ? String(obj.data.quota_awarded) : "";

        if (status === 401 || status === 403) {
          markAccountFailed(host, account);
          notify(title, "登录失效 ✗", "已停止执行，请重新抓包保存 Cookie");
        } else if (status >= 200 && status < 300) {
          clearAccountFailed(host, account);
          if (success) {
            if (NOTIFY_SUCCESS) {
              let content = checkinDate ? `日期：${checkinDate}` : "签到成功";
              if (quotaAwarded) content += `\n获得：${quotaAwarded}`;
              notify(title, "✓ 签到成功", content);
            }
          } else if (NOTIFY_SUCCESS) {
            notify(title, "签到信息", message || body);
          }
        } else {
          notify(title, `接口异常 ${status}`, message || body);
        }
      } catch (reason) {
        const err = reason?.error ? String(reason.error) : String(reason || "");
        console.log(`[NewAPI] ${title} | 网络错误 | ${err}`);
        notify(title, "✗ 网络错误", err);
      }
    };

    (async () => {
      for (const h of hostsToRun) {
        const accounts = getAccountsForHost(h);
        for (const acc of accounts) {
          await doCheckin(h, acc);
        }
      }
      $done();
    })();
  }
}
