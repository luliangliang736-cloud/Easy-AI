export const GENERATION_STAGE_ORDER = ["understanding", "preparing", "generating", "saving"];

export const GENERATION_STAGE_COPY = {
  understanding: {
    label: "正在理解需求",
    detail: "分析你的描述、参考图和输出意图",
  },
  preparing: {
    label: "正在准备参数",
    detail: "选择模型、比例和生成方式",
  },
  generating: {
    label: "正在生成图片",
    detail: "AI 正在绘制结果，完成后会自动显示",
  },
  saving: {
    label: "正在保存结果",
    detail: "写入历史记录，方便后续查看",
  },
};

export function getGenerationStageCopy(stage) {
  return GENERATION_STAGE_COPY[stage] || GENERATION_STAGE_COPY.generating;
}
