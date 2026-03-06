/**
 * confirmService.ts
 *
 * 单一职责：提供 showConfirm(message) => Promise<boolean>，
 * 通过 CustomEvent 驱动 ConfirmDialog 组件展示，
 * 完全避免原生 confirm() 阻塞主线程 / 在产线被浏览器屏蔽的问题。
 *
 * Why: 原生 confirm() 在某些浏览器（尤其是 iframe、PWA、部分移动端）中
 *      已被默认禁用或样式不可定制。使用事件桥接模式可在任意模块（包括
 *      Service 层）调用，而 UI 渲染始终由 ConfirmDialog 组件负责。
 *
 * 使用示例：
 *   const ok = await showConfirm('确定删除吗？');
 *   if (ok) { ... }
 */

/** 待决的用户确认请求，同一时刻最多存在一个 */
let pendingResolve: ((value: boolean) => void) | null = null;

/**
 * 显示一个非阻塞的确认对话框。
 *
 * @param message - 提示文本（支持 \n 换行）
 * @returns Promise<boolean> — 用户点击"确认"返回 true，"取消"返回 false
 */
export function showConfirm(message: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    // 若有未完成的请求，先以 false 强制关闭，避免 Promise 泄漏
    pendingResolve?.(false);
    pendingResolve = resolve;
    window.dispatchEvent(new CustomEvent('confirm:show', { detail: { message } }));
  });
}

/**
 * 由 ConfirmDialog 组件内部调用，回传用户选择结果。
 *
 * @param value - true 表示确认，false 表示取消
 */
export function resolveConfirm(value: boolean): void {
  pendingResolve?.(value);
  pendingResolve = null;
}
