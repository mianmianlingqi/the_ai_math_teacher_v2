/**
 * prompts.ts
 *
 * 单一职责：集中管理所有出题 Prompt 构建函数。
 *
 * 从 `aiService.ts` 迁移。所有 Prompt 语义与当前版本保持一致，仅迁移位置。
 * 双模型四阶段 Prompt 已移除（对应 generateDualStage 的删除）。
 */

import { GenerateConfig, MathProblem, Difficulty, QuestionType } from "@/types";

// ====== 题型约束 ======

/** 难度指导语 */
export function getDifficultyGuidance(difficulty: Difficulty): string {
  switch (difficulty) {
    case Difficulty.EASY:
      return "【基础巩固】侧重核心概念的直接应用，数值简洁，逻辑清晰";
    case Difficulty.MEDIUM:
      return "【中坚拔高】包含知识点嵌套，需要中等程度的化简或构造，接近考试真题中后段水平";
    case Difficulty.HARD:
      return "【竞赛/压轴】涉及深层抽象思维、多步推导或不常用的数学技巧，设置精巧的陷阱";
    default:
      return "";
  }
}

/** 题型硬约束规则（选择题必须 4 选项，非选择题禁止选项格式） */
export function getQuestionTypeHardRules(questionType: QuestionType): string[] {
  if (questionType === QuestionType.CHOICE) {
    return [
      "【题型硬约束（必须满足）】",
      "- 仅允许输出选择题。",
      "- 每道题 options 必须且只能有 4 项。",
      "- question 里不要重复粘贴 A/B/C/D 选项正文。",
    ];
  }
  return [
    "【题型硬约束（必须满足）】",
    `- 仅允许输出「${questionType}」，严禁输出选择题。`,
    "- options 必须为空数组 []。",
    "- question 中严禁出现 A. / B. / C. / D. 等选项格式。",
  ];
}

/** 题型一致性门禁（含负例） */
export function getQuestionTypeConstraintBlock(questionType: QuestionType): string[] {
  if (questionType === QuestionType.CHOICE) {
    return [
      "【最高优先级：题型一致性门禁】",
      "若与题型约束冲突，视为本次输出失败，必须重写后再输出。",
      ...getQuestionTypeHardRules(questionType),
      "【负例（禁止输出）】",
      "- 禁止输出 options 长度不等于 4 的题目。",
      "- 禁止将完整 A/B/C/D 选项正文重复写入 question。",
    ];
  }
  return [
    "【最高优先级：题型一致性门禁】",
    "若与题型约束冲突，视为本次输出失败，必须重写后再输出。",
    ...getQuestionTypeHardRules(questionType),
    "【负例（禁止输出）】",
    "- 错误示例：question 出现 A. / B. / C. / D.；此类必须判为选择题并禁止输出。",
    "- 错误示例：非选择题出现 options 非空数组；必须改为 options=[]。",
  ];
}

// ====== 阶段 1：题干生成 Prompt ======

/** 题干生成系统提示词 */
export function buildStemSystemPrompt(): string {
  return [
    "你是一位极富创意的资深数学命题专家，擅长出具有高鉴别度、低同质化的优质试题。",
    "",
    "【最高优先级执行原则】",
    "- 先满足题型约束，再考虑创意与多样性。",
    "- 若题型不匹配，必须自检重写，不得输出。",
    "",
    "【铁律：禁止同质化，每道题必须真正不同】",
    "1. 同一批题目中，严禁两道题考察完全相同的运算步骤序列。",
    "2. 严禁两道题的函数主体相同（如同一批里两道都对同一类函数求导）。",
    "3. 数值参数必须多样，禁止连续两题的参数仅差一个常数。",
    "",
    "【本阶段任务：仅生成题干，不需要答案和解析】",
    "请专注于创作高质量的题目内容，确保题干完整、条件清晰、问法明确。",
    "所有数学符号必须用 LaTeX 包裹：行内 $...$，块级 $$...$$，单个字母也不例外。",
    "",
    "【输出格式】只返回 JSON 数组，每个元素只包含题干（选择题 options 填4项，否则空数组）：",
    '[{"id":"uid","question":"含LaTeX","options":[]}]',
    "严禁输出 JSON 以外的任何文字。",
  ].join("\n");
}

/** 题干生成 user prompt */
export function buildStemUserPrompt(
  config: GenerateConfig,
  entropy: string,
  existingProblems: MathProblem[] = []
): string {
  const { syllabus, difficulty, questionType, chapter, topic, count, referenceContext } = config;
  const lines = [
    `为 [${syllabus}] 学生出 ${count} 道 [${chapter}] 章节的 [${questionType}] 题干（只需题干，不需要答案和解析），确保每道题风格各异。`,
    "",
    "=== 题型门禁（必须最先满足）===",
    ...getQuestionTypeConstraintBlock(questionType),
    "",
    "=== 出题参数 ===",
    `章节：${chapter}`,
    `题型：${questionType}`,
    `难度：${difficulty}（${getDifficultyGuidance(difficulty)}）`,
    `额外要求：${topic || "综合考察章节核心内容，兼顾基本公式和综合应用"}`,
    `随机种子：${entropy}`,
  ];

  if (referenceContext) {
    lines.push("");
    lines.push("=== 学生错题/笔记参考资料（重点！请基于这些资料针对性出题）===");
    lines.push("请根据以下学生的错题和笔记，出一些能帮助弥补其知识短板的题目。");
    lines.push("可以考虑：同类题型的变式、错误类型的针对性练习、或笔记中知识点的拓展应用。");
    lines.push("");
    lines.push(referenceContext);
  }

  if (existingProblems.length > 0) {
    lines.push("");
    lines.push("=== 已有题目列表（严禁与以下题目重复或雷同）===");
    lines.push("以下是本批次之前已经生成的题目，你必须确保新题目与它们在知识点侧重、函数主体、解题切入角度上完全不同：");
    existingProblems.forEach((p, idx) => {
      lines.push(`题目${idx + 1}：${p.question}`);
    });
  }

  lines.push("");
  lines.push("=== 特别禁止（本批次内）===");
  lines.push("- 禁止两道题函数主体相同。");
  lines.push("- 禁止两道题答案形式完全相同。");
  lines.push("- 禁止套用教材原始例题数据。");
  lines.push("- 禁止连续两题使用同一解题切入角度。");
  lines.push("");
  lines.push(`请输出 ${count} 道题目题干的 JSON 数组（只含 id、question、options，不含 answer 和 explanation）。`);

  return lines.join("\n");
}

/** 构建"已有题目"上下文段落，用于逐题累积注入到后续请求 */
export function buildExistingProblemsContext(problems: MathProblem[]): string {
  if (problems.length === 0) return "";
  const lines = [
    "=== 本批次已生成的题目（你必须严格避免新题与以下任何一道重复或雷同）===",
  ];
  problems.forEach((p, idx) => {
    lines.push(`第${idx + 1}题：${p.question}`);
    if (p.options && p.options.length > 0) {
      lines.push(`  选项：${p.options.join(" / ")}`);
    }
  });
  return lines.join("\n");
}

// ====== 阶段 2：解析生成 Prompt ======

/** 解析生成系统提示词 */
export function buildExplanationSystemPrompt(): string {
  return [
    "你是一位耐心、专业的数学辅导老师，擅长用清晰易懂的方式为学生答疑解惑。",
    "",
    "【你的任务】",
    "学生会给你一道或多道数学题目，请你逐一作答。",
    "",
    "【回答原则】",
    "1. 先给出本题的正确答案。",
    "2. 然后分步骤展示完整的推导过程，帮助学生理解思路而非仅给结论。",
    "3. 适当指出常见错误和易混淆点。",
    "4. 所有数学公式必须使用 LaTeX 语法：行内用 $...$，块级用 $$...$$。",
    "5. 回答要简洁有条理，避免冗余重复。",
    "6. 如果有多道题目，请用 --- 分隔每道题的解答。",
  ].join("\n");
}

/** 解析生成 user prompt */
export function buildExplanationUserPrompt(stems: MathProblem[]): string {
  const stemsText = stems.map((s, idx) => {
    let text = `题目 ${idx + 1}：${s.question}`;
    if (s.options && s.options.length > 0) {
      text += "\n选项：" + s.options.map((opt, i) => `${String.fromCharCode(65 + i)}. ${opt}`).join("　");
    }
    return text;
  }).join("\n\n");

  return [
    "请为以下题目逐一作答，给出正确答案和完整解题过程：",
    "",
    stemsText,
  ].join("\n");
}
