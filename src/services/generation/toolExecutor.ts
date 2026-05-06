/**
 * toolExecutor.ts
 *
 * 单一职责：retract_problem 工具定义与匹配逻辑。
 */

export const RETRACT_PROBLEM_TOOL = {
  type: "function" as const,
  function: {
    name: "retract_problem",
    description: "当发现当前正在生成的数学题目存在以下问题时调用：题目条件矛盾导致无解、题目要求与其类型不匹配、题目存在逻辑错误、或题目无法在给定考纲/章节范围内正常解答。调用后系统将撤回该题并重新生成。",
    parameters: {
      type: "object" as const,
      properties: {
        reason: {
          type: "string" as const,
          description: "撤回原因",
          enum: ["条件矛盾无解", "题型不匹配", "内容逻辑错误", "超纲或不合要求", "其他问题"]
        },
        detail: {
          type: "string" as const,
          description: "对问题的详细描述，帮助系统在下一次生成时避免同类问题"
        }
      },
      required: ["reason", "detail"]
    }
  }
};

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/** 检查 tool_calls 中是否包含 retract_problem */
export function hasRetractCall(toolCalls?: ToolCall[]): ToolCall | undefined {
  return toolCalls?.find(tc => tc.name === 'retract_problem');
}
