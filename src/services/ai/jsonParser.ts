/**
 * jsonParser.ts
 *
 * 单一职责：AI 模型返回的 JSON 文本容错解析。
 *
 * 从 `aiService.ts` 抽离，作为纯函数模块，方便独立测试与增强。
 * 涵盖：<think> 剥离、code block 提取、LaTeX 反斜杠修复、裸换行转义、多轮回退 JSON.parse。
 */

import { LogEntry } from "@/types";

// ====== LaTeX 命令白名单 ======

const LATEX_COMMANDS = [
  'alpha', 'beta', 'gamma', 'delta', 'theta', 'lambda', 'mu', 'nu', 'pi', 'phi', 'psi', 'sigma',
  'frac', 'dfrac', 'tfrac', 'sqrt', 'sum', 'prod', 'int', 'iint', 'iiint', 'oint', 'lim',
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'ln', 'log',
  'left', 'right', 'begin', 'end', 'text', 'mathrm', 'mathbf', 'mathbb', 'mathcal', 'displaystyle',
  'cdot', 'times', 'div', 'pm', 'mp', 'leq', 'geq', 'neq', 'approx', 'infty', 'partial', 'nabla',
  'rightarrow', 'leftarrow', 'leftrightarrow', 'to', 'mapsto', 'because', 'therefore',
  'underline', 'overline', 'overrightarrow', 'hat', 'bar', 'vec', 'quad', 'qquad', 'boxed'
];

// ====== 类型定义 ======

export interface JsonParseResult {
  /** 解析后的数据（失败时为 null） */
  data: any;
  /** 是否解析成功 */
  success: boolean;
  /** 修复次数统计 */
  stats: {
    latexReplacements: number;
    retryCount: number;
  };
}

// ====== 辅助函数 ======

/**
 * 判断当前反斜杠是否属于合法且应保留的 JSON 转义。
 * 若是 LaTeX 命令的起始反斜杠，则返回 false，后续会自动补成双反斜杠。
 */
function shouldPreserveJsonEscape(nextChar: string, source: string, nextIndex: number): boolean {
  if (nextChar === '"' || nextChar === '\\' || nextChar === '/') {
    return true;
  }

  if (nextChar === 'u') {
    const unicodeBody = source.slice(nextIndex + 1, nextIndex + 5);
    if (/^[0-9a-fA-F]{4}$/.test(unicodeBody)) {
      return true;
    }
    return !isLikelyLatexCommand(source, nextIndex);
  }

  if (!'bfnrt'.includes(nextChar)) {
    return false;
  }

  return !isLikelyLatexCommand(source, nextIndex);
}

/**
 * 仅对白名单中的数学 LaTeX 命令做自动保护，避免误伤正常的 \n / \t 等 JSON 转义。
 */
function isLikelyLatexCommand(source: string, startIndex: number): boolean {
  const commandMatch = source.slice(startIndex).match(/^[A-Za-z]+/);
  if (!commandMatch) {
    return false;
  }

  const command = commandMatch[0].toLowerCase();
  return LATEX_COMMANDS.some((candidate) => command === candidate || command.startsWith(candidate));
}

/**
 * 在 JSON 字符串内部保护 LaTeX 反斜杠，避免 \frac / \right / \theta 等命令
 * 被 JSON.parse 误当成 \f / \r / \t 等转义序列吞掉。
 */
function protectLatexBackslashesInJson(text: string): { normalized: string; replacements: number } {
  let normalized = '';
  let inString = false;
  let replacements = 0;

  for (let index = 0; index < text.length; index += 1) {
    const currentChar = text[index];

    if (!inString) {
      normalized += currentChar;
      if (currentChar === '"') {
        inString = true;
      }
      continue;
    }

    if (currentChar === '"') {
      normalized += currentChar;
      inString = false;
      continue;
    }

    if (currentChar !== '\\') {
      normalized += currentChar;
      continue;
    }

    const nextChar = text[index + 1];
    if (!nextChar) {
      normalized += '\\\\';
      replacements += 1;
      continue;
    }

    if (shouldPreserveJsonEscape(nextChar, text, index + 1)) {
      normalized += currentChar + nextChar;
      index += 1;
      continue;
    }

    normalized += '\\\\';
    replacements += 1;
  }

  return { normalized, replacements };
}

/**
 * 仅转义 JSON 字符串内部的裸换行，避免误伤外层 JSON 排版。
 */
function escapeRawLineBreaksInJsonStrings(text: string): string {
  let normalized = '';
  let inString = false;

  for (let index = 0; index < text.length; index += 1) {
    const currentChar = text[index];

    if (!inString) {
      normalized += currentChar;
      if (currentChar === '"') {
        inString = true;
      }
      continue;
    }

    if (currentChar === '"') {
      normalized += currentChar;
      inString = false;
      continue;
    }

    if (currentChar === '\\') {
      normalized += currentChar;
      if (index + 1 < text.length) {
        normalized += text[index + 1];
        index += 1;
      }
      continue;
    }

    if (currentChar === '\n') {
      normalized += '\\n';
      continue;
    }

    if (currentChar === '\r') {
      normalized += '\\r';
      continue;
    }

    normalized += currentChar;
  }

  return normalized;
}

// ====== 核心函数 ======

/**
 * 多轮容错 JSON 解析。
 *
 * 自动处理模型常见的非标准输出：
 * 1. 剥离 <think>...</think> 推理标签
 * 2. 提取 markdown code block
 * 3. 截取 JSON 数组/对象主体
 * 4. 修复 LaTeX 反斜杠
 * 5. 修复字符串内裸换行
 * 6. 最多 4 轮回退 parse
 *
 * @param text   - 模型返回的原始文本
 * @param onLog  - 可选日志回调
 * @returns 解析后的 JS 对象，失败时返回空数组
 */
export function parseWithRetry(text: string, onLog?: (log: LogEntry) => void): any {
  let jsonString = text.trim();
  const stats = { latexReplacements: 0, retryCount: 0 };

  // 1. 剥离 <think> 标签（DeepSeek-R1 等推理模型常见）
  const thinkMatch = jsonString.match(/<think>[\s\S]*?<\/think>\s*([\s\S]*)/);
  if (thinkMatch) {
    jsonString = thinkMatch[1].trim();
  }

  // 2. 提取 markdown code block
  const codeBlockMatch = jsonString.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonString = codeBlockMatch[1].trim();
  }

  // 3. 截取 JSON 主体
  const arrayMatch = jsonString.match(/\[[\s\S]*\]/);
  const objectMatch = jsonString.match(/\{[\s\S]*\}/);

  if (arrayMatch) {
    jsonString = arrayMatch[0];
  } else if (objectMatch) {
    jsonString = objectMatch[0];
  }

  if (!jsonString || jsonString === '[]' || jsonString === '{}') {
    return [];
  }

  // 4. 修复 LaTeX 反斜杠
  const protectedJson = protectLatexBackslashesInJson(jsonString);
  stats.latexReplacements = protectedJson.replacements;

  if (protectedJson.replacements > 0 && onLog) {
    onLog({
      timestamp: new Date().toLocaleTimeString(),
      level: 'warn',
      message: `已自动修复 ${protectedJson.replacements} 处公式转义，避免 LaTeX 乱码。`,
      category: 'parse',
      suggestion: '若仍出现公式乱码，建议切换模型后重新生成。',
    });
  }

  // 5. 多轮回退解析
  const attempts: Array<() => any> = [
    () => JSON.parse(protectedJson.normalized),                                              // 第 1 轮
    () => JSON.parse(protectedJson.normalized.replace(/\\(?!["\\/bfnrtu])/g, "\\\\")),       // 第 2 轮：兜底双反斜杠
    () => JSON.parse(escapeRawLineBreaksInJsonStrings(protectedJson.normalized)),             // 第 3 轮：修复裸换行
    () => {
      const fixed = escapeRawLineBreaksInJsonStrings(protectedJson.normalized);
      return JSON.parse(fixed.replace(/\\(?!["\\/bfnrtu])/g, "\\\\"));                       // 第 4 轮：组合修复
    },
  ];

  for (const attempt of attempts) {
    try {
      stats.retryCount++;
      return attempt();
    } catch {
      // 当前轮失败，继续下一轮
    }
  }

  // 全部失败
  console.error("JSON 解析彻底失败，原始文本摘要:", jsonString.slice(0, 200));
  if (onLog) {
    onLog({
      timestamp: new Date().toLocaleTimeString(),
      level: 'warn',
      message: `模型返回了内容但未能解析出题目。`,
      category: 'parse',
      suggestion: '可能的原因：1) 模型输出了非 JSON 格式的文本；2) JSON 中的 LaTeX 公式导致了格式错误。建议更换模型重试。',
      details: '解析详情已隐藏（避免展示模型原始返回内容）。',
    });
  }
  return [];
}

/**
 * 检查 JSON 边界是否完整（用于异常检测——截断判定）。
 *
 * @param text - 待检查的文本
 * @returns true 表示 JSON 括号/引号配对完整
 */
export function isValidJsonBoundary(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();

  // 检查括号配对
  let braceDepth = 0;
  let bracketDepth = 0;
  let inString = false;
  let prevChar = '';

  for (const ch of trimmed) {
    if (inString) {
      if (ch === '"' && prevChar !== '\\') {
        inString = false;
      }
      prevChar = ch;
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      braceDepth++;
    } else if (ch === '}') {
      braceDepth--;
    } else if (ch === '[') {
      bracketDepth++;
    } else if (ch === ']') {
      bracketDepth--;
    }

    if (braceDepth < 0 || bracketDepth < 0) return false;
    prevChar = ch;
  }

  return !inString && braceDepth === 0 && bracketDepth === 0;
}

/**
 * 检测文本中的无限重复模式。
 *
 * @param text      - 待检测文本
 * @param minRepeat - 最少重复次数（默认 3）
 * @param minLen    - 重复段落最小长度（默认 50）
 * @returns 检测到的最大重复次数
 */
export function detectRepetition(
  text: string,
  opts: { minRepeat?: number; minLen?: number } = {}
): number {
  const { minRepeat = 3, minLen = 50 } = opts;
  if (!text || text.length < minLen) return 0;

  let maxRepeat = 0;
  const maxWindow = Math.floor(text.length / minRepeat);

  for (let window = minLen; window <= maxWindow; window += 10) {
    for (let i = 0; i <= text.length - window * 2; i++) {
      const segment = text.slice(i, i + window);
      let count = 1;
      let pos = i + window;

      while (pos + window <= text.length && text.slice(pos, pos + window) === segment) {
        count++;
        pos += window;
      }

      maxRepeat = Math.max(maxRepeat, count);
      if (maxRepeat >= minRepeat) return maxRepeat; // 早停
    }
  }

  return maxRepeat;
}
