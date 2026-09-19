/**
 * scripts/auth-token.js
 *
 * DeepSeek Harness 桌面 App（Pake/Tauri 壳）专用：dsh web 浏览器认证（auth token）引导层。
 *
 * 注入方式：pake --inject scripts/external-links.js,scripts/check-update.js,scripts/auth-token.js
 * pake 会把本文件合并进内置模板的 inject/custom.js，并包成
 * `window.addEventListener('DOMContentLoaded', …)` 后作为 webview 初始化脚本注入。
 * 初始化脚本对每个文档都会执行（与 HTTP 状态码无关），所以 401 响应页同样会加载本文件。
 *
 * 为什么需要它：
 *  - dsh web 每个进程生成一个随机「启动令牌」（launch token，32 字节随机数的 base64url），
 *    只存在于进程内存和启动时打印的链接里，不落盘、每次重启都换
 *    → 没法在打包时把 token 写死进 App 的首页 URL。
 *  - 未认证时 GET / 返回 401 纯文本："dsh web authentication required; reopen the URL
 *    printed by dsh web."
 *  - 只有 GET /?token=<launch token> 才会种下绑定 host:port、有效期 30 天的 HttpOnly
 *    签名 cookie，并 303 重定向回干净的 /；此后 30 天内免 token。
 *    cookie 密钥持久化在 $DSH_HOME/.credentials.yaml（client-connection/browser-session）,
 *    删除该记录、cookie 过期或被清除，才会重新要求认证。
 *
 * 行为：
 *  - 仅在 Tauri/Pake 环境生效（普通浏览器不受影响）。
 *  - 命中 401 未认证页 → 渲染覆盖层：粘贴 dsh web 打印的带 token 链接（或裸 token），
 *    提交后跳转 /?token=... 换取 cookie。
 *  - 刚提交过却仍是 401 → 提示 token 无效或已过期（dsh web 重启后 token 会变）。
 *  - 已认证页面、服务未启动的错误页 → 不做任何事。
 */
(function () {
  "use strict";
  try {
    var tauri = window.__TAURI__;
    if (!tauri || !tauri.core || !tauri.core.invoke) return;

    // 401 响应体里的稳定特征串
    var AUTH_REQUIRED_MARKER = "dsh web authentication required";
    // 提交后若又回到 401，说明 token 无效；标记只在短时间内有效
    var RETRY_KEY = "dsh_shell_auth_retry";
    var RETRY_WINDOW_MS = 120 * 1000;
    var OVERLAY_ID = "dsh-auth-overlay";

    // —— 判定当前文档是不是 dsh 的 401 未认证页 ——
    function isUnauthenticatedPage() {
      try {
        var body = document.body;
        var text = body && body.textContent ? body.textContent : "";
        if (text.indexOf(AUTH_REQUIRED_MARKER) !== -1) return true;
        // 兜底：有些 webview 渲染纯文本响应时读取 textContent 不稳定，
        // 退回看文档类型；限定根路径避免误伤其它纯文本页面。
        var ct = String(document.contentType || "").toLowerCase();
        return ct.indexOf("text/plain") === 0 && window.location.pathname === "/";
      } catch (_) {
        return false;
      }
    }

    // 读取并清除「上次提交过」标记
    function consumeRetryFlag() {
      try {
        var raw = sessionStorage.getItem(RETRY_KEY);
        if (!raw) return false;
        sessionStorage.removeItem(RETRY_KEY);
        var at = Number(raw);
        return isFinite(at) && Date.now() - at < RETRY_WINDOW_MS;
      } catch (_) {
        return false;
      }
    }

    function markRetry() {
      try {
        sessionStorage.setItem(RETRY_KEY, String(Date.now()));
      } catch (_) {}
    }

    // —— 从用户粘贴的内容里提取 token ——
    // 接受：完整链接（含 ?token=...）、"?token=xxx"、终端里整行输出、裸 token
    function parseToken(input) {
      var raw = String(input || "")
        .trim()
        .replace(/^[\s"'`<>]+|[\s"'`<>]+$/g, "");
      if (!raw) return "";

      // 完整 URL
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
        try {
          var fromUrl = new URL(raw).searchParams.get("token");
          if (fromUrl) return fromUrl.trim();
        } catch (_) {}
      }

      // 终端里带前后文的一整行，或 "?token=xxx"
      var m = raw.match(/(?:^|[?&\s])token=([A-Za-z0-9_\-%.]+)/i);
      if (m) {
        try {
          return decodeURIComponent(m[1]);
        } catch (_) {
          return m[1];
        }
      }

      // 裸 token（base64url，实测 43 字符；放宽到 >=16 以避免误判普通单词）
      if (/^[A-Za-z0-9_\-]{16,}$/.test(raw)) return raw;

      return "";
    }

    function el(tag, css, text) {
      var node = document.createElement(tag);
      if (css) node.style.cssText = css;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    function showAuthUI(invalidAttempt) {
      if (document.getElementById(OVERLAY_ID)) return;

      var overlay = el(
        "div",
        [
          "position:fixed", "inset:0", "z-index:2147483647",
          "display:flex", "align-items:center", "justify-content:center",
          "padding:24px", "background:#0f1720",
          "font:13px/1.6 -apple-system,'Segoe UI',Roboto,'Helvetica Neue',sans-serif",
        ].join(";")
      );
      overlay.id = OVERLAY_ID;

      var card = el(
        "div",
        [
          "width:100%", "max-width:540px", "box-sizing:border-box",
          "background:#fff", "color:#1f2937",
          "border-radius:12px", "padding:26px 26px 20px",
          "box-shadow:0 18px 48px rgba(0,0,0,0.45)",
        ].join(";")
      );

      card.appendChild(el("div", "font-size:17px;font-weight:600;margin:0 0 10px", "需要认证后才能进入 DeepSeek Harness"));

      var desc = el("div", "font-size:13px;line-height:1.75;color:#4b5563;margin:0 0 16px");
      desc.appendChild(document.createTextNode("dsh web 已启用浏览器认证。请在运行 "));
      desc.appendChild(el("code", "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;background:#f3f4f6;padding:1px 5px;border-radius:4px", "dsh web"));
      desc.appendChild(document.createTextNode(" 的终端里，复制它启动时打印的那条链接（形如 "));
      desc.appendChild(el("code", "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;background:#f3f4f6;padding:1px 5px;border-radius:4px", "http://127.0.0.1:3080/?token=…"));
      desc.appendChild(document.createTextNode("），粘贴到下面。"));
      card.appendChild(desc);

      var input = el(
        "input",
        [
          "width:100%", "box-sizing:border-box", "padding:9px 11px",
          "font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
          "color:#111827", "background:#fff",
          "border:1px solid #d1d5db", "border-radius:8px", "outline:none",
        ].join(";")
      );
      input.type = "text";
      input.placeholder = "粘贴带 token 的链接，或只粘贴 token";
      input.spellcheck = false;
      input.autocomplete = "off";
      input.autocapitalize = "off";
      input.addEventListener("focus", function () {
        input.style.borderColor = "#2563eb";
        input.style.boxShadow = "0 0 0 3px rgba(37,99,235,0.15)";
      });
      input.addEventListener("blur", function () {
        input.style.borderColor = "#d1d5db";
        input.style.boxShadow = "none";
      });
      card.appendChild(input);

      var error = el("div", "margin-top:10px;font-size:12px;line-height:1.6;color:#b91c1c;display:none");
      card.appendChild(error);

      function showError(message) {
        error.textContent = message;
        error.style.display = "block";
      }

      var submit = el(
        "button",
        [
          "margin-top:12px", "width:100%", "padding:9px 14px",
          "font:600 13px/1.4 inherit", "color:#fff", "background:#2563eb",
          "border:none", "border-radius:8px", "cursor:pointer",
        ].join(";"),
        "认证并进入"
      );
      submit.type = "button";

      function doSubmit() {
        var token = parseToken(input.value);
        if (!token) {
          showError("没识别到 token。请粘贴 dsh web 启动时打印的完整链接（含 ?token=…）。");
          input.focus();
          return;
        }
        submit.disabled = true;
        submit.textContent = "正在认证…";
        markRetry();
        window.location.replace(
          window.location.origin + "/?token=" + encodeURIComponent(token)
        );
      }

      submit.addEventListener("click", doSubmit);
      input.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          doSubmit();
        }
      });
      card.appendChild(submit);

      if (invalidAttempt) {
        showError("上次用的 token 无效或已过期（dsh web 重启后 token 会变）。请复制最新打印的链接重试。");
      }

      var note = el(
        "div",
        "margin-top:14px;padding-top:12px;border-top:1px solid #eef0f3;font-size:12px;line-height:1.7;color:#6b7280"
      );
      note.appendChild(document.createTextNode("认证成功后本机将记住 "));
      note.appendChild(el("b", "color:#4b5563", "30 天"));
      note.appendChild(document.createTextNode("，期间打开 App 无需再次输入。dsh web 需先在本机启动。"));
      card.appendChild(note);

      overlay.appendChild(card);

      // 401 页面是纯文本，清掉原始内容让界面干净
      var body = document.body;
      if (body) {
        while (body.firstChild) body.removeChild(body.firstChild);
        body.style.margin = "0";
        body.style.background = "#0f1720";
        body.appendChild(overlay);
      } else {
        document.documentElement.appendChild(overlay);
      }

      input.focus();
    }

    function boot() {
      if (!document.body) {
        setTimeout(boot, 30);
        return;
      }
      if (!isUnauthenticatedPage()) return;
      showAuthUI(consumeRetryFlag());
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot);
    } else {
      boot();
    }
  } catch (err) {
    console.error("[dsh-auth] 初始化失败:", err);
  }
})();