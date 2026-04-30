/**
 * 悬浮框 Skills 配置
 * 每个技能会在输入区上方显示为快捷按钮
 *
 * 字段说明：
 *   id        - 唯一标识
 *   icon      - 显示的 emoji 图标
 *   label     - 按钮文字
 *   prompt    - 点击后填入输入框的提示词（用户可继续修改后发送）
 *   autoSend  - true 时点击直接发送，false 时仅填入输入框（默认 false）
 *   color     - 可选，按钮主题色（Tailwind 色名，如 "violet"、"rose"、"sky"）
 */

const SKILLS = [
  {
    id: "ip-generation",
    icon: "✨",
    label: "一键IP生成",
    color: "violet",
    autoSend: false,
    /**
     * ipBased: true 时，点击该技能会自动从 ipAssets.js 中随机选一张 IP 图
     * 作为参考图加入输入框，用户再补充描述（如"圣诞装扮"）后发送。
     * 若 ipAssets 为空，则仅填充提示词，不加参考图。
     */
    ipBased: true,
    prompt: "请基于参考图中的IP形象，",
  },
  {
    id: "wa-poster",
    icon: "📢",
    label: "一键WA海报",
    color: "rose",
    autoSend: false,
    prompt:
      "帮我生成一张 WhatsApp 营销海报，16:9 横版，风格现代简洁，包含主视觉大图、醒目标题文字区域、副标题说明以及右下角品牌 Logo 预留位，色调以品牌绿为主。",
  },
  // ── 在此处继续添加更多技能 ──
  // {
  //   id: "product-photo",
  //   icon: "📦",
  //   label: "产品主图",
  //   color: "sky",
  //   autoSend: false,
  //   prompt: "帮我生成一张电商产品主图，白底干净，产品居中，专业打光...",
  // },
];

export default SKILLS;
