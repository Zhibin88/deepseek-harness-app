/**
 * scripts/external-links.js
 *
 * DeepSeek Harness 桌面 App（Pake/Tauri 壳）专用：
 * 保证页面里任何「跳转到外部网页」的动作都交给系统默认浏览器，
 * 绝不在 App 窗口内打开、把当前界面覆盖掉。
 *
 * 注入方式：pake --inject scripts/external-links.js
 * pake 会把本文件合并进它内置模板的 inject/custom.js，
 * 并在 DOMContentLoaded 之后执行（晚于 pake 内置的 event.js）。
 *
 * 行为规则：
 *  - 与当前页同源（http://127.0.0.1:3080 及其路由）→ 留在 App 窗口内（dsh 自身页面必需）。
 *  - 其余任何 http(s) 地址（含其他本地端口，如 127.0.0.1:5173、localhost:xxxx，以及外网）
 *    → 一律交给系统默认浏览器。
 *  - 非 http(s) 协议（mailto:/tel:/data:/blob: 等）保持浏览器默认行为，不拦截。
 *
 * 三层拦截：
 *  1) <a> 点击（capture 兜底；pake 内置 event.js 先跑，外链已被它处理并 stopImmediatePropagation，
 *     本层主要兜住 event.js 漏掉的情况，例如 pake 默认把同-host 不同-port 的本地链接判为
 *     "内部"从而只在窗口内导航的情形）。
 *  2) window.open（event.js 已包一层；本层为外层兜底）。
 *  3) location.assign / location.replace（event.js 不覆盖，本层补上）。
 *
 * 前置依赖：构建前须执行 scripts/patch-pake-capability.js，把 pake 模板的
 * capabilities/default.json 的 remote.urls 放行 http://*:*，否则 Tauri v2 的
 * shell:allow-open 会拒绝从 http://127.0.0.1:3080 页面发起的 shell.open 调用。
 *
 * 已知边界：window.location.href = xxx 这类赋值无法在网页侧拦截（Location.prototype.href
 * 在 Chromium/WebKit 中不可重定义）。若未来 dsh 出现对 location.href 的外部直跳，
 * 彻底方案是在自建 src-tauri 的 Rust on_navigation 层做白名单拦截（见 README「进阶」）。
 */
(function () {
  "use strict";
  try {
    var tauri = window.__TAURI__;
    // 只在 Tauri/Pake 环境中生效；普通浏览器无需任何处理
    if (!tauri || !tauri.core || !tauri.core.invoke) return;

    var invoke = tauri.core.invoke;

    // 是否应交给系统默认浏览器：
    //  - 非 http(s) 协议不拦；
    //  - http(s) 且与主入口不同源 → 外部浏览器（含其他本地端口，如 127.0.0.1:5173）。
    function shouldOpenExternally(url) {
      try {
        var u = new URL(url, window.location.href);
        if (u.protocol !== "http:" && u.protocol !== "https:") return false;
        return u.origin !== window.location.origin;
      } catch (_) {
        return false; // 解析失败不拦，避免误伤
      }
    }

    function openExternal(url) {
      invoke("plugin:shell|open", { path: url }).catch(function (err) {
        console.error("[dsh-app] 打开外部浏览器失败:", url, err);
      });
    }

    // 1) <a> 点击兜底
    document.addEventListener(
      "click",
      function (e) {
        if (!e.target || typeof e.target.closest !== "function") return;
        var a = e.target.closest("a");
        if (!a || !a.href || a.hasAttribute("download")) return;
        if (!shouldOpenExternally(a.href)) return;
        e.preventDefault();
        e.stopPropagation();
        openExternal(a.href);
      },
      true
    );

    // 2) window.open 兜底
    var nativeOpen = window.open.bind(window);
    window.open = function (url, name, features) {
      try {
        if (url && shouldOpenExternally(url)) {
          openExternal(String(url));
          return null;
        }
      } catch (_) {
        /* fallthrough */
      }
      return nativeOpen(url, name, features);
    };

    // 3) location.assign / location.replace 直跳兜底
    ["assign", "replace"].forEach(function (method) {
      try {
        var nativeFn = window.location[method];
        if (typeof nativeFn !== "function") return;
        var override = function (url) {
          try {
            if (url && shouldOpenExternally(url)) {
              openExternal(String(url));
              return;
            }
          } catch (_) {
            /* fallthrough */
          }
          return nativeFn.call(window.location, url);
        };
        try {
          window.location[method] = override;
        } catch (_) {
          Object.defineProperty(window.location, method, {
            value: override,
            configurable: true,
            writable: true,
          });
        }
      } catch (_) {
        /* ignore */
      }
    });
  } catch (err) {
    console.error("[dsh-app] external-links.js 初始化失败:", err);
  }
})();