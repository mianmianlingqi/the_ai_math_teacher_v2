
export enum Syllabus {
  POSTGRADUATE = '考研数学',
  UNDERGRADUATE_TRANSITION = '专升本数学',
  GAOKAO = '高考数学'
}

export enum Difficulty {
  EASY = '较简单',
  MEDIUM = '中等',
  HARD = '较难'
}

export enum QuestionType {
  CHOICE = '选择题',
  FILL_BLANK = '填空题',
  CALCULATION = '计算题',
  PROOF = '证明题',
  APPLICATION = '应用题',
  COMPREHENSIVE = '综合题'
}

// 基础错误类型作为建议，但现在支持字符串以实现无限扩展
export const DEFAULT_ERROR_TYPES = [
  '计算错误', '概念模糊', '逻辑不严密', '审题不清', '技巧缺失', '公式误用', '负号遗漏', '系数遗漏'
];

export interface MathProblem {
  id: string;
  question: string;
  options?: string[];
  answer: string;
  explanation: string;
  difficulty: Difficulty;
  syllabus: Syllabus;
  questionType: QuestionType;
  suggestedErrorTypes: string[]; // AI 预设的可能错误类型
}

export interface WrongProblemFolder {
  id: string;
  name: string;
  parentId?: string;  // 父文件夹 ID，undefined 表示根级别
  createdAt: number;
}

export const DEFAULT_FOLDER_ID = 'default';
export const DEFAULT_FOLDER: WrongProblemFolder = {
  id: DEFAULT_FOLDER_ID,
  name: '根目录',
  createdAt: 0
};

export interface WrongProblem extends MathProblem {
  addedAt: number;
  errorType: string; // 改为 string 以支持自定义
  folderId: string;  // 所属文件夹 ID
  userNote?: string;
}

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'error' | 'warn' | 'debug' | 'success';
  message: string;
  details?: any;
  category?: 'network' | 'parse' | 'config' | 'model' | 'system';  // 错误分类
  suggestion?: string;  // 修复建议
}

export interface GenerateConfig {
  syllabus: Syllabus;
  difficulty: Difficulty;
  questionType: QuestionType;
  chapter: string;
  topic: string;
  count: number;
  /** 出题参考资料（错题 / 笔记的文本摘要） */
  referenceContext?: string;
}

// ===== 多供应商支持 =====

export interface AIProviderConfig {
  id: string;               // 唯一标识，如 'openai', 'deepseek', 'custom'
  name: string;             // 显示名称
  baseURL: string;          // API 基础地址
  apiKey: string;           // API 密钥
  model: string;            // 模型名称
  maxTokens?: number;       // 最大输出 token 数
  temperature?: number;     // 温度参数
  timeout?: number;         // 超时时间（秒）
  backendProvider?: string; // 若设置，表示通过后台代理此供应商（不直接暴露 Key）
}

export interface DualModelConfig {
  enabled: boolean;
  provider: AIProviderConfig | null;
}

export interface ProviderPreset {
  id: string;
  name: string;
  baseURL: string;
  defaultModel: string;
  models: string[];     // 推荐模型列表
  website: string;      // 获取 API Key 的网站
}

// ===== AI 答疑对话 =====

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  /** 本条回答实际使用的模型信息（assistant 消息） */
  modelLabel?: string;
  /** Base64 编码的图片（视觉答疑用） */
  image?: string;
  /** 上传的单个文件（兼容旧字段） */
  fileAttachment?: {
    name: string;
    type: string;
    size: number;
    encoding?: string;
    textContent?: string;
    truncated?: boolean;
  };
  /** 上传的多个文件（文本内容会被作为上下文发送） */
  fileAttachments?: Array<{
    name: string;
    type: string;
    size: number;
    encoding?: string;
    textContent?: string;
    truncated?: boolean;
  }>;
  /** 引用的题目（可选） */
  referencedProblem?: {
    question: string;
    answer: string;
    explanation: string;
    source: string; // e.g. "当前页 #3" or "错题本/高数错题/计算错误"
  };
}

export interface ChatConfig {
  provider: AIProviderConfig;
}

// ===== 视觉识别模型配置 =====

export interface VisionConfig {
  provider: AIProviderConfig;
}

// ===== 笔记本系统 =====

export interface NoteFolder {
  id: string;
  name: string;
  parentId?: string;  // 父文件夹 ID，undefined 表示根级别
  createdAt: number;
}

export const DEFAULT_NOTE_FOLDER_ID = 'note_default';
export const DEFAULT_NOTE_FOLDER: NoteFolder = {
  id: DEFAULT_NOTE_FOLDER_ID,
  name: '根目录',
  createdAt: 0
};

export interface NoteItem {
  id: string;
  title: string;
  content: string;         // 文字内容（支持多段）
  images: string[];        // Base64 图片数组
  folderId: string;        // 所属文件夹
  tags: string[];          // 自定义标签
  createdAt: number;
  updatedAt: number;
  /** 来源答疑消息 ID（用于标记某条 AI 回答已被收录） */
  sourceMessageId?: string;
}

// ===== 题库系统 =====

export interface QBankFolder {
  id: string;
  name: string;
  parentId?: string;  // 父文件夹 ID，undefined 表示根级别
  createdAt: number;
}

export const DEFAULT_QBANK_FOLDER_ID = 'qbank_default';
export const DEFAULT_QBANK_FOLDER: QBankFolder = {
  id: DEFAULT_QBANK_FOLDER_ID,
  name: '根目录',
  createdAt: 0
};

export type QBankSource = 'manual' | 'ai' | 'wrong_book' | 'image_scan';

export interface QBankItem {
  id: string;
  question: string;        // 题干（支持 LaTeX）
  options: string[];        // 选项（选择题时有值，否则空数组）
  answer: string;           // 答案（支持 LaTeX）
  explanation: string;      // 解析（支持 LaTeX）
  difficulty?: Difficulty;
  syllabus?: Syllabus;
  questionType?: QuestionType;
  tags: string[];           // 自定义标签
  folderId: string;         // 所属文件夹
  source: QBankSource;      // 来源
  sourceNote?: string;      // 来源备注（如"错题本/高数错题"或"AI生成 第3题"）
  images: string[];         // 附带的图片（如扫描原图）
  createdAt: number;
  updatedAt: number;
}

// ===== 参考资料选择（跨模块共享类型）=====

/** 用户在出题时选中的参考资料集合 */
export interface SelectedReferences {
  wrongProblemIds: string[];
  noteIds: string[];
  qbankIds: string[];
}

/** 空参考资料初始值（避免重复初始化字面量） */
export const EMPTY_REFERENCES: SelectedReferences = {
  wrongProblemIds: [],
  noteIds: [],
  qbankIds: [],
};
