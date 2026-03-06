<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/12154fd4-0788-41bd-bb72-a0ce8940e580

## Run Locally

**Prerequisites:**  Node.js

### 快速启动

1. **Windows**: 双击 `启动程序.bat`
2. **Mac/Linux**: 在终端运行 `./start.sh`

程序会自动执行以下步骤：
- ✅ 检查 Node.js 环境
- ✅ 检测和补全依赖包
- ✅ 修复不完整的依赖关系
- ✅ 启动应用并自动打开浏览器

首次运行可能需要 1-2 分钟用于依赖安装。

### 功能特性

**自动依赖检测和补全：**
- 深度检查 node_modules 中的所有依赖
- 自动检测缺失的包并安装
- 自动修复不完整或损坏的依赖树
- 支持离线模式（使用 npm ci + package-lock.json）

### 首次使用

1. 在设置页面填入你的 API Key（支持 OpenAI/DeepSeek/Gemini 等多供应商）
2. 程序会自动保存设置到本地存储
3. 开始使用出题功能

### 手动启动 (开发者模式)

1. 安装依赖:
   ```bash
   npm install
   ```
2. 运行应用:
   ```bash
   npm run dev
   ```
3. 构建生产版本:
   ```bash
   npm run build
   ```

### 开发者实时用量监控（独立外置脚本）

启动项目后，可在浏览器单独打开：

```text
http://localhost:3000/dev-monitor.html
```

监控页会实时显示：
- 当前正在运行的模型（Provider / Model / Channel）
- 累计请求成功/失败数
- Prompt / Completion / Total Token 消耗
- 最近请求记录（部分流式场景会显示“估算 token”）

Windows 下使用 `启动程序.bat` 时，会自动探测实际开发端口（3000-3010）并自动打开对应端口的监控页，无需手动修改 URL。

监控页本身也会自动探测活跃端口（3000-3010）并读取实时统计数据，即使主程序与监控页不在同一端口也可正常工作。

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

### 项目结构

```
.
├── components/          # React 组件
├── services/            # 服务层（API、存储等）
├── App.tsx              # 主应用组件
├── index.tsx            # 应用入口
├── package.json         # 依赖配置
├── vite.config.ts       # Vite 配置
└── check-dependencies.js # 自动依赖检测脚本
```

### Railway 后端部署约定

- 后端 Railway 配置仅保留在 `backend/railway.toml`
- Railway 服务的 **Root Directory 必须设置为 `backend`**
- 后端 Docker 构建上下文为 `backend` 目录（对应 `backend/Dockerfile`）
- 根目录不再放置 `railway.toml`，以避免多配置源冲突

### Third-Party Licenses

This product includes software from Microsoft MarkItDown (https://github.com/microsoft/markitdown)
licensed under the MIT License. Copyright (c) Microsoft Corporation.
