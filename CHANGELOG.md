# Changelog

## v1.0.7 (2026-06-10)

### 新增功能
- **清除封面**：工具栏新增「清除封面」按钮 + `POST /cover/clear/:id` 端点，批量清除歌曲中已嵌入的损坏封面，解决 v1.0.4 base64 封面损坏后新封面无法覆盖的问题（需主程序 v2.7.1+ 配合，当前版本清除后重刮即可覆盖）
- **MD3 主题适配 (#14 by @hanxi)**：所有硬编码色值替换为 `--md-*` CSS 变量，亮/暗主题自动跟随。inline SVG 图标替换为 Material Symbols Outlined 图标字体。Header/Tabs 使用 `color-mix()` 生成语义化半透明背景
- **多级目录浏览**：Songs Tab 全新左窗格目录树 + 面包屑导航，按真实 `file_path` 目录结构递归展开，支持任意层级深度。点击目录节点筛选歌曲，面包屑可回退
- **全部歌曲按钮**：工具栏新增「全部歌曲」按钮，一键显示所有歌曲（不走目录筛选）
- **歌曲列表文件格式**：歌曲列表和编辑页显示文件格式（mp3/flac/ape 等），跟在时长后面
- **fetchWithRetry 指数退避**：所有外部 API 调用均已包装重试逻辑（2次重试，1s-2s-4s 延迟），降低弱网失败率
- **多源并发搜索**：文本搜索从串行改为 `Promise.allSettled` 多源并发，速度提升 3-5 倍
- **新增国内源**：搜索源从 3 个扩展到 5 个，均已可用
- **模板变量系统**：`resolveTemplate("${artist} - ${title}", vars)` 正则替换语法
- **语言检测**：`detectLanguage(text)` 返回 zh/ja/ko/en/unknown
- **MD 文档弹窗**：Header 新增「📖 README」+「📝 改动日志」按钮，从 GitHub raw 拉取并渲染 Markdown
- **经典文件管理器布局**：单卡片无缝式左右分栏，底部状态栏，响应式适配平板和手机
- **短音频过滤**：时长 < 30s 的音频自动隐藏

### 修复
- **低分歌曲全部失败**：评分阈值 0.8→0.7，提高文本相似度通过率
- **skipped 误入失败列表**：`_sc()` 函数只记真正的 `failed` 状态；`batch()` 和 `resumeBatch()` 不再将无匹配结果记入失败
- **文件名噪音清洗**：剥离 `[FLAC]`/`[320k]`/`[HQ]`/`[无损]`/`[MV]` 等音质标签和 `(Live)`/`(Remix)`/`(Cover)`/`(伴奏)` 等版本标识，去除 `feat.`/`ft.` 合作艺人后缀
- **CD 翻录垃圾元数据处理**：DB 标题为 `Track 01`/`trad`/`unknown` 或艺术家为 `佚名`/`unknown` 时，自动退回文件名提取候选标签
- **编辑页/失败页修复**：编辑页不再因目录筛选导致空白；失败页重试弹窗不再跳转到歌曲 Tab
- **指纹异常降级**：主程序 Chromaprint 指纹被二进制垃圾+歌词文本污染时，插件侧 `fingerprint.length > 1000` 自动降级到文本搜索
- **安全加固**：`escH` 转义单引号、IPv6 方括号 SSRF 拦截、innerHTML XSS 修复、`clearFailed` 增加确认弹窗
- **文件管理器布局修复**：清除孤儿 `<div class="ptxt">` 和多余 `</div>` 导致日志/刮削源跑到其他标签页

### 开发体验
- TopBar「刷新」「README」「改动日志」三个按钮统一 Material Symbols 图标（refresh/description/history），尺寸一致
- 移动端 Header 居中适配（`.hdr` flex-direction:column + `.tabs` margin:0 auto）
- 版本号显示修复：`--md-on-surface-variant` 在深色 Header 上不可见 → 改用 `opacity:0.6` 继承 on-primary 色
- 页面 Header 显示当前版本号 v1.0.7

### 主程序联动
- **Go 后端 #145 修复**：`WriteTags` handler 下载封面失败或传空 `cover_url` 时清除旧 CoverPath/CoverURL，根除 v1.0.4 损坏封面永久残留问题（重新刮削即可覆盖）
- **Go 后端 #147 修复**：`GetPlaylistCover` 歌单无专属封面时回退到第一首有本地封面的歌曲，复用 `serveLocalCover()` 方法
- 升级到 v2.7.0（songloft/songloft:tmp-full-amd64）

### 优化
- 删除操作栏「📖 说明」按钮（顶栏三个按钮保留）
- 删除 `迭代方向.md` → 合并进 `.reasonix/memory/iteration-direction.md`，仓库不再追踪
- 删除 `discogs` 无效源权重（未实现、无调用方）
- AGENTS.md 全面精简 + 合并迭代方向
- `token()` 优先使用 `SongloftPlugin.getAuthToken()`，保留 localStorage fallback (#14)

---

## v1.0.5 (2026-06-08)

### 新增功能
- **强制刮削**：工具栏新增「强制」按钮，跳过 `scraped_done` 检查，全部重刮（`POST /scrape/batch {force:true}`）
- **下载封面**：工具栏新增「下载封面」按钮，批量下载外部封面到本地（已有封面的跳过，`/api/` 开头视为已本地化）
- **清空记录**：工具栏新增「清空记录」按钮 + `DELETE /storage/scraped` 端点，解除刮削标记
- **智能刮削按钮**：选 1 首直接刮削，选多首自动切换后台批量模式
- 刮削函数合并：提取 `_sc()` 共用函数，Songs Tab 和 Edit Tab 统一调用
- **SSRF 防护**：PUT /config、config/status 探测、搜索函数 fetch 前均校验 URL，拦截 `localhost`、`127.x`、`10.x`、`172.16-31`、`192.168`、`169.254` 等内网地址

### 修复
- **封面下载损坏**：删除 QuickJS `.text()`→手动 base64 的封面处理，改为直接传 `cover_url` 给 Go 后端 `DownloadCover()`
- **t2s 繁简转换无效**：5 位 codepoint 编码 (U+20D7E=134526) 溢出导致 Map 全空 → 改为 6 位编码 + 步长 12，恢复 963 对繁简映射
- **atob 中文乱码**：酷狗歌词 `atob()` 后加 `utf8Decode()`，手动解析 UTF-8 多字节序列，避免 QuickJS 环境下中文歌词乱码
- **`unchanged` 状态误判失败**：`ws === 'unchanged'` 已加入批量刮削成功判断
- **按钮混乱**：统一 7 按钮 + SVG 图标 + 竖线分组（选择 | 批量 | 单曲）
- `scraped_done` 污染：`delete merged['status']` / `delete merged['config']` 防止响应体写回存储

### 优化
- **评分算法**：`_findMatchingBlocks` 递归改为显式栈迭代，消除极端长字符串栈溢出风险
- 配置写入自动推导开关：`PUT /config` 有 Key/URL 则开启，清空则关闭
- 编辑页本地封面自动追加 `access_token`
- 源码版本号全局同步：`plugin.json`、`package.json`、`manifest.json`、`package-lock.json`、`src/main.ts`
- 作者更新为 `Songloft Team`

---

## v1.0.4 (2026-06-06)

- 源可连接性检测：`GET /config/status` 四源并发探测 + 红绿灯 UI
- 移除 fpcalc 依赖，使用主程序预计算 Chromaprint 指纹
- 编辑页本地封面自动追加 `access_token`
- 简繁转换表 779 → 963 对
- 清理主程序 bug 修复后的 workaround

---

## v1.0.3 (2026-05-29)

- 声纹匹配支持 (AcoustID + MusicBrainz)
- 三源文本搜索 (网易云/QQ音乐/酷狗)
- 封面和歌词刮削
- Ratcliff/Obershelp 文本相似度评分
- 批量异步刮削 + 进度恢复
- 失败歌曲管理 + 手动重试
