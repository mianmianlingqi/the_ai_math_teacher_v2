
import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import { GenerateConfig, MathProblem, LogEntry, Difficulty, QuestionType, QBankItem, Syllabus } from "@/types";
import { endUsageRequest, estimateTokensFromText, extractOpenAIUsage, startUsageRequest } from "./devUsageTracker";

export class MathAIService {
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }
  
  // Update the apiKey when the user changes it
  updateApiKey(apiKey: string) {
      if (apiKey) {
          this.ai = new GoogleGenAI({ apiKey });
      }
  }

  private getDifficultyGuidance(difficulty: Difficulty): string {
    switch (difficulty) {
      case Difficulty.EASY:
        return "【基础巩固】：侧重核心概念的直接应用，数值简洁，逻辑清晰。";
      case Difficulty.MEDIUM:
        return "【中坚拔高】：包含知识点嵌套，需要中等程度的化简或构造，接近考试真题中后段水平。";
      case Difficulty.HARD:
        return "【竞赛/压轴】：涉及深层抽象思维、多步推导或不常用的数学技巧，设置精巧的陷阱。";
      default:
        return "";
    }
  }

  async generateProblems(config: GenerateConfig, onLog: (log: LogEntry) => void): Promise<MathProblem[]> {
    const { syllabus, difficulty, questionType, chapter, topic, count } = config;

    onLog({
      timestamp: new Date().toLocaleTimeString(),
      level: 'info',
      message: `正在为 [${syllabus}] 的 [${chapter}] 章节生成 [${count}道] 多样化 [${questionType}]...`,
    });

    // 引入随机性：通过时间戳和随机数生成一个伪随机扰动字符串
    const entropy = (Math.random() * 10000).toFixed(0) + Date.now();
     const requestPrompt = `你是一位极富创意的资深数学命题专家，正在为 [${syllabus}] 的学生编写全新的、不重样的试题集。

        【出题背景】
        - 章节：${chapter}
        - 题型：${questionType}
        - 难度：${difficulty} (${this.getDifficultyGuidance(difficulty)})
        - 数量：${count}
        - 额外要求：${topic || "综合考察章节核心内容"}
        - 随机种子标识：${entropy}

        【核心原则：深度推理与完美呈现】
        1. **先思考后输出**：在生成最终 JSON 之前，请务必在内心（或通过思考模型）完成完整的解题推导。确保计算结果 100% 正确。
        2. **思维路径（explanation）**：该字段应包含详细的解题逻辑、关键步骤和思维转折点。它不是简单的答案重复，而是引导学生理解“为什么这么做”。
        3. **LaTeX 规范**：
          - 所有数学符号、公式、变量（包括单个字母如 $x$, $y$, $a$）必须使用 LaTeX 格式。
          - 行内公式使用单美元符号包裹：$E = mc^2$。
          - 独立行公式使用双美元符号包裹：$$\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}$$。
          - **严禁**出现原始 LaTeX 源代码（如 \\frac{...}）未被包裹的情况。
          - **严禁**在 JSON 字符串中使用未转义的反斜杠。在 JSON 中，反斜杠必须写成 \\\\。
        4. **多样化切入点**：尝试从图像几何意义、物理背景或特殊的恒等式切入。
        5. **结构多变**：
          - 选择题干扰项必须反映常见的错误逻辑。
          - 计算题应设计需要先观察、再化简、后计算的题目。

        【生成规范】
        - 仅返回符合 schema 的 JSON 数组。`;
     const requestId = startUsageRequest({
      channel: 'gemini_generate',
      providerId: 'gemini-sdk',
      providerName: 'Gemini SDK',
      model: 'gemini-3-pro-preview',
     });
     const startTime = Date.now();

    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: requestPrompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                question: { type: Type.STRING, description: "题目文本，包含 LaTeX 公式" },
                options: { 
                  type: Type.ARRAY, 
                  items: { type: Type.STRING },
                  description: "若是选择题请提供4个选项（包含 LaTeX），否则为空数组"
                },
                answer: { type: Type.STRING, description: "最终答案，包含 LaTeX" },
                explanation: { type: Type.STRING, description: "详细的解题思维路径，包含 LaTeX" }
              },
              required: ["id", "question", "answer", "explanation"]
            }
          }
        }
      });

      const rawText = response.text || "[]";
      const usage = extractOpenAIUsage((response as any).usageMetadata || (response as any).usage);
      const finalizedUsage = usage.totalTokens
        ? usage
        : {
            promptTokens: estimateTokensFromText(requestPrompt),
            completionTokens: estimateTokensFromText(rawText),
            totalTokens: estimateTokensFromText(requestPrompt) + estimateTokensFromText(rawText),
            estimated: true,
          };

      endUsageRequest({
        requestId,
        success: true,
        latencyMs: Date.now() - startTime,
        usage: finalizedUsage,
      });

      const problems: MathProblem[] = JSON.parse(rawText).map((p: any) => ({
        ...p,
        suggestedErrorTypes: [],
        difficulty,
        syllabus,
        questionType
      }));

      onLog({
        timestamp: new Date().toLocaleTimeString(),
        level: 'info',
        message: `产出成功：已基于 ${entropy.slice(-4)} 采样点生成了 ${problems.length} 道高变式题目。`,
      });

      return problems;
    } catch (error: any) {
      endUsageRequest({
        requestId,
        success: false,
        latencyMs: Date.now() - startTime,
        error: error?.message,
      });
      onLog({
        timestamp: new Date().toLocaleTimeString(),
        level: 'error',
        message: `生成失败：${error.message}`,
      });
      throw error;
    }
  }

  async scanImageToQuestion(imageBase64: string): Promise<Partial<QBankItem>> {
      // 1. 去除 data:image/png;base64, 前缀
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
      
      const prompt = `
      请分析这张图片，识别其中的数学题目，并将其转换为结构化的 JSON 数据。
      
      【要求】
      1. **题干 (question)**: 
         - 提取完整的题目描述。
         - 所有数学公式必须转换成标准的 LaTeX 格式（行内用 $...$, 独立行用 $$...$$）。
      2. **选项 (options)**: 
         - 如果是选择题，提取所有选项内容（不包含 A. B. C. D. 等前缀）。
         - 如果不是选择题，返回空数组。
      3. **题型 (questionType)**: 根据内容推断题型（选择题/填空题/计算题/证明题/应用题/综合题）。
      4. **答案 (answer)**: 如果图片中包含答案或解析，请提取；如果没有，请你自己**做一遍这道题**，给出正确答案。
      5. **解析 (explanation)**: 如果图片包含解析，请提取；如果没有，请你自己**详细撰写解析**，包含解题步骤和思维逻辑。
      6. **标签 (tags)**: 根据题目内容生成 3-5 个知识点标签。
      7. **难度 (difficulty)**: 预估题目难度。
      8. **来源备注 (sourceNote)**: 返回 "OCR 识别"。

      请直接返回 JSON 对象。
      `;
        const requestId = startUsageRequest({
          channel: 'gemini_vision',
          providerId: 'gemini-sdk',
          providerName: 'Gemini SDK',
          model: 'gemini-1.5-flash',
        });
        const startTime = Date.now();

      try {
          const response = await this.ai.models.generateContent({
              model: 'gemini-1.5-flash', // 使用视觉能力更强的 flash 模型，或者 pro
              contents: [
                  { 
                      role: 'user', 
                      parts: [
                          { text: prompt },
                          { inlineData: { mimeType: "image/jpeg", data: base64Data } }
                      ] 
                  }
              ],
              config: {
                  responseMimeType: "application/json",
                  responseSchema: {
                      type: Type.OBJECT,
                      properties: {
                          question: { type: Type.STRING },
                          options: { type: Type.ARRAY, items: { type: Type.STRING } },
                          questionType: { type: Type.STRING, enum: Object.values(QuestionType) },
                          answer: { type: Type.STRING },
                          explanation: { type: Type.STRING },
                          tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                          difficulty: { type: Type.STRING, enum: Object.values(Difficulty) },
                          syllabus: { type: Type.STRING, enum: Object.values(Syllabus) }
                      },
                      required: ["question", "options", "answer", "explanation"]
                  }
              }
          });

          const text = response.text;
      const usage = extractOpenAIUsage((response as any).usageMetadata || (response as any).usage);
      const finalizedUsage = usage.totalTokens
        ? usage
        : {
          promptTokens: estimateTokensFromText(prompt),
          completionTokens: estimateTokensFromText(text || ''),
          totalTokens: estimateTokensFromText(prompt) + estimateTokensFromText(text || ''),
          estimated: true,
        };

      endUsageRequest({
        requestId,
        success: true,
        latencyMs: Date.now() - startTime,
        usage: finalizedUsage,
      });

          if (text) {
              return JSON.parse(text);
          }
          throw new Error("模型未返回有效 JSON");

      } catch (error) {
      endUsageRequest({
        requestId,
        success: false,
        latencyMs: Date.now() - startTime,
        error: (error as any)?.message,
      });
          console.error("Image Scan Error:", error);
          throw error;
      }
  }
}

export const mathAIService = new MathAIService();
