# 弥音 · MELUNE 扩展插件协议与开发规范（`melune-ext/v1`）

> 适用版本：**弥音 · MELUNE `v2.5.0+`**（推荐 `v2.5.1+`）
> 官方社区示例源：[`xhd2005/melune-plugins`](https://github.com/xhd2005/melune-plugins)

`melune-ext/v1` 是专为 **弥音 · MELUNE** 原创设计的轻量级、零原始 HTML 注入、强制完整性校验的移动端沙箱扩展规范。它确保播放器主程序核心保持 100% 纯净合规，同时让社区开发者能够安全扩展音频解析、歌词处理与交互工具面板。

---

## 1. 架构原则与安全红线

1. **按需加载、绝不静默安装**：`v2.5.1+` 预置 `xhd2005/melune-plugins` 为默认官方源，但冷启动零网络请求——仅在用户主动打开「扩展插件」标签时才按需同步商店索引；所有扩展均需用户亲自审阅权限与 SHA-256 指纹后点击安装，用户也可随时移除或恢复默认源。
2. **零明文 Token 暴露**：即使用户授予 `kugou.auth` 权限，插件也**永远拿不到**登录 `token` 或 `t1`。插件仅能读取账号摘要并通过 `ctx.kugou.callRoute(route, params, { userid })` 由宿主安全代签。
3. **强制隔离存储（`ext.data.<pluginId>:*`）**：`ctx.storage` 由宿主强制拼接命名空间前缀并拦截 `..` 路径穿越；任何插件均无法触碰 `accounts.v1`、`settings.v1` 或其他插件的数据。
4. **声明式 Liquid Glass UI（零 `v-html`）**：插件只能返回结构化 JSON 视图树（`MelunePanelView`），由宿主原生 [PluginPanelRenderer.vue](../src/components/PluginPanelRenderer.vue) 使用统一全局 `.ios-switch` 与原生 iOS 26 卡片渲染，彻底杜绝 XSS 与风格割裂。
5. **强制 SHA-256 完整性校验**：下载安装前与每次启动加载前，宿主都会重新计算插件入口代码（UTF-8）的 SHA-256 摘要并与清单比对，任何篡改立即拒绝执行。
6. **无损升级与一键安全模式**：升级扩展仅覆盖清单与入口脚本，100% 保留 `ext.data.<pluginId>:*` 数据；开启「安全模式」可瞬间卸载全部插件且保留配置，方便排查问题。

---

## 2. 仓库目录结构与清单规范

推荐一个扩展源仓库按如下结构组织（务必配置 `.gitattributes` 强制 `* text=auto eol=lf`，避免 Windows / Linux 换行符差异导致 SHA-256 不一致）：

```text
my-melune-plugins/
├── .gitattributes                 # 强制 LF 换行，确保跨平台 SHA-256 一致
├── melune-registry.json           # 源索引文件（由 build-registry.mjs 自动生成）
├── scripts/
│   └── build-registry.mjs         # 自动计算 SHA-256 并校验 --check
└── plugins/
    └── my-first-plugin/
        ├── melune-plugin.json     # 插件元数据清单
        └── index.js               # 单文件 CommonJS 风格入口脚本
```

### 2.1 `melune-plugin.json` 字段定义

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :---: | :--- |
| `protocol` | `"melune-ext/v1"` | 是 | 固定协议标识，必须精确匹配 |
| `id` | `string` | 是 | 全局唯一 ID，仅允许 `^[a-z0-9][a-z0-9._-]{1,63}$` |
| `name` | `string` | 是 | 展示名称（建议 2–16 字） |
| `version` | `string` | 是 | 语义化版本号（如 `"1.1.0"`），用于商店更新检测 |
| `author` | `string` | 是 | 作者署名与开源致谢 |
| `license` | `string` | 否 | 开源协议（推荐 `"MIT"` / `"GPL-3.0"`） |
| `category` | `"account" \| "audio" \| "lyrics" \| "utility"` | 否 | 商店分类筛选标签，默认 `"utility"` |
| `icon` | `string` | 否 | 统一图标键名：`calendar-check` / `users-group` / `wave-sine` / `music` / `sparkles` / `tool` / `puzzle` |
| `description` | `string` | 是 | 简洁功能描述（1–2 句） |
| `entry` | `string` | 否 | 入口文件名，默认 `"index.js"` |
| `downloadUrl` | `string` | 是（索引中） | 插件入口代码 HTTPS 下载地址 |
| `sha256` | `string` | 是 | 入口代码 UTF-8 字节的 64 位小写十六进制 SHA-256 摘要 |
| `minAppVersion` | `string` | 否 | 最低宿主版本，如 `"2.5.0"` |
| `homepage` | `string` | 否 | 源码或文档主页 HTTPS 链接 |
| `permissions` | `MelunePermission[]` | 是 | 声明所需的最小权限集合，禁止申请未使用的权限 |

### 2.2 `melune-registry.json` 字段定义

```json
{
  "protocol": "melune-registry/v1",
  "id": "my-community-registry",
  "name": "我的弥音扩展源",
  "maintainer": "Your Name (@handle)",
  "description": "面向 MELUNE v2.5.0+ 的社区扩展集合",
  "homepage": "https://github.com/owner/repo",
  "updatedAt": "2026-11-28",
  "plugins": [ /* MelunePluginManifest[] */ ]
}
```

---

## 3. 细粒度权限与 KuGou 路由白名单

### 3.1 8 项沙箱权限

| 权限名 | 开放能力 |
| :--- | :--- |
| `storage` | 读写 `ext.data.<pluginId>:*` 隔离 KV 存储 |
| `network` | 调用 `ctx.http.*` 发起标准 `http://` / `https://` 请求 |
| `kugou.api` | 调用白名单内 `ctx.kugou.callRoute` / `searchSongs` / `getSongUrl` |
| `kugou.auth` | 读取账号脱敏摘要（不含 Token），并允许在 `callRoute` 指定 `options.userid` 由宿主代签 |
| `audio.resolver` | 注册 `ctx.registerAudioResolver(...)` 提供备用音源搜索、解析与单曲锁定 |
| `lyric.filter` | 注册 `ctx.registerLyricFilter(...)` 对歌词行进行过滤或排版增强 |
| `ui.panel` | 注册 `ctx.registerPanel(...)` 提供声明式控制面板 |
| `lifecycle.launch` | 注册 `ctx.onAppLaunch(...)` 与 `ctx.onAuthLogin(...)` 生命周期钩子 |

### 3.2 `ctx.kugou.callRoute` 允许路由白名单与错误行为

宿主仅放行以下经过安全审查的路由（且强制剔除插件参数中任何意外注入的 `token` 字段）：

- **任务与权益类**：`/youth/day/vip`、`/youth/day/vip/upgrade`、`/youth/vip`、`/youth/listen/song`、`/youth/month/vip/record`、`/youth/union/vip`、`/user/listen/report`、`/playhistory/upload`、`/user/grade/info`、`/user/vip/detail`、`/user/batch/union/vipinfo`、`/v2/batch_union_vipinfo`
- **组队活动类**：`/team/period/info`、`/team/my/info`、`/team/my`、`/team/join`、`/team/my/status`、`/team/history`
- **曲库检索类**：`/search`、`/privilege/lite`、`/song/url`、`/song/url/new`

> **结构化响应约定（`v2.5.1+`）**：当酷狗返回业务非零码（如 `131001` 今日已领取、`297001` 今日已升级、`143001/143004/143005/143010` 组队状态码）导致底层返回 HTTP 502 时，`ctx.kugou.callRoute` 会将结构化 `{ status, body }` 正常返回给插件以便准确判定业务态，不再静默丢失错误体；仅在权限越界或真实网络断连时抛出 `Error`。

---

## 4. `MelunePluginContext` SDK 速查

插件入口脚本运行在严格模式沙箱函数中，全局仅注入 `module`、`exports` 与 `defineMelunePlugin`：

```js
module.exports = defineMelunePlugin({
  async setup(ctx) {
    // 1. 基本信息
    // ctx.pluginId, ctx.appVersion, ctx.permissions

    // 2. 隔离存储（需 storage）
    const cfg = await ctx.storage.get('config.v1', { enabled: false });
    await ctx.storage.set('config.v1', cfg);
    await ctx.storage.remove('temp');

    // 3. 网络请求（需 network，走原生 OkHttp 零 CORS）
    // await ctx.http.getText(url, headers, timeoutMs)
    // await ctx.http.getJson(url, headers, timeoutMs)
    // await ctx.http.postJson(url, body, headers, timeoutMs)
    // await ctx.http.request(opts)

    // 4. KuGou 代理接口（需 kugou.api / kugou.auth）
    // ctx.kugou.getActiveAccount() / listAccounts() / refreshAccount(userid)
    // await ctx.kugou.callRoute('/team/period/info', {}, { userid })

    // 5. UI 反馈与诊断日志（无需额外权限）
    ctx.ui.toast('操作完成');
    ctx.ui.haptic('success'); // 'light' | 'medium' | 'heavy' | 'selection' | 'success'
    await ctx.ui.copy('INVITE-CODE');
    ctx.ui.refreshPanel();
    ctx.log('info', '初始化完成'); // 'info' | 'warn' | 'error'，展示在诊断抽屉最近 20 条日志

    // 6. 能力挂载（按权限启用）
    // ctx.registerPanel({ render, onAction })
    // ctx.registerAudioResolver(provider)
    // ctx.registerLyricFilter((lyrics, song) => lyrics)
    // ctx.onAppLaunch(async () => {})
    // ctx.onAuthLogin(async (userid) => {})
  },
  teardown() {
    // 插件停用、卸载或开启安全模式时调用，务必在此释放 setInterval / 定时器
  },
});
```

---

## 5. 10 种声明式 Liquid Glass UI 区块

`render()` 返回 `{ subtitle?: string, sections: Array<{ title?: string, blocks: MelunePanelBlock[] }> }`，每个 `section` 渲染为弥音原生 `rounded-[22px] bg-[var(--bg-card)]` 卡片：

| `type` | 核心字段 | 用途 |
| :--- | :--- | :--- |
| `hero-stat` | `label, value, unit?, sub?, badge?` | 大号数字指标 + 胶囊徽章 |
| `kv-grid` | `columns?: 2 \| 3, items: [{ label, value, accent?, muted? }]` | 2/3 列键值概览网格 |
| `notice` | `tone?: 'info'\|'success'\|'warning'\|'error', title?, text` | 状态提示横幅 |
| `copy-code` | `label, code, hint?` | 带「复制」药丸按钮的邀请码卡片 |
| `button-row` | `buttons: [{ id, label, action, payload?, variant?: 'primary'\|'secondary'\|'danger', disabled?, loading? }]` | 1–3 列原生药丸操作按钮 |
| `toggle` | `id, label, sub?, value: boolean, action` | 原生全局 `.ios-switch` 开关行（`onAction` 收到 `{ id, value }`） |
| `text-input` | `id, label, placeholder?, value, submitLabel?, action, hint?` | 胶囊输入框 + 提交按钮（`onAction` 收到 `{ id, value }`） |
| `steps` | `items: [{ label, status: 'idle'\|'running'\|'success'\|'already'\|'failed'\|'skipped', detail? }]` | 分步执行清单 |
| `calendar` | `title, cells: [{ empty?, key, day?, isToday?, isClaimed?, isFailed?, isFuture? }]` | 月度打卡日历网格 |
| `badge-list` | `title?, items: [{ label, active?, action?, payload? }]` | 可交互胶囊预设/标签组 |

---

## 6. 最小可运行「Hello MELUNE」示例

```js
// plugins/hello-melune/index.js
module.exports = defineMelunePlugin({
  async setup(ctx) {
    let count = await ctx.storage.get('count', 0);

    ctx.registerPanel({
      render() {
        return {
          subtitle: '最小可运行 melune-ext/v1 扩展模板',
          sections: [
            {
              title: '计数器',
              blocks: [
                { type: 'hero-stat', label: '点击次数', value: String(count), unit: '次', badge: '示例' },
                {
                  type: 'button-row',
                  buttons: [{ id: 'inc', label: '点我 +1', action: 'inc', variant: 'primary' }],
                },
              ],
            },
          ],
        };
      },
      async onAction(action) {
        if (action === 'inc') {
          count += 1;
          await ctx.storage.set('count', count);
          ctx.log('info', `计数已递增至 ${count}`);
          ctx.ui.toast(`当前计数：${count}`);
        }
      },
    });
  },
});
```

生成并校验 SHA-256（参考 `xhd2005/melune-plugins/scripts/build-registry.mjs`）：

```bash
node scripts/build-registry.mjs
node scripts/build-registry.mjs --check
```

---

## 7. `melune://` 深链分享格式

Android 端已注册 `melune://ext/*` Scheme，用户粘贴或在外部点击以下链接即可直接唤起弥音导入源或弹出权限审计安装窗：

- **分享整个扩展源**：`melune://ext/registry?url=<encodeURIComponent(registryUrl)>`
- **分享单款扩展**：`melune://ext/install?id=<pluginId>&registry=<encodeURIComponent(registryUrl)>`

---

## 8. 社区合规准则

1. 任何自动化任务类扩展的自动开关**必须默认关闭**，禁止在用户未显式拨开开关时发起高频请求或外部服务器上报。
2. 禁止在插件内混淆/加密隐藏真实网络目的地，所有外部域名必须在清单描述或面板设置中向用户透明展示。
3. 禁止绕过宿主安全边界、尝试窃取凭证或用于任何商业盈利、付费分发与侵权用途。
