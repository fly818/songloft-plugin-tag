# 标签刮削插件

智能刮削音乐标签，自动修正歌曲标题、艺术家、专辑，下载封面和歌词写入音频文件。

## 功能

- **声纹刮削** — AcoustID 指纹提取，精确识别歌曲元数据
- **多源搜索** — 国内音乐平台聚合搜索，评分择优匹配
- **繁→简转换** — 内置 900+ 字符映射，繁体标签自动转简体
- **封面下载** — 自动拉取高清封面写入音频文件
- **歌词嵌入** — LRC 歌词下载后写入 ID3 标签
- **批量刮削** — 全选歌曲一键批量处理
- **编辑页面** — 手动编辑标签、封面、歌词
- **失败重试** — 刮削失败的歌曲可手动输入关键词重试

## 快速开始

1. 下载 [tag.jsplugin.zip](../../releases/latest)
2. 放入 Songloft 的 `data/jsplugins/` 目录
3. 重启 Songloft 或在插件管理中启用
4. 配置音源 API URL
5. （可选）安装 fpcalc 启用声纹匹配

## 安装 fpcalc

**Alpine / Docker:**
```sh
apk add chromaprint
```

**其他系统：**
在插件页面点击「📥 安装 fpcalc」自动下载对应平台版本。

## 环境要求

- Songloft v2.5.0+
- 可选：fpcalc（Chromaprint），用于 AcoustID 声纹匹配

## 开发

```sh
npm install
npm run build
```

输出在 `dist/tag.jsplugin.zip`。

## 许可

Apache-2.0
