import { contextBridge } from 'electron';

// 仅暴露最小运行时信息，避免渲染进程直接接触 Node API。
contextBridge.exposeInMainWorld('aiMathDesktop', {
  isDesktop: true,
  platform: process.platform,
});