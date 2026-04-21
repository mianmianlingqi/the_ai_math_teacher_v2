<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/12154fd4-0788-41bd-bb72-a0ce8940e580

## Run Locally

**Prerequisites:**  Node.js

### 快速启动

1. 安装前端依赖：
   ```bash
   npm install
   ```
2. 启动前端开发服务器：
   ```bash
   npm run dev
   ```
3. 如需本地联调后端，进入 `backend/` 后执行：
   ```bash
   npm install
   npm run dev
   ```

当前仓库已经直接以工作区根目录作为项目根目录，不再使用额外的嵌套项目目录。

### 功能特性

**当前技术栈：**
- 前端：React 19 + Vite 6 + Tailwind CSS 3
- 后端：Node.js + TypeScript + Railway
- 分层：`src/services/` 下按 `ai / api / storage` 拆分

### 首次使用

1. 在设置页面填入你的 API Key（支持 OpenAI/DeepSeek/Gemini 等多供应商）
2. 程序会自动保存设置到本地存储
3. 开始使用出题功能

### 手动启动 (开发者模式)

1. 安装前端依赖:
   ```bash
   npm install
   ```
2. 运行前端应用:
   ```bash
   npm run dev
   ```
3. 构建前端生产版本:
   ```bash
   npm run build
   ```
4. 安装并运行后端（可选）:
   ```bash
   cd backend
   npm install
   npm run dev
   ```

### 项目结构

```text
.
├── .github/               # Copilot 协作规范与仓库级配置
├── backend/               # Railway 后端项目
│   ├── src/               # 后端源码入口、路由、中间件、数据库模块
│   └── railway.toml       # Railway 部署配置
├── src/                   # 前端源码
│   ├── components/        # UI 组件
│   ├── constants/         # 静态配置
│   ├── hooks/             # React 自定义 Hooks
│   ├── services/          # ai / api / storage 服务分层
│   ├── styles/            # 全局样式
│   └── types/             # TypeScript 类型定义
├── index.html             # Vite HTML 入口
├── package.json           # 前端依赖与脚本
└── vite.config.ts         # Vite 配置
```

### 故障排除

如果启动时遇到依赖问题：

1. **清空缓存并重新安装：**
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```

2. **清空 npm 缓存：**
   ```bash
   npm cache clean --force
   npm install
   ```

3. **检查网络连接：**
   确保你的网络可以访问 npm registry (registry.npmjs.org)

### Railway 后端部署约定

- 后端 Railway 配置仅保留在 `backend/railway.toml`
- Railway 服务的 **Root Directory 必须设置为 `backend`**
- 后端 Docker 构建上下文为 `backend` 目录（对应 `backend/Dockerfile`）
- 根目录不再放置 `railway.toml`，以避免多配置源冲突

### Third-Party Licenses

This product includes software from Microsoft MarkItDown (https://github.com/microsoft/markitdown)
licensed under the MIT License. Copyright (c) Microsoft Corporation.
