export function detectOneClickEntryMode(promptText, refImages = []) {
  if (Array.isArray(refImages) && refImages.length > 0) return "agent";
  const text = String(promptText || "").trim();
  if (!text) return "quick";
  const compact = text.toLowerCase().replace(/\s+/g, "");
  const agentSignals = [
    "海报", "poster", "品牌", "branding", "logo", "字体", "排版", "版式", "包装",
    "banner", "kv", "主视觉", "电商", "详情页", "详情图", "产品图", "广告",
    "营销", "视觉规范", "延展", "物料", "画册", "封面", "构图", "镜头", "景别",
    "光影", "材质", "质感", "高级感", "高细节", "高清", "风格统一",
  ];
  if (agentSignals.some((keyword) => compact.includes(keyword))) return "agent";
  const structured = text.length >= 48 || /[，。；：\n]/.test(text) || /(保持|保留|突出|强调|避免|不要|并且|同时|需要|要求)/.test(text);
  return structured ? "agent" : "quick";
}

export function getLatestGeneratedImages(messages = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant" && Array.isArray(message.images) && message.images.length > 0) {
      return message.images.filter((src) => typeof src === "string" && src);
    }
  }
  return [];
}

export function shouldReusePreviousGeneratedImages(promptText, explicitRefImages = []) {
  if (Array.isArray(explicitRefImages) && explicitRefImages.length > 0) return false;
  const text = String(promptText || "").trim().toLowerCase();
  if (!text) return false;
  const editOrGenerate = /(换|改|继续|再来|重做|延续|保留|参考|基于|按照|照着|生成|出图|做一版|来一版|来一组|另一套|不同的|同风格|同款|变成)/.test(text);
  const contextual = /(这张|这个|这套|上一张|上一个|刚才|前面|之前|上次)/.test(text);
  const shortFollowup = /(再来一版|再来一个|换一组|换一版|继续改|继续做|换个配色|换个服装|再换套)/.test(text);
  return shortFollowup || (editOrGenerate && contextual) || /参考这个/.test(text);
}

export function isObviousOneClickGenerateRequest(promptText, refImages = [], attachments = []) {
  const text = String(promptText || "").trim().toLowerCase();
  if (!text) return false;
  if (Array.isArray(attachments) && attachments.length > 0) return false;
  const questionIntent = /(是什么|为什么|怎么|如何|分析|总结|解释|提取|读取|新闻|资讯|内容|文案|正文|描述|介绍|建议|推荐|帮我看看)/.test(text);
  const generateIntent = /(生成|生图|出图|画一张|画个|绘制|渲染|做一张|做个|做一版|做几版|做几套|来一张|来一版|来一组|来几版|来几组|来几套|给我一张|创建一张|设计一张|设计一组|设计几套)/.test(text);
  const editIntent = /(改成|变成|换成|换一版|换一组|换几版|换几组|继续改|继续做|重做|延展|参考这个|照着这个|按照这个|其它保持不变|不同样式|不同动作|不同姿势|不同服装|不同服饰)/.test(text);
  if (Array.isArray(refImages) && refImages.length > 0) return editIntent || generateIntent;
  return generateIntent && !questionIntent;
}
