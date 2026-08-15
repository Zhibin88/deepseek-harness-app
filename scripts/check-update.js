/**
 * scripts/check-update.js
 *
 * DeepSeek Harness 桌面壳的"检查更新"提示（方案 A：提示 + 手动下载）。
 *
 * 注入方式：pake --inject scripts/external-links.js,scripts/check-update.js
 * pake 会把本文件合并进 inject/custom.js，在 DOMContentLoaded 之后执行。
 *
 * 行为：
 *  - 仅在 Tauri/Pake 环境生效。
 *  - 启动时静默调用 GitHub Releases API 拉最新 tag；与 localStorage 记录的
 *    "已知晓 tag"比对。首次运行以当前 latest 为基线、不弹提示。
 *  - 发现更新的 tag → 右上角弹一个小提示卡：[前往下载]（用 plugin:shell|open
 *    在系统默认浏览器打开 Release 页，由用户手动下载新安装包覆盖安装）+ [×] 关闭。
 *    任一操作都会把该 tag 记为"已知晓"，不再重复弹，直到下一次出现更新的 tag。
 *  - 无新版 / 网络失败 / 被 CSP 拦 → 静默，不打扰用户。
 *  - 每 6 小时在同一会话内复查一次（GitHub 未认证 API 限制 60 次/小时/IP，足够）。
 *
 * 依赖：构建前执行 scripts/patch-pake-capability.js（放行 http://*:* 调用 shell.open）。
 * 注意：GitHub API 的 releases/latest 只返回**已发布**的 Release；草稿不算。
 *       所以 CI 改为 draft 后，只有你手动 publish 的版本才会被本脚本检测到。
 */
(function () {
  "use strict";
  try {
    var tauri = window.__TAURI__;
    if (!tauri || !tauri.core || !tauri.core.invoke) return;
    var invoke = tauri.core.invoke;

    // —— 配置 ——
    var REPO = "ipfred/deepseek-harness-app"; // GitHub 仓库（owner/repo）
    var LS_KEY = "dsh_shell_update_lastSeenTag";
    var API = "https://api.github.com/repos/" + REPO + "/releases/latest";
    var RECHECK_INTERVAL = 6 * 60 * 60 * 1000; // 6 小时

    var latestTag = null;
    var latestUrl = null;
    var card = null;

    function openExternal(url) {
      invoke("plugin:shell|open", { path: url }).catch(function (err) {
        console.error("[dsh-update] 打开系统浏览器失败:", url, err);
      });
    }

    // 把当前 latestTag 记为"已知晓"并关闭卡片
    function acknowledge() {
      if (latestTag) {
        try { localStorage.setItem(LS_KEY, latestTag); } catch (_) {}
      }
      if (card) { card.remove(); card = null; }
    }

    function showCard(tag, url) {
      if (card) card.remove();
      card = document.createElement("div");
      card.style.cssText = [
        "position:fixed", "top:12px", "right:12px", "z-index:2147483646",
        "display:flex", "align-items:center", "gap:10px",
        "padding:8px 10px 8px 14px", "border-radius:8px",
        "background:rgba(30,40,55,0.94)", "color:#fff",
        "font:12px/1.5 -apple-system,'Segoe UI',Roboto,sans-serif",
        "box-shadow:0 4px 16px rgba(0,0,0,0.25)",
        "border:1px solid rgba(255,255,255,0.12)",
        "pointer-events:auto", "user-select:none",
      ].join(";");

      var txt = document.createElement("span");
      txt.textContent = "桌面壳有新版本 " + tag;

      var go = document.createElement("button");
      go.textContent = "前往下载";
      go.style.cssText =
        "padding:3px 10px;border-radius:5px;border:none;cursor:pointer;" +
        "background:#1f6feb;color:#fff;font:inherit;";
      go.onclick = function () { openExternal(url); acknowledge(); };

      var x = document.createElement("button");
      x.textContent = "×";
      x.title = "以后再说";
      x.style.cssText =
        "padding:0 6px;border:none;cursor:pointer;background:transparent;" +
        "color:rgba(255,255,255,0.7);font:16px/1 sans-serif;";
      x.onmouseover = function () { x.style.color = "#fff"; };
      x.onmouseout = function () { x.style.color = "rgba(255,255,255,0.7)"; };
      x.onclick = acknowledge;

      card.appendChild(txt);
      card.appendChild(go);
      card.appendChild(x);
      document.body.appendChild(card);
    }

    async function check() {
      try {
        var res = await fetch(API, {
          headers: { Accept: "application/vnd.github+json" },
        });
        if (!res.ok) return;
        var data = await res.json();
        if (!data || !data.tag_name) return;
        latestTag = data.tag_name;
        latestUrl = data.html_url || ("https://github.com/" + REPO + "/releases/latest");

        var lastSeen = "";
        try { lastSeen = localStorage.getItem(LS_KEY) || ""; } catch (_) {}

        if (!lastSeen) {
          // 首次运行：以当前 latest 为基线，不弹提示
          try { localStorage.setItem(LS_KEY, latestTag); } catch (_) {}
          return;
        }
        if (latestTag !== lastSeen) {
          showCard(latestTag, latestUrl);
        }
      } catch (_) {
        // 网络/CSP 失败静默
      }
    }

    function boot() {
      if (!document.body) { setTimeout(boot, 30); return; }
      check();
      setInterval(check, RECHECK_INTERVAL);
    }
    boot();
  } catch (err) {
    console.error("[dsh-update] 初始化失败:", err);
  }
})();