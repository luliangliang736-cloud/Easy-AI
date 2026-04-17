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

# OpenAI 官方
OPENAI_API_KEY=
OPENAI_API_BASE=https://api.openai.com/v1
OPENAI_API_VERSION=
OPENAI_API_KEY_HEADER=authorization
OPENAI_API_STYLE=auto
OBJECT_PLAN_MODEL=gpt-4.1-mini
OBJECT_EDIT_PROVIDER=openai
OBJECT_EDIT_MODEL=gpt-image-1
NANO_OBJECT_EDIT_MODEL=gemini-3.1-flash-image-preview

# SAM（默认优先本地 checkpoint，其次可回退远程接口）
SAM_MODE=auto
SAM_CHECKPOINT=E:\数字人计划\复刻lovart\models\SAM\sam_vit_h_4b8939.pth
SAM_MODEL_TYPE=vit_h
OBJECT_SELECT_PYTHON_BIN=python

# Meta 官方 SAM 服务（如需远程回退可配置）
SAM_API_URL=
SAM_API_KEY=

# 如需覆盖默认官方端点，可选填：
OBJECT_PLAN_API_URL=
OBJECT_EDIT_API_URL=
```

`NANO_SERVICE_TIER` 支持 `default` / `priority`，未配置时默认使用 `priority`。

如果你接的是带网关版本号的 OpenAI 兼容服务，也可以这样配：

- `OPENAI_API_BASE=https://your-gateway.example.com`
- `OPENAI_API_VERSION=2024-12-01-preview`
- `OPENAI_API_KEY_HEADER=api-key`
- `OPENAI_API_STYLE=azure`

Azure 兼容模式下会请求：

- `POST {OPENAI_API_BASE}/openai/deployments/{OBJECT_PLAN_MODEL}/chat/completions?api-version=...`
- `POST {OPENAI_API_BASE}/openai/deployments/{OBJECT_EDIT_MODEL}/images/edits?api-version=...`

`OBJECT_EDIT_PROVIDER` 支持：

- `openai`：最后一步走 `OpenAI Images / DALL·E` 编辑
- `nano`：最后一步先走 `Nano /v1/images/edit`

当使用 `nano` 时，当前实现会保留 `SAM` 点选和 `GPT` 指令规划，但最终编辑是“基于原图的定向编辑”，不是严格按 `mask` 做像素级 inpaint。

`SAM_MODE` 支持：

- `auto`：优先本地 SAM，失败时若已配置 `SAM_API_URL` 则回退远程
- `local`：强制只走本地 checkpoint
- `remote`：强制只走远程接口

本地 SAM 依赖可执行：

```bash
python -m pip install -r python_tools/object_select/requirements.txt
```

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
