# Changelog

## v1.1.5 (2026-07-09)

### 新增
- **时长惩罚机制**：评分算法新增时长差惩罚，时长差 > 5s 的候选自动扣分，防止同名异版误判
- **结果缓存（24h）**：刮削结果本地缓存 24 小时，避免重复请求同一关键词
- **API 限流（令牌桶）**：各源独立令牌桶限流，默认 2 req/s，保护 API 不被封禁

### 改进
- **MusicBrainz 时长提取**：AcoustID 匹配时从 MusicBrainz 获取录音时长，用于时长惩罚计算

---

## v1.1.4 (2026-07-09)

### 修复
- **列表页封面不显示（#16 by @fly818）**：`/songs` API 对本地路径的 `cover_url` 补充 `access_token` 参数，解决 401 鉴权失败导致封面无法加载；前端 `render()` 中有封面的歌曲改为渲染实际 `<img>` 标签
- **文件名「歌名 - 歌手」格式无法识别（#179）**：`extractCandidate` 新增 `extractCandidates` 函数，当文件名含分隔符时返回两种候选排序（正常 + 反向），`doScrape` 首轮得分不佳自动尝试反向排序重新搜索

### 改进
- **无障碍支持（#186）**：改进插件 Web 端的无障碍体验

---

## v1.1.3 (2026-06-13)

### 新增
- **主题切换**：设置弹窗新增主题选项（浅色 / 深色 / 跟随主程序），可手动切换插件外观

### 改进
- **跟随主程序主题**：插件 CSS 全面改用主程序 Material Design 3 CSS 变量（`var(--md-*)`），自动适配浅色/深色主题
- **浅色主题对比度优化**：加深次要文字和边框颜色，提升浅色主题下的可读性
- **刮削后自动刷新封面图标**：单曲刮削和批量刮削完成后延迟 2 秒再刷新歌曲列表，确保封面图标正确显示

### 修复
- **源连通性标记错位**：设置弹窗中源 chip 的绿色连通标记因选择器范围过大（匹配到主题 chip）导致索引错位，现限定为 `#srcChips`
- **README 重写**：去除所有具体平台名称，统一使用"国内源"代替；新增功能概览、刮削策略、技术细节章节

---

## v1.1.2 (2026-06-12)

### 修复
- **状态栏实时更新**：批量刮削期间状态栏数字随进度逐个递增，不再一次性跳满
  - 服务端进度接口始终返回 `results`（不再仅在完成时返回）
  - 客户端用 `S._lastResultCnt` 跟踪已处理数量，每次轮询只添加新增歌曲
- **封面 fallback**：富化阶段最高分结果无封面时，自动从其他有封面的结果中取封面
- **编辑框封面上传**：编辑弹窗封面区域可点击上传图片，保存时通过 `cover_data` 写入
- **失败列表即时刷新**：手动刮削成功后立即从失败列表移除，不再等待 `loadSongs`
- **删除失败页手动刮削按钮**：列表点击歌曲已可直接进入编辑弹窗刮削

---

## v1.1.1 (2026-06-12)

### 修复
- **AcoustID 指纹搜索修复**：移除 `fingerprint.length > 1000` 误判阈值（v2.8.0 修复后 Chromaprint 指纹为有效 base64，长度与歌曲时长成正比，268秒歌曲指纹约8000字符）
- **AcoustID API 改用 POST**：指纹作为 URL 参数会导致 GET 请求超过 URL 长度限制（414），改为 POST form 提交

### 说明
- 主程序 v2.8.0 已修复 ffmpeg chromaprint 指纹被歌词/元数据污染的问题（`-map 0:a:0 -map_metadata -1`）
- 升级后需从主程序管理界面触发指纹重新计算（`/api/v1/scan/fingerprints` + `recompute_all=true`），使 AcoustID 声纹匹配正常工作

### 修复
- **编辑框封面不显示**：cover_url 使用 `host` 前缀（`http://localhost:58091`）构造完整 URL，远程浏览器无法加载。改为相对路径，由浏览器根据当前 origin 自动解析

---

## v1.1.0 (2026-06-12)

### UI 全面重构
- **Bento Dashboard 布局**：全新 mockup-b 风格界面，Cormorant + Montserrat 字体，金色主题
- **状态栏**：Header 下方显示 4 项统计（歌曲/已刮削/失败/待处理），实时更新
- **歌曲卡片 2 列网格**：封面占位图标 + 标题/艺术家/专辑/时长/格式 + 状态标签（已刮削/失败/待处理）
- **独立失败页面**：失败 Tab 全新视图，显示错误原因和时间戳，支持刷新/清空/手动刮削
- **编辑抽屉**：居中弹窗，大封面预览 + 2 列表单（标题/艺术家/专辑/流派/歌词）
- **配置弹窗**：齿轮按钮打开，刮削源 chip 切换 + API URL 配置 + 连通性颜色指示（绿色=可达，红色=不可达）
- **移动端适配**：汉堡菜单 + 侧边栏目录树 + 单列卡片布局
- **复选框分离**：复选框区域独立点击，避免误触编辑弹窗

### 移除功能
- **编辑 Tab**：移除独立编辑 Tab，改为编辑抽屉弹窗
- **预览按钮**：移除预览功能，改为手动刮削弹窗
- **全部歌曲按钮**：移除工具栏「全部歌曲」按钮，目录树顶部已包含全部歌曲入口

### 刮削状态追踪
- **实时状态标记**：歌曲卡片显示已刮削（金色 album 图标）/失败（红色 error 图标）/待处理（灰色 music_note 图标）
- **批量刮削跳过**：`force=false` 时后端根据 `scraped_done` 跳过已刮削歌曲
- **`no change` 记录**：刮削结果为 skipped/unchanged/written 均记入数据库
- **清空记录**：`DELETE /storage/scraped` 清除数据库 + 前端状态

### 功能优化
- **标题栏刷新按钮**：改为强制刷新页面（`location.reload(true)`）
- **失败 Tab 移动端**：隐藏汉堡菜单、tabs、侧边栏，显示返回按钮
- **README/CHANGELOG 按钮**：移动端不再隐藏，始终可见
- **配置保存**：输入框正确回填已保存的值
- **批量进度同步**：任务完成/中断时同步刮削状态和卡片标记

### 修复
- **storage 双重编码**：`getScrapedDone()` 添加 `Array.isArray` 类型检查，兼容 `"[id]"` 和 `[id]` 两种格式
- **批量停止后状态丢失**：停止时不再调用 `loadScraped()` 覆盖内存数据
- **卡片标签不显示**：`loadScraped()` 后调用 `render()` 刷新卡片
- **Material Symbols 字体缺失**：添加 Google Fonts 导入

---

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
