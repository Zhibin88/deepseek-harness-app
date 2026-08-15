#!/usr/bin/env node
/**
 * scripts/patch-pake-capability.js
 *
 * Pake 打包 DeepSeek Harness 前的一次性前置补丁。
 *
 * 背景：Tauri v2 的 shell:allow-open 权限自带 URL scope，默认只允许
 *   [webviews: "pake", URL: local] 与 [webviews: "pake", URL: https://*.*]
 * 调用 shell.open。而我们的 App 页面是 http://127.0.0.1:3080（http 明文本地服务），
 * 不在 scope 内 → invoke("plugin:shell|open") 会被拒，外链打不开系统浏览器。
 *
 * 解法：在 pake build 之前，把 pake-cli 模板里的 capabilities/default.json
 * 的 remote.urls 扩展为 ["https://*.*", "http://*:*"]，让 http 本地服务页面
 * 也能调用 shell.open。pake 随后用这份改过的 capability 编译进安装包。
 *
 * 用法：node scripts/patch-pake-capability.js
 *   （幂等：可重复执行；已包含 http://*:* 则跳过）
 *
 * 探测 pake-cli 位置顺序：
 *   1. 工作区 node_modules/pake-cli（CI / 项目内安装）
 *   2. require.resolve("pake-cli/package.json")
 *   3. 从 `pake` 命令 shim 反推（全局安装）
 *   4. 常见全局路径兜底
 */
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const REQUIRED_URL = "http://*:*";

function tryResolvePakeRoot() {
  const candidates = [];

  // 1) 工作区 node_modules/pake-cli
  candidates.push(path.join(process.cwd(), "node_modules", "pake-cli"));

  // 2) require.resolve
  try {
    const pkg = require.resolve("pake-cli/package.json");
    candidates.push(path.dirname(pkg));
  } catch (_) {}

  // 3) 从 pake 命令 shim 反推（跨平台）
  try {
    const which = process.platform === "win32"
      ? execSync('where pake', { encoding: "utf8" }).trim().split(/\r?\n/)[0]
      : execSync('which pake', { encoding: "utf8" }).trim();
    if (which) {
      // shim 内容里通常含 new_node_path 指向 .../pake-cli/node_modules
      const shimText = fs.readFileSync(which, "utf8");
      const m = shimText.match(/pake-cli@[^\n]*node_modules(?!.*node_modules)/);
      // 直接按 shim 同目录向上找 pake-cli
      let dir = path.dirname(which);
      for (let i = 0; i < 6; i++) {
        candidates.push(path.join(dir, "node_modules", "pake-cli"));
        candidates.push(path.join(dir, "pake-cli"));
        // 还要处理 pnpm store 结构：.pnpm/pake-cli@x.x.x/node_modules/pake-cli
        const pn = path.join(dir, ".pnpm");
        if (fs.existsSync(pn)) {
          for (const name of fs.readdirSync(pn)) {
            if (name.startsWith("pake-cli@")) {
              candidates.push(path.join(pn, name, "node_modules", "pake-cli"));
            }
          }
        }
        dir = path.dirname(dir);
      }
    }
  } catch (_) {}

  // 4) 常见全局路径兜底
  if (process.platform === "win32") {
    candidates.push(path.join(os.homedir(), "AppData", "Roaming", "npm", "node_modules", "pake-cli"));
    // pnpm global store
    for (const drive of ["D:", "C:", "E:"]) {
      candidates.push(path.join(drive, "pnpm_glb_store", "global", "5", ".pnpm"));
    }
  } else {
    candidates.push("/usr/local/lib/node_modules/pake-cli");
    candidates.push("/usr/lib/node_modules/pake-cli");
  }

  // 验证候选：必须存在 capabilities/default.json
  for (const c of candidates) {
    if (!c) continue;
    const cap = path.join(c, "src-tauri", "capabilities", "default.json");
    if (fs.existsSync(cap)) {
      // 若 c 本身就是 .pnpm 目录（含多个 pake-cli@x），挑第一个
      return { pakeRoot: c, capPath: cap };
    }
    // 若 c 指向 .pnpm 目录，枚举里面的 pake-cli@x
    if (fs.existsSync(c) && fs.statSync(c).isDirectory()) {
      const base = c.endsWith(".pnpm") ? c : path.join(c, ".pnpm");
      if (fs.existsSync(base)) {
        for (const name of fs.readdirSync(base)) {
          if (name.startsWith("pake-cli@")) {
            const cap2 = path.join(base, name, "node_modules", "pake-cli", "src-tauri", "capabilities", "default.json");
            if (fs.existsSync(cap2)) {
              return { pakeRoot: path.join(base, name, "node_modules", "pake-cli"), capPath: cap2 };
            }
          }
        }
      }
    }
  }
  return null;
}

function main() {
  const found = tryResolvePakeRoot();
  if (!found) {
    console.error("[patch-capability] 未找到 pake-cli 的 capabilities/default.json");
    console.error("  请确认 pake-cli 已安装；若装在非标准位置，可手动修改其");
    console.error("  src-tauri/capabilities/default.json，在 remote.urls 加 \"http://*:*\"。");
    process.exit(1);
  }

  const { pakeRoot, capPath } = found;
  console.log("[patch-capability] pake-cli:", pakeRoot);
  console.log("[patch-capability] capability:", capPath);

  const raw = fs.readFileSync(capPath, "utf8");
  const cap = JSON.parse(raw);

  if (!cap.remote || !Array.isArray(cap.remote.urls)) {
    cap.remote = cap.remote || {};
    cap.remote.urls = cap.remote.urls || [];
  }

  if (cap.remote.urls.includes(REQUIRED_URL)) {
    console.log("[patch-capability] 已包含 \"http://*:*\"，无需修改（幂等跳过）。");
    return;
  }

  cap.remote.urls.push(REQUIRED_URL);
  // 保持 https 在前
  cap.remote.urls.sort((a) => (a.startsWith("https") ? -1 : 1));

  const out = JSON.stringify(cap, null, 2) + "\n";
  fs.writeFileSync(capPath, out, "utf8");
  console.log("[patch-capability] 已写入，remote.urls =", JSON.stringify(cap.remote.urls));
}

main();