
import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/global.css';
import App from './App';
import { installAdminFetchInterceptor } from './services/dev/adminConsoleStore';
import { autoSaveApi } from './services/api/autoSaveApi';

installAdminFetchInterceptor();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

async function bootstrap(): Promise<void> {
  const restoreResult = await autoSaveApi.restoreLatestOnStartup({
    dispatchEvent: false,
    logger: console,
  });

  if (!restoreResult.success) {
    console.warn(`[main] 启动自动恢复失败：${restoreResult.message}`);
  } else if (restoreResult.restored && restoreResult.entry) {
    console.info(`[main] 启动时已自动恢复数据：${restoreResult.entry.name}`);
  } else {
    console.info('[main] 启动时未执行自动恢复。');
  }

  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

void bootstrap();
