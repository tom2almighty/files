/******************************
脚本功能：NS 论坛签到 (Surge 模块版)
适用环境：Surge iOS / macOS (Module Mode)
更新时间：2026-05-28
模块入口：nodeseek.sgmodule

使用说明：
1. 在 Surge 中安装 nodeseek.sgmodule，开启 MITM 并将 www.nodeseek.com 加入 hostname。
2. 在浏览器中打开 NodeSeek 个人页面一次（触发 /api/account/getInfo/{uid}?readme=1），
   脚本会自动拦截并保存签到所需请求头（含 refract-sign / refract-key 等防风控字段）。
3. 之后由 cron 任务自动签到。

可在 sgmodule 中通过 #!arguments 配置：
- cron_expr / notify_success
*******************************/

const NS_HEADER_KEY = "NS_NodeseekHeaders";
const isGetHeader = typeof $request !== "undefined";

const NEED_KEYS = [
  "Connection",
  "Accept-Encoding",
  "Priority",
  "Content-Type",
  "Origin",
  "refract-sign",
  "User-Agent",
  "refract-key",
  "Sec-Fetch-Mode",
  "Cookie",
  "Host",
  "Referer",
  "Accept-Language",
  "Accept",
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

function pickNeedHeaders(src = {}) {
  const dst = {};
  const get = name => src[name] ?? src[name.toLowerCase()] ?? src[name.toUpperCase()];
  for (const k of NEED_KEYS) {
    const v = get(k);
    if (v !== undefined) dst[k] = v;
  }
  return dst;
}

function safeJsonParse(text) {
  try {
    return [JSON.parse(text), null];
  } catch (e) {
    return [null, e];
  }
}

function notify(title, subtitle, body) {
  $notification.post(title, subtitle, body);
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
  const picked = pickNeedHeaders(allHeaders);

  if (!picked || Object.keys(picked).length === 0) {
    console.log("[NS] picked headers empty:", JSON.stringify(allHeaders));
    notify("NS Headers 获取失败", "", "未获取到指定请求头，请重新再试一次。");
    $done({});
  } else {
    const ok = $persistentStore.write(JSON.stringify(picked), NS_HEADER_KEY);
    console.log("[NS] saved picked headers:", JSON.stringify(picked));
    notify(
      ok ? "NS Headers 获取成功" : "NS Headers 保存失败",
      "",
      ok ? "指定请求头已持久化保存。" : "写入持久化存储失败，请检查配置。"
    );
    $done({});
  }
} else {
  const raw = $persistentStore.read(NS_HEADER_KEY);
  if (!raw) {
    notify("NS签到结果", "无法签到", "本地没有已保存的请求头，请先抓包访问一次个人页面。");
    $done();
  } else {
    const [savedHeaders, parseErr] = safeJsonParse(raw);
    if (parseErr || !savedHeaders) {
      console.log("[NS] parse saved headers failed:", parseErr);
      notify("NS签到结果", "无法签到", "本地保存的请求头数据损坏，请重新访问一次个人页面。");
      $done();
    } else {
      const headers = {
        Connection: savedHeaders["Connection"] || "keep-alive",
        "Accept-Encoding": savedHeaders["Accept-Encoding"] || "gzip, deflate, br",
        Priority: savedHeaders["Priority"] || "u=3, i",
        "Content-Type": savedHeaders["Content-Type"] || "text/plain;charset=UTF-8",
        Origin: savedHeaders["Origin"] || "https://www.nodeseek.com",
        "refract-sign": savedHeaders["refract-sign"] || "",
        "User-Agent":
          savedHeaders["User-Agent"] ||
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7.2 Mobile/15E148 Safari/604.1",
        "refract-key": savedHeaders["refract-key"] || "",
        "Sec-Fetch-Mode": savedHeaders["Sec-Fetch-Mode"] || "cors",
        Cookie: savedHeaders["Cookie"] || "",
        Host: savedHeaders["Host"] || "www.nodeseek.com",
        Referer: savedHeaders["Referer"] || "https://www.nodeseek.com/sw.js?v=0.3.33",
        "Accept-Language": savedHeaders["Accept-Language"] || "zh-CN,zh-Hans;q=0.9",
        Accept: savedHeaders["Accept"] || "*/*",
      };

      (async () => {
        try {
          const resp = await httpRequest({
            url: "https://www.nodeseek.com/api/attendance?random=true",
            method: "POST",
            headers,
            body: "",
            timeout: 30,
          });

          const status = resp.statusCode;
          const body = resp.body || "";
          const [obj, parseE] = safeJsonParse(body);
          const msg = !parseE && obj?.message ? String(obj.message) : "";
          console.log(`[NS签到] status=${status}, message=${msg || "(empty)"}`);

          if (status === 403) {
            const content = `暂时被风控，稍后再试\n${msg ? `内容：${msg}` : `响应体：${body}`}`;
            notify("NS签到结果", "403 风控", content);
          } else if (status === 500) {
            notify("NS签到结果", "500 服务器错误", msg || body || "服务器错误(500)，无返回内容");
          } else if (status >= 200 && status < 300) {
            if (NOTIFY_SUCCESS) {
              notify("NS签到结果", "签到成功", msg || "NS签到成功，但未返回 message");
            }
          } else {
            notify("NS签到结果", `请求异常 ${status}`, msg || body || `请求失败，status=${status}`);
          }
        } catch (reason) {
          const err = reason?.error ? String(reason.error) : String(reason || "");
          console.log(`[NS签到] request error: ${err}`);
          notify("NS签到结果", "请求错误", err);
        }
        $done();
      })();
    }
  }
}
