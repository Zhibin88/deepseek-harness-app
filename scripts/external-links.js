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
 * 说明：
 *  - pake 3.13+ 内置的 event.js 已经拦截了 <a target="_blank">、window.open、
 *    外部 <a> 点击，通过 tauri-plugin-shell 的 plugin:shell|open 在系统浏览器打开。
 *  - 本脚本做「第二层兜底」：补上 event.js 覆盖不到的 JS 直跳
 *    （location.assign / location.replace），并在内置拦截失效时兜住 <a> 与 window.open。
 *  - 已知边界：window.location.href = xxx 这类赋值无法在网页侧拦截
 *    （Location.prototype.href 在 Chromium/WebKit 中不可重定义）。
 *    若未来 dsh 出现对 location.href 的外部直跳，唯一彻底的方案是在自建
 *    src-tauri 的 Rust on_navigation 层做白名单拦截（见 README「进阶」）。
 */
(function () {
  "use strict";
  try {
    var tauri = window.__TAURI__;
    // 只在 Tauri/Pake 环境中生效；普通浏览器无需任何处理
    if (!tauri || !tauri.core || !tauri.core.invoke) return;

    var invoke = tauri.core.invoke;

    // App 内地址：本机 dsh web 服务（回环地址或与当前页同 host）。其余 http(s) 一律视为外部
    var LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]", "0.0.0.0"]);

    function isInternal(url) {
      try {
        var u = new URL(url, window.location.href);
        // 非网页协议（mailto:/tel:/data:/blob: 等）不拦
        if (u.protocol !== "http:" && u.protocol !== "https:") return true;
        if (u.hostname === window.location.hostname) return true;
        return LOOPBACK.has(u.hostname);
      } catch (_) {
        return true; // 解析失败按内部处理，避免误伤
      }
    }

    function openExternal(url) {
      invoke("plugin:shell|open", { path: url }).catch(function (err) {
        console.error("[dsh-app] 打开外部浏览器失败:", url, err);
      });
    }

    // 1) <a> 点击兜底。
    //    event.js 已处理过的外链会 preventDefault + stopImmediatePropagation，
    //    这里只会收到它漏掉的（仅作保险，防止未来 pake 版本行为变化）。
    document.addEventListener(
      "click",
      function (e) {
        if (!e.target || typeof e.target.closest !== "function") return;
        var a = e.target.closest("a");
        if (!a || !a.href || a.hasAttribute("download")) return;
        if (isInternal(a.href)) return;
        e.preventDefault();
        e.stopPropagation();
        openExternal(a.href);
      },
      true
    );

    // 2) window.open 兜底（event.js 已在前面包了一层，这里是外层，内部地址仍走原逻辑）
    var nativeOpen = window.open.bind(window);
    window.open = function (url, name, features) {
      try {
        if (url && !isInternal(url)) {
          openExternal(String(url));
          return null;
        }
      } catch (_) {
        /* fallthrough */
      }
      return nativeOpen(url, name, features);
    };

    // 3) JS 直跳兜底：location.assign / location.replace 指向外部地址时改走系统浏览器。
    //    用 defineProperty 覆盖实例方法（部分引擎对 window.location 的直接赋值静默失败）。
    ["assign", "replace"].forEach(function (method) {
      try {
        var nativeFn = window.location[method];
        if (typeof nativeFn !== "function") return;
        var override = function (url) {
          try {
            if (url && !isInternal(url)) {
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