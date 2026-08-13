# DeepSeek Harness Desktop

把 DeepSeek Harness 网页端（`dsh web`，http://127.0.0.1:3080）用 [Pake](https://github.com/tw93/Pake)（Rust/Tauri）打包成 Windows / macOS / Linux 三平台桌面 App，并用 GitHub Actions 自动构建、发布到 GitHub Releases，方便任何人直接下载安装包。

## ⚠️ 先理解原理（重要）

这个 App 是"网页外壳"：它把 `http://127.0.0.1:3080` 这个地址包装成原生窗口。
dsh 的网页端不是静态网站（需要 dsh 服务注入启动数据），**所以运行时本机必须先启动 `dsh web`，再打开这个 App**。

- 自己的电脑用：先 `dsh web`，再打开 App（对应下面的"本地打包"）。
- 分发给别人用：别人的电脑也要装 dsh 并启动它 —— 如果希望"装完即用"，见文末【进阶：把 dsh 服务打进安装包】。

## 目录结构

```
deepseek-harness-app/
├── .github/workflows/build.yml   # 三平台矩阵打包 + 自动上传 GitHub Release
├── assets/icon.png               # 应用图标（1024x1024，可替换）
├── scripts/
│   ├── build-locally.sh          # 本地一键打包
│   └── make-icon.py              # 图标生成脚本（可选）
├── .gitignore
└── README.md
```

设计取舍：仓库只存"编排 + 图标"，不提交任何构建中间产物
（`src-tauri/`、`node_modules`、安装包等全被 .gitignore 掉）。
每次 CI 在 runner 上用固定版本的 pake-cli 现场生成并打包，保证可复现、零仓库体积。

## 一、本地打包（对应你手动的 1~4 步）

```bash
# 1. 安装 Pake（npm/pnpm 均可）
pnpm install -g pake-cli

# 2. 启动 dsh web
dsh web

# 3. 一键打包（内含启动检查，也可直接手动跑 pake 命令）
./scripts/build-locally.sh 0.1.0

# 4. 安装：产物在当前目录
#    macOS  双击 DeepSeekHarness_*.dmg
#    Windows 双击 DeepSeekHarness.msi / .exe
#    Linux  sudo dpkg -i deepseek-harness_*.deb  或 运行 *.AppImage
```

手动等价命令：

```bash
pake http://127.0.0.1:3080/ --name DeepSeekHarness --title "DeepSeek Harness" \
     --identifier com.deepseekharness.app --icon assets/icon.png \
     --width 1280 --height 800 --app-version 0.1.0
```

## 二、GitHub Actions 自动打包 + 发布 （核心）

### 使用流程（给别人下载）

1. 把这个目录推成一个 GitHub 仓库：`git init && git add . && git commit -m init && git push`
2. 打 tag 触发自动构建 + 发布：

   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

3. 等约 10~25 分钟（首次编译较久，后续有缓存会快很多）。
   构建完成自动出现在仓库 **Releases** 页面，三平台安装包直接可下载：
   - `DeepSeekHarness_*.dmg`（macOS，universal 双架构）
   - `DeepSeekHarness.msi / .exe`（Windows）
   - `deepseek-harness_*.deb` + `.AppImage`（Linux）

不想打 tag 时：到 Actions 页 → **Build & Release** → **Run workflow** 手动触发，
产物可在运行记录页的 artifacts 里下载（并可用 `prerelease` 输入标记为预发布）。

### 触发方式

| 触发 | 效果 |
|---|---|
| `git push origin v*` | 自动构建 + 生成 Release（版本号取 tag，去掉 `v`） |
| 手动 Run workflow | 只构建 + 上传 artifacts，不发布 Release（除非打了 tag） |

### 工作流设计要点

- **三平台矩阵**：`macos-latest` / `windows-latest` / `ubuntu-24.04`，`fail-fast: false`
  一个平台失败不影响其他平台。
- **不依赖目标 URL 可达**：图标、标题都用参数显式传入，pake 抓取 favicon
  失败只会降级为默认值，不会让构建失败 —— CI 机器上 `127.0.0.1:3080` 不存在也没关系。
- **Rust 编译缓存**：`swatinem/rust-cache`，同一 pake 版本依赖一致，
  二次构建从 ~20 分钟降到 2~3 分钟。
- **版本号解析**：input 的 `app_version` 优先 → 否则取 tag `v1.0.0` → 默认 `0.1.0`。
- **pake 版本钉死**：`PAKE_VERSION: 3.15.6`，发版可复现；升级只需改这一个变量。
- **Linux 包名**：pake 会自动把 `DeepSeekHarness` 转成合法的 `deepseek-harness`，无需处理。
- **release 发布**：`softprops/action-gh-release`，仅 tag 触发时执行，支持覆盖更新。

### 可调参数

| input | 默认值 | 说明 |
|---|---|---|
| `url` | `http://127.0.0.1:3080/` | 打包的地址 |
| `app_version` | 空（取 tag） | 版本号 |
| `linux_targets` | `deb,appimage` | Linux 包格式，可加 `rpm` |
| `multi_arch` | `true` | macOS 是否打 universal（同时支持 Intel/Apple Silicon） |
| `prerelease` | `false` | 是否发布为预发布版 |

| env | 默认值 | 说明 |
|---|---|---|
| `APP_NAME` / `APP_TITLE` | `DeepSeekHarness` | 应用名 / 窗口标题 |
| `APP_IDENTIFIER` | `com.deepseekharness.app` | Bundle ID |
| `PAKE_VERSION` | `3.15.6` | pake-cli 版本（钉死可复现） |

## 三、代码签名（可选，但强烈建议分发时做）

不签名直接分发的后果：

- **macOS**：用户双击会提示"无法打开，因为 Apple 无法检查其是否包含恶意软件"。
  临时解决：右键 → 打开 → 再点打开；或 `xattr -cr /Applications/DeepSeekHarness.app`。
  正式解决：Developer ID 签名 + 公证。
- **Windows**：SmartScreen 蓝屏警告"Windows 已保护你的电脑"。正式解决：EV 证书 / Azure Trusted Signing。
- **Linux**：无强制要求。

工作流已内置 **macOS 签名 + 公证** 的步骤（检测到 secrets 才启用）。
在仓库 Settings → Secrets and variables → Actions 里配置：

| Secret | 用途 |
|---|---|
| `MACOS_CERT_P12` | 签名证书（base64 编码的 .p12） |
| `MACOS_CERT_PASSWORD` | 证书密码 |
| `MACOS_SIGNING_IDENTITY` | 可选，如 `Developer ID Application: xxx (TEAMID)`，缺省自动识别 |
| `MACOS_NOTARIZE_APPLE_ID` | 公证用 Apple ID |
| `MACOS_NOTARIZE_TEAM_ID` | 公证用 Team ID |
| `MACOS_NOTARIZE_PASSWORD` | Apple ID 专用密码（App-specific password） |

Windows 签名可在此基础上加一个 `signtool` 步骤（需要证书），README 不展开。

## 四、常见问题

<details>
<summary><b>macOS 打包时 DMG 失败（bundle_dmg.sh 报错）？</b></summary>

工作流的 macOS 步骤已设置 `TAURI_BUNDLER_DMG_IGNORE_CI: "true"` 规避 create-dmg 的 CI
检测问题；本地构建脚本也默认带上。若仍失败，可去掉 `--multi-arch` 再试，
或改用 `--iterative-build` 只产出 `.app`（可运行，只是不是安装包）。
</details>

<details>
<summary><b>我电脑上正用着 dsh web（比如正开着这个网页），装桌面版会不会冲突/被替换？</b></summary>

不会。桌面壳只是把 `http://127.0.0.1:3080` 包成一个原生窗口：安装只是把一个
`.app` / `.exe` 复制进系统应用目录，**不会停止、替换或修改正在运行的 dsh 服务**；
两者可同时存在（甚至能同时开多个窗口），卸载壳应用也不影响 dsh 本体。
</details>

<details>
<summary><b>打开 App 显示空白 / 连不上？</b></summary>

确认 `dsh web` 已在运行且 `curl http://127.0.0.1:3080/` 有响应。
壳应用本身不启动服务（想开箱即用请看【进阶】）。
</details>

<details>
<summary><b>Linux 双击 .AppImage 没反应？</b></summary>

AppImage 需要 FUSE：`chmod +x xxx.AppImage && ./xxx.AppImage`；
虚拟机/容器里常见，可加 `--appimage-extract-and-run`。deb 包需要 webkit2gtk 运行时，
发行版不同依赖略有差异。
</details>

<details>
<summary><b>怎么换图标？</b></summary>

替换 `assets/icon.png`（1024x1024 PNG）即可，或者手动改命令里的 `--icon`。
</details>

<details>
<summary><b>新版本 dsh 怎么出包？</b></summary>

`git tag v1.1.0 && git push origin v1.1.0`，Release 会自动生成新版本；升级 pake 就改
`PAKE_VERSION` 后重打一个 tag。
</details>

## 五、进阶：把 dsh 服务打进安装包（开箱即用）

如果希望别人**装了就能用**（不用自己装 dsh/启动服务），需要把 dsh 命令行程序作为
Tauri **sidecar** 打进应用，App 启动时自动拉起服务、等端口就绪后加载页面：

1. 用 pake 生成后，在 `src-tauri/tauri.conf.json` 配置外部二进制：
   ```json
   "bundle": {
     "externalBin": ["binaries/dsh-server"]
   }
   ```
   （构建时对应平台命名为 `dsh-server-<target-triple>`，随包分发 dsh 及其 web 资源。）
2. 在 `src-tauri/src/main.rs`（或 lib.rs）里启动 sidecar：
   ```rust
   let (mut rx, _child) = app.shell().sidecar("dsh-server")?.spawn()?;
   // 轮询 http://127.0.0.1:3080/ 直到 200，再让 Webview 加载该地址
   ```
3. App 退出时（`on_window_event` 的 CloseRequested）杀掉子进程。

代价：产物体积变大（dsh 运行时 + web 资源）、macOS 上 sidecar 同样要签名/公证。
这也是 Pake 官方 [tw93/Pake](https://github.com/tw93/Pake) 社区仓库对"本地服务型网页"
类应用的主流做法。仓库结构可对应升级为：

```
src-tauri/            # 提交自定义的 Tauri 工程（含 sidecar 逻辑）
  src/main.rs
  tauri.conf.json
  binaries/           # 或 CI 里下载 dsh 后按平台重命名
scripts/fetch-dsh.sh  # CI 步骤：下载对应平台 dsh 二进制
```

## License

MIT（本项目仅为 Pake 打包编排模板；dsh 本体版权归其作者所有）。