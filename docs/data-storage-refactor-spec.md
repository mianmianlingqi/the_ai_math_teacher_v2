# 数据保存体制重构规格说明书

> 状态：设计中  
> 版本：v3.0  
> 日期：2026-05-07  
> 作者：Kilo  
> 决策人：mianmianlingqi

---

## 一、背景

当前数据保存体制全部依赖浏览器 `localStorage`（16 个独立 key），辅以 Vite 开发中间件实现的 AutoSave `.dat` 文件和 JSON 导出/导入作为备份兜底。这套体制在以下场景中暴露了严重局限：

| 问题 | 影响 |
|------|------|
| localStorage 5MB 上限 | 题库+错题+笔记+试卷+对话历史增长后必然超限 |
| 同步 API 阻塞 UI | 每次 `JSON.stringify` + `setItem` 阻塞主线程 |
| 无运行时 schema 校验 | 数据损坏静默传播，直到 UI 白屏 |
| 16 个独立 key 无事务 | 多表联写（如删文件夹+迁移条目）非原子，中途崩溃数据丢失 |
| 迁移逻辑散落各处 | `normalizeFolderCollection`、`normalizeCustomErrors`、`normalizeProviderConfig` 等在各模块重复出现 |
| 备份依赖 Vite 中间件 | Electron 打包后 (`app.isPackaged`) 本地 API 不再可用，AutoSave 功能失效 |
| adminConsoleStore 绕过 storageService | 直接操作 `window.localStorage`，不走统一存储层 |
| JSON 导出格式无 schema 版本 | v4.4 硬编码，升级字段靠手动 `importData` 逐字段迁移 |

**用户需求**：数据保存到 `AppData\Local\软件名\` 目录，每次数据变更后实时写入文件。

---

## 二、目标架构

### 2.1 核心理念

```
用户操作 → storageService API（不变）
              ↓
         DataStore（内存主副本 + 写后即持久化）
              ↓
         StorageAdapter（抽象接口，平台切换）
         ┌─────────┴──────────┐
   FileAdapter        IndexedDBAdapter
 (Electron desktop)   (Web 浏览器回退)
```

**原则**：
1. **内存主副本** — 所有读写操作在内存中完成（O(1) Map 查找），消除 localStorage 同步 I/O 阻塞
2. **写后即持久化** — 每次写操作立即触发异步文件写入（Electron）或 IndexedDB 写入（Web），保证数据不丢失
3. **schema 版本化** — 数据文件携带 `schemaVersion`，启动时自动执行迁移
4. **Zod 运行时校验** — 每次从持久层加载数据时校验结构完整性，损坏数据自动回退到上一份备份
5. **统一存储入口** — 所有模块（含 adminConsoleStore）统一通过 storageService 读写

### 2.2 平台适配

| 运行环境 | 持久化后端 | 数据目录 |
|---------|-----------|---------|
| Electron (开发) | `FileAdapter` → `userData/` | `%LOCALAPPDATA%\AI数学老师\` |
| Electron (打包) | `FileAdapter` → `userData/` | `%LOCALAPPDATA%\AI数学老师\` |
| Web (开发) | `IndexedDBAdapter` → IndexedDB | 浏览器 IndexedDB |
| Web (生产) | `IndexedDBAdapter` → IndexedDB | 浏览器 IndexedDB |

**选型理由**：
- **Electron 首选文件**：`app.getPath('userData')` 返回 `%LOCALAPPDATA%\<appname>\`，天然隔离、用户可见、易于备份
- **Web 回退 IndexedDB**：异步、结构化、支持索引、上限~250MB+（远超 localStorage 的 5MB）
- **不选 SQLite**：作为纯前端 Electron 项目，引入 native module 增加构建复杂度，IndexedDB + JSON 文件已满足需求

---

## 三、文件目录结构

### 3.1 Electron 桌面端

```
%LOCALAPPDATA%\AI数学老师\
├── data.json                    ← 主数据文件（实时更新）
├── data.backup.json             ← 上次写入成功的副本（原子写入保证）
├── backup\                      ← 定时自动备份（滚动保留）
│   ├── 2026-05-07T10-00-00.json
│   ├── 2026-05-07T09-55-00.json
│   └── ...（最多保留 10 份）
└── settings.json                ← 应用设置（可独立读写，减少 data.json 变更频率）
```

### 3.2 Web 浏览器端

```
IndexedDB: AI数学老师
├── ObjectStore: data             ← 主数据快照（单条记录）
├── ObjectStore: settings         ← 应用设置
└── ObjectStore: adminLogs        ← 管理员调试日志
```

---

## 四、数据模型

### 4.1 主数据结构 `AppData`

```typescript
interface AppData {
  /** Schema 版本号，用于自动迁移 */
  schemaVersion: number;  // 起始为 1

  /** 创建/更新时间 */
  createdAt: string;      // ISO 8601
  updatedAt: string;      // ISO 8601

  // ===== 错题本 =====
  wrongProblems: WrongProblem[];
  wrongFolders: WrongProblemFolder[];
  customErrors: Record<string, string[]>;  // folderId → errorType[]

  // ===== 笔记本 =====
  notes: NoteItem[];
  noteFolders: NoteFolder[];

  // ===== 题库 =====
  qbankItems: QBankItem[];
  qbankFolders: QBankFolder[];

  // ===== 试卷 =====
  examPapers: ExamPaper[];
  activeExamPaperId: string | null;

  // ===== AI 配置 =====
  providerConfig: AIProviderConfig | null;
  dualModelConfig: DualModelConfig | null;
  chatConfig: ChatConfig | null;
  visionConfig: VisionConfig | null;
  apiKeys: Record<string, string>;        // providerId → apiKey

  // ===== 应用设置 =====
  appUiSettings: AppUiSettings;

  // ===== 缓存 =====
  lastProblems: MathProblem[];
}
```

### 4.2 Schema 版本迁移链

```
v1 → v2 → v3 → ... → 当前版本
```

每次新增字段或修改类型时，增加 `schemaVersion`，注册迁移函数：

```typescript
const migrations: Record<number, (data: any) => any> = {
  2: (data) => {
    // 示例：v1→v2 为所有 QBankItem 添加 images 默认字段
    data.qbankItems.forEach((item: any) => {
      if (!Array.isArray(item.images)) item.images = [];
      if (!Array.isArray(item.options)) item.options = [];
    });
    return data;
  },
};
```

---

## 五、模块设计

### 5.1 文件总览

```
src/
├── services/
│   ├── storage/
│   │   ├── index.ts              ← storageService 门面（对外 API 不变）
│   │   ├── dataStore.ts          ← 内存主副本 + 读写 + 变更通知
│   │   ├── schema.ts             ← Zod schema 定义 + 类型推导
│   │   ├── migration.ts          ← 版本化迁移链
│   │   ├── adapter.ts            ← StorageAdapter 接口定义
│   │   ├── adapter.file.ts       ← FileAdapter（Electron）
│   │   ├── adapter.idb.ts        ← IndexedDBAdapter（Web）
│   │   ├── backup.ts             ← 备份/恢复/导出逻辑
│   │   ├── wrongProblem.ts       ← 错题 CRUD（接口不变，底层改调 dataStore）
│   │   ├── notes.ts              ← 笔记 CRUD
│   │   ├── qbank.ts              ← 题库 CRUD
│   │   ├── papers.ts             ← 试卷 CRUD
│   │   ├── settings.ts           ← 设置 CRUD
│   │   ├── cache.ts              ← 缓存管理
│   │   └── diversity.ts          ← 去重算法（不变）
│   ├── dev/
│   │   └── adminConsoleStore.ts  ← 重构：通过 dataStore 读写，不再直接操作 localStorage
│   └── api/
│       ├── autoSaveApi.ts        ← 适配新存储层
│       ├── backupApi.ts          ← 适配新备份格式
│       └── folderApi.ts          ← 保持不变
```

### 5.2 核心模块详解

#### A. `dataStore.ts` — 内存主副本

```typescript
class DataStore {
  private data: AppData;
  private adapter: StorageAdapter;
  private saveDebounce: DebouncedFunc | null;
  private saveQueue: Promise<void>;

  /** 初始化：从持久层加载 → 迁移 → 校验 → 存入内存 */
  async init(adapter: StorageAdapter): Promise<void>;

  /** 读取全部数据（返回深拷贝，防止外部直接修改） */
  getSnapshot(): AppData;

  /** 读取局部数据（按 domain 返回） */
  getWrongProblems(): WrongProblem[];
  getNotes(): NoteItem[];
  // ...

  /** 写入数据并触发持久化 */
  async updateWrongProblems(problems: WrongProblem[]): Promise<void>;
  async updateNotes(notes: NoteItem[]): Promise<void>;
  // ...

  /** 变更订阅（供 UI 组件刷新） */
  onChange(callback: (changedDomains: string[]) => void): () => void;

  /** 强制立即写入磁盘（退出前调用） */
  async flush(): Promise<void>;
}
```

**关键行为**：
- `init()` 时从 FileAdapter / IndexedDBAdapter 加载 JSON
- 每次 `updateXxx()` 先更新内存 → 发布 `onChange` → 异步写入持久层
- 写入使用原子策略：先写 `data.json.tmp` → rename 为 `data.json`（防写入中断损坏）
- 写入成功后保留 `data.backup.json` 作为上一次有效版本

#### B. `adapter.ts` — 抽象接口

```typescript
interface StorageAdapter {
  /** 加载完整数据快照，返回 JSON 字符串或 null（首次使用） */
  load(): Promise<string | null>;

  /** 保存完整数据快照 */
  save(json: string): Promise<void>;

  /** 列出备份文件 */
  listBackups(): Promise<{ name: string; time: number }[]>;

  /** 加载指定备份 */
  loadBackup(name: string): Promise<string>;

  /** 保存备份快照 */
  saveBackup(json: string): Promise<void>;

  /** 删除指定备份 */
  deleteBackup(name: string): Promise<void>;

  /** 存储后端描述（用于 UI 提示） */
  readonly label: string;
}

/** 运行时检测最佳适配器 */
function createStorageAdapter(): StorageAdapter;
```

#### C. `adapter.file.ts` — Electron 文件适配器

```typescript
class FileAdapter implements StorageAdapter {
  readonly label = '本地文件';

  constructor(baseDir: string);  // = app.getPath('userData')

  async load(): Promise<string | null>;        // 读 data.json
  async save(json: string): Promise<void>;     // 原子写入 data.json
  async saveBackup(json: string): Promise<void>; // 写入 backup/<timestamp>.json
  async listBackups(): Promise<...>;
  async loadBackup(name: string): Promise<string>;
  async deleteBackup(name: string): Promise<void>;
}
```

**原子写入实现**：
```
1. 写入 data.json.tmp
2. 如果 data.json 存在 → 重命名为 data.backup.json
3. 将 data.json.tmp 重命名为 data.json
4. 如果 data.backup.json 也存在 → 保留（不覆盖，双重保险）
```

**Electron 中如何访问文件系统**：
- 通过 `contextBridge` 暴露 `aiMathDesktop.dataAdapter` 对象
- preload.mjs 中注册 `ipcRenderer.invoke('data:save', json)` 等 IPC 通道
- 主进程 main.mjs 中实现文件读写（使用 `fs/promises`）

#### D. `adapter.idb.ts` — Web IndexedDB 适配器

```typescript
class IndexedDBAdapter implements StorageAdapter {
  readonly label = '浏览器数据库';

  constructor(dbName: string);  // = 'AI数学老师'

  async load(): Promise<string | null>;
  async save(json: string): Promise<void>;
  async saveBackup(json: string): Promise<void>;
  async listBackups(): Promise<...>;
  async loadBackup(name: string): Promise<string>;
  async deleteBackup(name: string): Promise<void>;
}
```

**使用 `idb` 库**（npm: `idb`，轻量 IndexedDB 包装，<2KB gzip）简化操作。

#### E. `schema.ts` — Zod 运行时校验

```typescript
import { z } from 'zod';

// 子类型 schema
const mathProblemSchema = z.object({
  id: z.string(),
  question: z.string(),
  // ...
});

const wrongProblemSchema = mathProblemSchema.extend({
  addedAt: z.number(),
  errorType: z.string(),
  folderId: z.string(),
  userNote: z.string().optional(),
});

// 主数据 schema
const appDataSchema = z.object({
  schemaVersion: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
  wrongProblems: z.array(wrongProblemSchema),
  // ...
});

// 类型推导（替代手写 interface）
type AppData = z.infer<typeof appDataSchema>;
```

**现有类型文件 `src/types/index.ts` 如何处理**：
- 保留作为编译期类型（供 UI 组件 import）
- schema.ts 中 Zod schema 的 `.shape` 通过 `z.infer<>` 推导出类型
- 当两者不一致时，Zod 编译报错 → 强制同步

#### F. `migration.ts` — 版本化迁移

```typescript
/** 按顺序执行所有未完成的迁移 */
function migrateData(raw: unknown, currentVersion: number): AppData {
  let data = raw as Record<string, unknown>;
  let version = (data.schemaVersion as number) || 1;

  while (version < currentVersion) {
    const migrateFn = migrations[version + 1];
    if (migrateFn) {
      data = migrateFn(data);
    }
    version++;
    data.schemaVersion = version;
  }

  return appDataSchema.parse(data);  // 最终 Zod 校验
}

/** 迁移函数注册表 */
const migrations: Record<number, MigrationFn> = {
  // 2: (data) => { ... },
  // 3: (data) => { ... },
};
```

---

## 六、实时持久化机制

### 6.1 写后即持久化

```
用户点击「加入错题本」
  → storageService.addWrongProblem(problem)
    → dataStore.updateWrongProblems([...existing, problem])
      → 1. 更新内存 Map（即时，0ms）
      → 2. 触发 onChange(['wrongProblems']) → UI 刷新
      → 3. 异步调用 adapter.save(JSON.stringify(snapshot))
        → FileAdapter: 原子写入 data.json（~5-50ms，不阻塞 UI）
        → IndexedDBAdapter: put('data', snapshot)（~1-10ms，不阻塞 UI）
```

### 6.2 退出前刷新

```typescript
// Electron 主进程 before-quit 事件
app.on('before-quit', async (event) => {
  event.preventDefault();
  // 通过 IPC 通知渲染进程 flush
  mainWindow.webContents.send('app:before-quit');
  // 等待渲染进程确认写入完成
  await new Promise(resolve => {
    ipcMain.once('data:flushed', resolve);
    setTimeout(resolve, 3000); // 最多等 3 秒
  });
  app.quit();
});
```

### 6.3 自动备份

保留现有 AutoSave 机制，但改为由 dataStore 驱动：
- 每 5 分钟检查一次数据是否变更
- 变更则调用 `adapter.saveBackup()` 写入带时间戳的备份文件
- 保留最近 10 份，滚动删除

---

## 七、与现有出题重构的衔接

当前 `docs/problem-generation-refactor-spec.md` 正进行出题链路重构。本数据存储重构与出题重构**无冲突**：

| 方面 | 出题重构 | 数据存储重构 |
|------|---------|-------------|
| 涉及文件 | `hooks/useGenerateProblems.ts`、`services/ai/aiService.ts`、`services/generation/*` | `services/storage/*` |
| 依赖 | 调用 `storageService.getLastProblems()` / `saveLastProblems()` | 提供相同 API |
| 执行顺序 | 可以先行完成 | 在后序做，保持对外 API 不变 |

**互不阻塞**：两场重构修改不同文件集，各自独立。

---

## 八、迁移方案

### 阶段 1：基础设施（2天）

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/services/storage/adapter.ts` | 新增 | StorageAdapter 接口定义 |
| `src/services/storage/adapter.idb.ts` | 新增 | IndexedDB 适配器（先期仅在 Web 端验证） |
| `src/services/storage/schema.ts` | 新增 | Zod schema + 类型推导 |
| `src/services/storage/migration.ts` | 新增 | 版本化迁移链 |
| `src/services/storage/dataStore.ts` | 新增 | 内存主副本 DataStore 类 |
| `electron/preload.mjs` | 修改 | 暴露 `aiMathDesktop.dataAdapter` IPC 通道 |
| `electron/main.mjs` | 修改 | 实现文件读写 IPC handler + before-quit flush |

### 阶段 2：适配器实现（1.5天）

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/services/storage/adapter.file.ts` | 新增 | Electron 文件适配器 |
| `src/services/storage/index.ts` | 修改 | 注入适配器，保持 API 不变 |
| `src/services/storage/wrongProblem.ts` | 修改 | 改用 dataStore 读写 |
| `src/services/storage/notes.ts` | 修改 | 同上 |
| `src/services/storage/qbank.ts` | 修改 | 同上 |

### 阶段 3：全量替换（1天）

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/services/storage/papers.ts` | 修改 | 改用 dataStore |
| `src/services/storage/settings.ts` | 修改 | 同上 |
| `src/services/storage/cache.ts` | 修改 | 改用 dataStore |
| `src/services/storage/backup.ts` | 新增 | 统一备份逻辑 |
| `src/dev/adminConsoleStore.ts` | 修改 | 通过 storageService 读写 |

### 阶段 4：清理 + 验证（1天）

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/services/storage/core.ts` | 删除 / 保留工具函数 | localStorage key 常量不再需要 |
| `src/services/api/autoSaveApi.ts` | 适配 | 对接新数据层 |
| `src/services/api/backupApi.ts` | 适配 | 导出格式升级为 v5.0 |
| 全局 | 搜索 `localStorage.` 残留引用 | 确保无遗漏 |
| 测试 | 端到端验证 | 出题→收录→导出→清空→导入→恢复 |

### 阶段 5：首次启动迁移（嵌入阶段 1）

当用户首次启动新版本时，自动检测 localStorage 中是否有旧数据：

```typescript
async function migrateFromLocalStorage(): Promise<AppData | null> {
  const oldVersion = localStorage.getItem('ai_math_wrong_problems');
  if (!oldVersion) return null;  // 全新用户，无需迁移

  // 1. 从 localStorage 读取所有旧 key
  // 2. 用现有 normalizeXxx 函数清洗数据
  // 3. 组装成 AppData 结构
  // 4. 调用 adapter.save() 写入新位置
  // 5. 提示用户「数据已迁移至 AppData 目录」
  // 6. 保留 localStorage 数据作为备份（不删除）

  return appData;
}
```

**总工期**：约 5.5 天

---

## 九、验收标准

### 功能验收
- [ ] Electron 端数据保存到 `%LOCALAPPDATA%\AI数学老师\data.json`
- [ ] Web 端数据保存到 IndexedDB
- [ ] 每次写入操作后文件立即更新（≤200ms）
- [ ] 文件写入使用原子替换，不会因中途崩溃导致数据损坏
- [ ] 启动时从文件/IndexedDB 正确加载数据
- [ ] 旧版本 localStorage 数据自动迁移
- [ ] 自动备份每 5 分钟生成一份，保留 10 份
- [ ] 导出全部数据为 JSON（兼容旧 v4.4 格式）
- [ ] 导入 JSON 数据正确恢复
- [ ] 管理员调试面板数据统一存储

### 技术验收
- [ ] `npm run lint` 通过
- [ ] `npm run build` 成功
- [ ] 无直接 `localStorage.getItem/setItem` 调用（除了迁移代码）
- [ ] Zod schema 覆盖所有数据模型
- [ ] 迁移链覆盖 v1→当前版本
- [ ] 所有 UI 页面功能正常

### 性能验收
- [ ] DataStore.init() 启动加载 < 200ms（1000 条错题规模）
- [ ] adapter.save() 写入延迟 < 50ms（不阻塞 UI）
- [ ] 内存快照 > 200MB 时不会因 IndexedDB 报错

---

## 十、风险与缓解

| 风险 | 缓解 |
|------|------|
| Electron IPC 通信延迟 | 文件写入异步执行，不阻塞渲染进程 |
| IndexedDB 在隐私模式下不可用 | 回退到 localStorage（保持现有代码作为 fallback） |
| Zod schema 与 TypeScript 类型不一致 | `z.infer<>` 推导类型，与手写 interface 编译期对比 |
| 大数据量下 JSON.stringify 耗时长 | 单用户场景数据量有限（<10000 条），实测 <100ms |
| 首次迁移丢失数据 | 迁移前自动备份 localStorage 到文件，保留不删除 |
| Electron `userData` 权限问题 | 使用 Electron 标准 API `app.getPath('userData')`，系统保证可写 |

---

## 十一、已决策问题

| # | 问题 | 决策 |
|---|------|------|
| 1 | 主存储为 IndexedDB 还是文件？ | Electron→文件，Web→IndexedDB |
| 2 | 是否需要 SQLite？ | 不需要，JSON 文件 + IndexedDB 满足需求 |
| 3 | 是否需要去抖（debounce）写入？ | 不需要，每次事件后立即写入 |
| 4 | 是否保留 localStorage 作为回退？ | 仅在 IndexedDB 不可用时回退 |
| 5 | 导出格式是否兼容旧版本？ | 导出为 v4.4 兼容格式，内部存储使用新格式 |
| 6 | adminConsoleStore 是否统一？ | 统一通过 storageService 读写 |

---

## 十二、文件清单

| 文件 | 当前行数 | 重构后行数 | 类型 |
|------|---------|-----------|------|
| `src/services/storage/core.ts` | 269 | 删除（工具函数保留迁移至 schema.ts） | 删除 |
| `src/services/storage/index.ts` | 60 | ~80 | 重构 |
| `src/services/storage/schema.ts` | 0 | ~200 | 新增 |
| `src/services/storage/dataStore.ts` | 0 | ~250 | 新增 |
| `src/services/storage/adapter.ts` | 0 | ~50 | 新增 |
| `src/services/storage/adapter.file.ts` | 0 | ~120 | 新增 |
| `src/services/storage/adapter.idb.ts` | 0 | ~100 | 新增 |
| `src/services/storage/migration.ts` | 0 | ~80 | 新增 |
| `src/services/storage/backup.ts` | 0 | ~100 | 新增 |
| `src/services/storage/wrongProblem.ts` | 161 | ~120 | 重构 |
| `src/services/storage/notes.ts` | 103 | ~80 | 重构 |
| `src/services/storage/qbank.ts` | 104 | ~80 | 重构 |
| `src/services/storage/papers.ts` | 224 | ~180 | 重构 |
| `src/services/storage/settings.ts` | 108 | ~80 | 重构 |
| `src/services/storage/cache.ts` | 282 | ~100 | 重构 |
| `src/services/storage/diversity.ts` | 182 | 182（不变） | 保留 |
| `src/services/dev/adminConsoleStore.ts` | 516 | ~450 | 重构 |
| `src/services/api/autoSaveApi.ts` | 194 | ~120 | 重构 |
| `src/services/api/backupApi.ts` | 267 | ~200 | 重构 |
| `electron/preload.mjs` | 7 | ~30 | 扩展 |
| `electron/main.mjs` | 89 | ~140 | 扩展 |

**预估**：新增 ~1,480 行，重构 ~1,810 行，删除 ~269 行。净增约 1,210 行，但消除全部 localStorage 直接访问。

---

> 确认后按五阶段方案执行。建议优先完成出题重构（`problem-generation-refactor-spec.md`），再进行数据存储重构，两者独立无冲突。
