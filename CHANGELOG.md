# Changelog

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
