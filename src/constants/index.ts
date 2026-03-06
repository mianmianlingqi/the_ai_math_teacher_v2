/**
 * constants.ts  桶文件（Barrel）
 *
 * Why: 原 390 行文件混合了 3 类静态数据，拆分后保留此入口
 *      确保所有现有 import 路径无需修改（零破坏性）。
 *
 * 依赖方向：
 *   constants/uiOptions.ts    UI 枚举选项 + DEFAULT_CONFIG
 *   constants/curriculum.ts   章节列表 + 细分知识点
 *   constants/providers.ts    AI 供应商预设 + 默认配置
 */

export * from './uiOptions';
export * from './curriculum';
export * from './providers';
