# 出题链路重构规格说明书

> 状态：已决策，v2.0  
> 版本：v2.0  
> 日期：2026-05-07  
> 作者：Kilo  
> 决策人：mianmianlingqi  

**v2.0 核心能力**：推理深度控制 + Tool-Calling 模型自检 + 95% 去重 + 逐题上下文累积 + 模型调用异常检测与自动恢复

---

## 一、背景

当前出题链路从「用户点击按钮」到「页面展示题目」跨越 1636 行 `aiService.ts` + 585 行 `useGenerateProblems.ts` + 604 行 `App.tsx`，超 2800 行业务代码。链路承载单模型两阶段、双模型四阶段、串并行调度、题干占位替换、去重、重试补位、网关预热等交叉职责。

核心问题：
1. 新成员难以一天内理解完整流程
2. 修改一个行为需同时改动 Hook 和 Service 两层
3. 大量逻辑仅在单路径使用，但其他路径被迫携带同等复杂度
4. `MathProblem` 被同时当作最终结果和临时占位符，UI 需判断魔法字符串

---

## 二、重构目标

1. **核心链路可读性**：新人 20 分钟画出完整调用图
2. **最小实体原则**：不新增领域实体/类型/抽象层——只做减法。推理和工具通过配置参数传递
3. **消除幽灵代码**：移除未实际使用的模式分支、prompt、流式回调
4. **收敛职责边界**：Hook=UI 状态绑定，Service=纯业务编排，Provider=网络+工具执行
5. **不改变用户可见行为**：参数选择、进度展示、题卡、解析样式保持一致
6. **v2.0 新增**：推理深度、Tool-Calling 自检、解析验证闭环、95% 去重、上下文累积、异常检测恢复

---

## 三、非目标

- ❌ 不修改 `MathProblem` / `ProblemCard` / 常量
- ❌ 不新增 npm 依赖
- ❌ 不变更 API 接口（推理+工具通过现有字段传递）
- ❌ 不动组卷/题库/错题本/笔记/聊天
- ⚠️ `GenerateConfig` 轻微扩展「推理深度」可选字段

---

## 四、设计原则

### 原则 1：如无必要，勿增实体

任何新增抽象层/中间类型/工具函数，先问：「没有它，能否完成？」能就砍掉。

### 原则 2：一个函数做好一件事

当前 `generateOne` 约 190 行做 5+ 件事。拆成单职责函数，每个 < 40 行。

### 原则 3：失败可重试，原因必须记录

`return []` 吞错误 → 上层不知原因。新设计 `return null` + 日志回调记录每次失败原因。

### 原则 4：逐题产出，每道完整交付

「生成一道，展示一道」但**每道展示前必须是完整结果**（题干+解析+去重+自检全通过）。UI 永远不接触半成品。

### 原则 5：模型自检优于后置规则

两层自检：
1. **Tool-Calling**：模型可调 `retract_problem` 主动撤回
2. **答案验证**：解析生成即验证可解性——模型答不出来=题有问题，自动撤回重试

### 原则 6：上下文随生成累积

每成功一道即追加到后续 prompt，第 5 题已「看过」前 4 题，天然防重复。

### 原则 7：异常必须检测，不可让系统假死

模型输出截断、无限重复、静默超时、Tool-Calling 死循环等都是生产环境真实风险。每种异常须有明确检测算法和自动恢复策略。

---

## 五、当前链路痛点

| 问题 | 位置 | 严重 |
|------|------|------|
| `generateOne` 闭包 190 行职责过载 | `useGenerateProblems.ts:312-500` | 🔴 |
| `MathProblem` 被当占位符，`explanation='解析生成中...'` | `useGenerateProblems.ts:347-354` | 🔴 |
| 双模型四阶段 ~130 行从未稳定使用 | `aiService.ts:992-1127` | 🟡 |
| 并行专用变量污染串行路径 | `useGenerateProblems.ts:238,331,504-533` | 🟡 |
| `onStemsReady` 导致 3 层穿透+半成品 UI | `aiService.ts:944`→Hook→UI | 🟡 |
| 流式参数始终传 `undefined` | `aiService.ts:861-862` | 🟢 |
| SSE 流式实现从未用于出题 | `aiService.ts:586-843` | 🟢 |
| 补位逻辑与并行/双模型耦合 | `useGenerateProblems.ts:504-533` | 🟡 |
| ❌ 无模型异常检测（截断/重复/死循环） | — | 🔴 |

---

## 六、目标架构

### 6.1 核心理念

> 出题质量的上限由模型能力决定。系统职责是给模型最好的环境——注入完整上下文、赋予自检工具、累积已出题目记忆，让模型每次生成时都有充分信息。每道题经历**生成题干→Tool-Calling自检→生成解析(验证可解性)→异常检测→95%去重**五个关卡。

路径：**单模型串行 + 推理深度可配 + Tool-Calling自检 + 答案验证闭环 + 异常检测恢复 + 上下文累积**。

### 6.2 推理模式配置

```typescript
// ReasoningConfig（AIProviderConfig 扩展 optional 字段）
{
  mode: 'disabled' | 'enabled' | 'auto',  // 推理模式
  budget?: number  // 推理预算 tokens，默认 4096，仅 mode='enabled' 时生效
}
```

请求时映射：
```json
{ "thinking": { "type": "enabled", "budget_tokens": 4096 } }
```

用户可在设置面板控制「推理开关」和「推理深度」两个参数。

### 6.3 `retract_problem` 工具定义

```typescript
const RETRACT_PROBLEM_TOOL = {
  type: "function",
  function: {
    name: "retract_problem",
    description: "题目条件矛盾导致无解、题型不匹配、逻辑错误或超纲时调用。系统将撤回该题重新生成。",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", enum: ["条件矛盾无解","题型不匹配","内容逻辑错误","超纲或不合要求","其他问题"] },
        detail: { type: "string", description: "详细描述，帮助下次生成避坑" }
      },
      required: ["reason", "detail"]
    }
  }
};
```

`retract_problem` 是单向信号——系统检测到后直接重试，不向模型回传 tool result。

### 6.4 模块划分

```
src/
├── hooks/
│   └── useGenerateProblems.ts       ← 重构：UI 状态绑定（<80行）
├── services/
│   ├── generation/
│   │   ├── generateProblems.ts      ← 新增：编排+上下文累积
│   │   ├── generateOneProblem.ts    ← 新增：单题+自检+异常检测+去重
│   │   └── toolExecutor.ts          ← 新增：retract_problem 工具
│   └── ai/
│       ├── aiService.ts             ← 精简：网络+工具调用+JSON解析
│       ├── jsonParser.ts            ← 新增：parseWithRetry 独立模块
│       └── prompts.ts               ← 新增：prompt 集中管理
```

### 6.5 各模块职责

#### A. `useGenerateProblems`（Hook）

绑定 `generateProblems()` 输出到 React 状态。≤80 行，无 if/else 分支。

#### B. `generateProblems`（编排层）

```typescript
async function generateProblems(config, aiService, callbacks): Promise<MathProblem[]> {
  const accepted: MathProblem[] = [];
  let success = 0, dispatch = 0;
  const maxDispatch = config.count * MAX_SUPPLEMENT;
  const systemPrompt = buildSystemPrompt(config);

  while (success < config.count && dispatch < maxDispatch) {
    dispatch++;
    const ctx = buildExistingProblemsContext(accepted);  // 上下文累积
    const result = await generateOneProblem(config, systemPrompt, ctx, aiService);
    if (result) {
      accepted.push(result);
      success++;
      callbacks.onProblemReady(result);  // 完整题目交付 UI
      callbacks.onProgress(success, config.count);
    }
  }
  return accepted;
}
```

#### C. `generateOneProblem`（单题+双重自检+异常检测）

```typescript
async function generateOneProblem(config, systemPrompt, existingCtx, aiService): Promise<MathProblem | null> {
  for (let attempt = 0; attempt < 3; attempt++) {

    // === 阶段1：生成题干（带 Tool-Calling） ===
    const stemResult = await aiService.generateStemsWithTools(config, systemPrompt, existingCtx, TOOL);
    if (stemResult.toolCalls?.some(tc => tc.name === 'retract_problem')) {
      log('warn', `模型自检撤回(${reason})`);
      if (attempt >= 2) { log('warn','连续3次撤回，死循环'); return null; }
      continue;
    }
    if (stemResult.problems.length === 0) continue;

    // === 题型校验 ===
    try { enforceQuestionType(stem, config.questionType); } catch { continue; }

    // === 阶段2：生成解析（验证可解性） ===
    let explanation;
    try {
      explanation = await aiService.generateExplanation(stem);
      if (!explanation || explanation.length < 20) {
        log('warn','解析过短→不可解'); continue;
      }
    } catch {
      log('warn','解析失败→不可解'); continue;
    }

    // === 阶段3：异常检测 ===
    if (detectRepetition(explanation, { minRepeat:3, minLen:50 }) >= 3) {
      log('warn','检测到无限重复'); continue;
    }

    // === 阶段4：95%去重 ===
    if (checkSimilarity(fullProblem, existingProblems) >= 0.95) {
      log('warn','去重≥95%'); continue;
    }

    return fullProblem;
  }
  return null;
}
```

**4 道防线**：
| 防线 | 检测 | 触发 | 处理 |
|------|------|------|------|
| 1 | Tool-Calling 撤回 | 模型调 `retract_problem` | 重试；3次=死循环→跳过 |
| 2 | 解析即验证 | 解析失败/空/过短 | 重试 |
| 3 | 异常检测 | 无限重复/截断/超时/空响应 | 重试或跳过 |
| 4 | 95%去重 | 相似度≥0.95 | 重试 |

#### D. `aiService`（Provider 层）

对外方法：
- `generateStemsWithTools()` — 题干生成（带 tools + thinking）
- `generateExplanation()` — 解析生成
- `buildThinkingParam()` — 推理参数
- `fetchModelCompletion()` — 网络请求（内部）

#### E. `prompts.ts`

集中当前散落的 ~10 个 prompt 函数：`buildSystemPrompt`、`buildStemUserPrompt`、`buildExplanationPrompt`、`buildExistingProblemsContext` 等。内容不变，仅迁移。

### 6.6 数据流

```
点击按钮 → useGenerateProblems.handleGenerate()
  │
  ▼
generateProblems()
  ├─ buildSystemPrompt(config)  ← 注入规则+参考资料
  └─ while success < target:
       ├─ buildExistingProblemsContext(accepted)  ← 上下文累积
       ▼
     generateOneProblem()
       │  for attempt 0..2:
       │    ├─ generateStemsWithTools(thinking+tools)
       │    ├─ [防线1] toolCalls? → 死循环检测 → 重试/跳过
       │    ├─ enforceQuestionType()
       │    ├─ generateExplanation()
       │    ├─ [防线2] 解析失败? → 重试
       │    ├─ [防线3] 异常检测(重复/截断/超时)? → 重试/跳过
       │    └─ [防线4] checkSimilarity() ≥95%? → 重试
       │
       ├─ result→ accepted.push() + onProblemReady()
       └─ null→ while自动补位
  ▼
返回 MathProblem[] → UI渲染
```

### 6.7 Tool-Calling 交互协议

```
系统侧 POST /chat/completions { messages, tools:[retract_problem], thinking }
  ──────────────────────────────────────────────────────→ 模型侧
  ← ResponseA: { message.content: "[{JSON题干}]" }      → 正常，进入解析阶段
  ← ResponseB: { message.tool_calls: [{retract_problem}] } → 撤回，重试(≤3次)
  ← ResponseC: 异常(空/截断/重复/超时)                   → 异常检测，重试或跳过

解析阶段 POST /chat/completions { messages: "请解答:{题干}" }
  ──────────────────────────────────────────────────────→
  ← Response: { content: "答案+过程" }                   → ≥20字符=有效 → 接受
  ← Response: 空/失败/过短                               → 不可解 → 重试
```

### 6.8 95% 去重

```typescript
const DEDUP_THRESHOLD = 0.95;

function checkSimilarity(problem, existing): number {
  let max = 0;
  for (const ep of existing) {
    const r = checkProblemNearDuplicate(problem, [ep], { threshold: DEDUP_THRESHOLD });
    max = Math.max(max, r.score);
  }
  return max;
}
```

从布尔判断改为0~1分数，编排层统一用0.95阈值决策。

### 6.9 模型调用异常检测与自动恢复

#### 异常分类

| 类型 | 症状 | 检测 | 严重 |
|------|------|------|------|
| **输出截断** | JSON未闭合、内容不完整 | `parseWithRetry` 最终失败 或 `explanation.length<20` | 🔴 |
| **无限重复** | 连续输出相同文本段 | ≥3次重复≥50字符子串 | 🔴 |
| **静默超时** | 长时间无数据返回 | `AbortController` 超时 | 🔴 |
| **空响应** | `content=""` 或 choices 空 | `content.length===0` | 🟡 |
| **Tool死循环** | 连续N次调 `retract_problem` | 同调度内 ≥3次 | 🟡 |

#### 处理决策树

```
每次请求后检查:
  1. 静默超时? → abort → log → continue
  2. 空响应?   → log → continue
  3. 输出截断? → log → continue（不浪费parseWithRetry）
  4. 无限重复? → abort → log → continue
  5. Tool死循环? → log → return null（不重试，由编排层补位）
```

#### 重复检测算法

```typescript
function detectRepetition(text, { minRepeat, minLen }): number {
  if (!text || text.length < minLen) return 0;
  let max = 0;
  for (let w = minLen; w <= text.length / minRepeat; w += 10) {
    for (let i = 0; i <= text.length - w*2; i++) {
      const seg = text.slice(i, i + w);
      let count = 1, pos = i + w;
      while (pos + w <= text.length && text.slice(pos, pos + w) === seg) { count++; pos += w; }
      max = Math.max(max, count);
      if (max >= minRepeat) return max;
    }
  }
  return max;
}
```

#### 超时策略分级

| 阶段 | 超时 | 原因 |
|------|------|------|
| 题干(无推理) | 60s | 普通 JSON |
| 题干(推理) | 120s | 推理需时 |
| 解析 | 90s | 解答比出题长 |
| idle 超时 | 45s | 无 token 即卡死 |

每次请求独立 `AbortController`，单题超时不影嘈整批。

---

## 七、明确移除

| 移除项 | 位置 | 原因 |
|--------|------|------|
| `generateDualStage()` + 6 prompt | `aiService.ts:237-327,992-1127` | 从未稳定使用 |
| `parallelMode` 分支+UI | `useGenerateProblems.ts:504-533`, `App.tsx:410-415` | 移除并行 |
| `acceptedProblemsInBatch` | `useGenerateProblems.ts:238-239` | 并行专用 |
| `earlyShownStemIds` | `useGenerateProblems.ts:331` | 无半成品 |
| `onStemsReady` | `aiService.ts:856` | `onProblemReady` 替代 |
| `onExplanationStream` | `aiService.ts:861-862` | 幽灵参数 |
| `fetchStreamCompletion()` | `aiService.ts:586-843` | 出题不用流式 |
| `isExplanationStreaming` 使用 | `ProblemCard.tsx:60-62` | 无流式半成品 |

**明确保留**：`parseWithRetry` 全容错（→jsonParser.ts）、`MAX_SUPPLEMENT` 补位、`checkProblemNearDuplicate`（留作基础）、`fetchModelCompletion`（扩 tools+thinking）

---

## 八、冻结范围

| 冻结项 | 原因 |
|--------|------|
| `App.tsx` UI 配置面板 | 与业务逻辑无关 |
| `ProblemCard` / `GeneratingCard` | 数据接口不变 |
| `ReferenceSelector` / `useProviderConfig` / `backendApi` | 独立职责 |
| `storage/cache.ts` / `diversity.ts` | 保留复用 |
| 对话/组卷/题库/错题本/笔记 | 不同功能域 |
| 所有类型定义 | 保持模型稳定 |

---

## 九、迁移方案（五阶段）

### 阶段1：基础设施抽取（1天）
1. `parseWithRetry` → `jsonParser.ts`
2. prompt → `prompts.ts`
3. 删除双模型链路+SSE流式
4. `npm run lint && build`

### 阶段2：新生成核心（1天）
1. `toolExecutor.ts` — retract_problem 定义
2. `generateOneProblem.ts` — 含自检+异常检测
3. `generateProblems.ts` — 含上下文累积
4. `aiService.generateStemsWithTools()`
5. `fetchModelCompletion` 扩展 tools+thinking
6. 单元测试

### 阶段3：UI推理配置（0.5天）
1. 推理开关+深度滑块
2. 持久化

### 阶段4：替换Hook（0.5天）
1. 重写 `useGenerateProblems.ts`
2. 移除 `parallelMode` UI
3. 冒烟测试

### 阶段5：清理+文档（0.5天）
1. 删旧代码
2. 更新注释
3. 提交PR

**总工期**：3.5天

---

## 十、验收标准

### 功能验收
- [ ] 1/3/5 道题均可成功生成，进度条正确
- [ ] 每道题完整后才显示，不出现「解析生成中...」
- [ ] 推理开关映射 `thinking` 字段正确
- [ ] 推理深度正确映射 `budget_tokens`
- [ ] Tool-Calling 撤回 → 日志记录 → 自动重试
- [ ] 解析失败 → 判定不可解 → 自动重试
- [ ] 无限重复 → 自动检测 → abort → 重试
- [ ] JSON截断 → 自动检测 → 重试
- [ ] 静默超时 → abort → 重试
- [ ] Tool死循环3次 → 跳过该题 → 补位
- [ ] 95%去重：同批题目两两相似度<95%
- [ ] 上下文累积：第3题prompt可见前2题
- [ ] 可与组卷/题库正常交互
- [ ] 刷新后恢复最近题目

### 技术验收
- [ ] `useGenerateProblems.ts` ≤ 80行
- [ ] `generateProblems.ts` ≤ 80行
- [ ] `generateOneProblem.ts` ≤ 80行（含异常检测）
- [ ] `toolExecutor.ts` ≤ 40行
- [ ] `prompts.ts` ≤ 300行
- [ ] `aiService` 出题方法 ≤ 4个
- [ ] 零新增类型定义
- [ ] `npm run lint && npm run build` 通过

---

## 十一、风险

| 风险 | 缓解 |
|------|------|
| 首题慢 2-5s（等解析完成） | 可接受：免除占位替换复杂度 |
| 串行比并行慢 | 可接受：单题3-8s，5题≈25-40s |
| 无大小模型协作 | 可接受：单模型 JSON 稳定性已够 |
| 补位极端耗时长 | 上限系数5足够；可加总超时 |
| 异常检测误判（重复检测） | `minRepeat=3, minLen=50` 参数可调 |

---

## 十二、已决策问题

| # | 问题 | 决策 |
|---|------|------|
| 1 | 是否逐题完整交付（非半成品） | ✅ 接受：不允许 UI 接触半成品，但保持逐题展示 |
| 2 | 是否单模型串行为唯一路径 | ✅ 接受：移除并行+双模型 |
| 3 | 是否失败即终止整批 | ❌ 不接受：必须补位凑满 |
| 4 | 是否精简 JSON 容错 | ❌ 不接受：全保留+增强，独立为模块 |

---

## 十三、决策汇总

| 决策 | 结论 | 代码影响 | UX 影响 |
|------|------|---------|---------|
| 逐题完整交付 | ✅ | 砍占位替换 ~60行 | 首题慢2-5s，但出来即完整 |
| 单模型串行 | ✅ | 砍并行~40+双模型~136行 | 速度变慢但稳定 |
| 失败补位 | ✅ | 保留补位循环 ~30行 | 极端情况仍能凑满 |
| JSON容错增强 | ✅ | 全留~70行+独立模块 | 解析成功率更高 |

**代码量预估**：
- 删除合计：~540 行（双模型160+并行40+占位60+SSE250+幽灵30）
- 新增合计：~650 行（prompts 300+编排80+单题80+jsonParser 80+toolExecutor 40+异常检测30+aiService 扩展40）
- **净增 ~110 行，但无一行幽灵代码，结构从网状变为分层**

---

## 十四、文件清单

| 文件 | 当前 | 重构后 | 类型 |
|------|------|--------|------|
| `useGenerateProblems.ts` | 585 | ~80 | 重写 |
| `aiService.ts` | 1636 | ~1100 | 删减+扩展 |
| `prompts.ts` | 0 | ~300 | 新增 |
| `jsonParser.ts` | 0 | ~80 | 新增 |
| `generateProblems.ts` | 0 | ~80 | 新增 |
| `generateOneProblem.ts` | 0 | ~80 | 新增 |
| `toolExecutor.ts` | 0 | ~40 | 新增 |
| `App.tsx` | 604 | ~590 | 微调 |

---

> v2.0 spec 所有决策已确认。输入「开始重构」按五阶段方案执行。
