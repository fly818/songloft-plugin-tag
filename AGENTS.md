# AGENTS.md — songloft-plugin-tag

## 项目概述

Songloft 标签刮削插件（songloft-plugin-tag），自动修正歌曲标题/艺术家/专辑，下载封面和歌词写入音频文件。运行在 Songloft 主程序的 JS 插件沙箱（QuickJS）中。

- **仓库**: https://github.com/songloft-org/songloft-plugin-tag
- **版本**: 2.0.0
- **协议**: Apache-2.0

## 技术栈

| 层 | 技术 |
|---|------|
| 语言 | TypeScript (ES2020) |
| 运行时 | QuickJS（Songloft 插件沙箱） |
| 前端 | 原生 HTML/CSS/JS（无框架） |
| 构建 | @songloft/plugin-builder → JSC 编译 → ZIP 打包 |
| 类型 | @songloft/plugin-sdk 类型定义 |

## 目录结构

```
src/
  main.ts        # 插件入口：路由注册、UI 渲染、批量刮削编排
  scraper.ts     # 刮削引擎：AcoustID 声纹 + 多源文本搜索 + 评分择优 + 写回
  sources.ts     # 音源适配：5 个国内源 API 封装 + 文件名解析 + 配置管理
  scoring.ts     # 评分算法：Ratcliff/Obershelp 文本相似度 + 源权重
  t2s.ts         # 繁体→简体映射表（963 对）
static/
  index.html     # 前端页面（Bento Dashboard 布局 + 全部 CSS/JS inline）
dist/
  tag.jsplugin.zip  # 构建产物
```

## 架构要点

### 刮削流程 (scraper.ts → doScrape)

1. 获取歌曲元数据（songloft.songs.getById）
2. 提取候选标签（extractCandidates）：优先 DB 元数据，退化到文件名解析，支持正向/反向排序
3. 繁体→简体转换
4. **声纹优先**：AcoustID 指纹匹配（需主程序 v2.6.3+ 生成指纹）
5. **文本搜索兜底**：5 个国内源并发查询（网易云/QQ音乐/酷狗/咪咕/酷我）
6. 评分择优：0.4×艺术家相似度 + 0.6×标题相似度 × 源权重
7. 得分 ≥ 0.7 判定成功，写回标签

### 文件名解析 (sources.ts → extractCandidate / extractCandidates)

- 优先使用 DB 中的有效元数据（排除 Track 01/unknown 等垃圾值）
- 文件名含 ` - ` 分隔符时返回两种候选排序（正常 + 反向）
- `doScrape` 首轮得分不佳自动尝试反向排序

### 音源权重 (scoring.ts)

各源独立权重系数，影响最终评分。网络直连源（咪咕/酷我）权重 1.0，需配置 API 的源权重 0.85。

### 前端 (main.ts + static/index.html)

- Bento Dashboard 布局：左侧目录树 + 右侧歌曲列表
- 移动端自动切换单列 + 汉堡菜单
- 主题跟随主程序（浅色/深色），使用 `var(--md-*)` CSS 变量
- 批量刮削异步执行，前端轮询进度

## 编码规范

- **无注释原则**：代码自解释，不写多行注释。仅在 WHY 非直觉时加单行注释
- **无框架**：纯 TS + 原生 DOM，不引入 React/Vue 等
- **无外部运行时依赖**：仅 aes-js（加密）为 dependencies，其余为 devDependencies
- **QuickJS 兼容**：避免 async iterator、WeakRef、FinalizationRegistry 等 QuickJS 不支持的特性
- **繁简转换**：搜索前统一转简体，提高国内源匹配率
- **SSRF 防护**：配置 URL 自动拦截内网地址（localhost/127.x/10.x/172.16-31.x/192.168.x）

## 构建流程

```bash
npm run build    # songloft-plugin build → static assets hash → JSC 编译 → ZIP 打包
```

产物：
- `dist/tag.jsplugin.zip` — 分发包
- `dist/main.js` — 编译后的 JS
- `plugin.json` — 需手动更新 entryHash/zipHash（build 输出）

## 版本发布清单

1. 更新 `package.json`、`plugin.json`、`src/main.ts` 中的版本号
2. 更新 `CHANGELOG.md`
3. `npm run build`
4. 将 build 输出的 entryHash/zipHash 写回 `plugin.json`
5. Git commit + tag + push
6. GitHub Release + 上传 zip 附件

## 主程序 API 依赖

| API | 用途 |
|-----|------|
| `songloft.songs.list()` | 获取歌曲列表 |
| `songloft.songs.getById()` | 获取单曲详情（含 fingerprint） |
| `songloft.plugin.getToken()` | 获取鉴权 token |
| `songloft.plugin.getHostUrl()` | 获取主程序地址 |
| `songloft.storage.get/set()` | 插件持久化存储 |
| `PUT /api/v1/songs/:id/tags` | 写入标签 |
| `GET /api/v1/songs/:id/cover` | 获取封面 |

## 常见问题

- **声纹匹配不可用**：需主程序 v2.6.3+，且需在设置中填入 AcoustID API Key
- **封面加载 401**：v1.1.4 已修复，本地 cover_url 自动附加 access_token
- **歌名歌手识别错误**：v1.1.4 已支持「歌名 - 歌手」反向格式
- **指纹被污染**：主程序 v2.7.0 已修复，插件自动降级到文本搜索

## 开发工作流程

### 代码编写后

1. **BUG 查找**：对编写的代码进行全面的 BUG 查找
   - 检查逻辑错误、边界条件、空值处理
   - 检查异步操作的错误处理
   - 检查类型安全和类型断言

2. **代码审计 + 安全审计**：修复 BUG 后进行
   - 代码质量：命名规范、函数长度、重复代码
   - 安全性：XSS 防护、SSRF 防护、输入验证
   - 性能：避免不必要的计算、内存泄漏

3. **测试 + 用户验收**：审计完成后
   - 功能测试：所有新增功能正常工作
   - 边界测试：异常输入、空数据、网络错误
   - 用户验收：确认功能符合需求后提交

### 版本发布

遵循版本发布清单（见上方），确保每一步都完成后再发布。

### ⚠️ PowerShell 编码陷阱

PowerShell 的 `Invoke-RestMethod` 在发送 JSON body 时，对中文字符编码不正确（乱码）。解决方案：

```powershell
# ❌ 错误：直接拼接 JSON 字符串，中文会乱码
$body = @{body = "中文内容"} | ConvertTo-Json

# ✅ 正确：从 UTF-8 文件读取 JSON
@{body = "中文内容"} | ConvertTo-Json | Out-File -FilePath "body.json" -Encoding UTF8
$body = Get-Content -Raw -Encoding UTF8 "body.json"
Invoke-RestMethod -Uri $url -Method Patch -Headers $headers -Body $body -ContentType "application/json; charset=utf-8"
```

创建 GitHub Release 说明时，必须先将 JSON 写入文件，再用 `Get-Content -Encoding UTF8` 读取后发送。
