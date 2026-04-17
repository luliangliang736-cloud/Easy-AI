# Lovart Clone - AI Image Generator

基于 Nano Banana Pro API 的 AI 图片生成工具。

## 功能

- **文生图** (Text-to-Image): 输入 prompt 描述生成图片
- **图生图** (Image-to-Image): 上传参考图 + prompt 进行风格变换
- **多分辨率**: 1K / 2K / 4K
- **多宽高比**: 1:1 / 16:9 / 9:16 / 4:3 / 3:4
- **历史记录**: 本地存储生成历史，支持回看和重试
- **图片下载**: 一键下载生成结果

## 快速开始

### 1. 配置 API Key

编辑 `.env.local` 文件，填入你的 Nano Banana Pro API Key:

```
NANO_API_KEY=sk-your-actual-api-key
NANO_API_BASE=https://api.nanobananaapi.dev
NANO_SERVICE_TIER=priority
```

`NANO_SERVICE_TIER` 支持 `default` / `priority`，未配置时默认使用 `priority`。

API Key 获取地址: https://nanobananaapi.dev/settings/apikeys

### 2. 安装依赖

```bash
npm install
```

### 3. 启动开发服务器

```bash
npm run dev
```

打开 http://localhost:3000 即可使用。

## 技术栈

- Next.js 16 (App Router)
- Tailwind CSS v4
- Lucide Icons
- Nano Banana Pro API
