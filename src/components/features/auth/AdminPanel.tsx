/**
 * AdminPanel.tsx — 管理员控制面板
 *
 * Why: 后端已有完整的 admin API，但缺少可视化操作界面。
 *      此面板作为弹层（与 SettingsPanel 保持一致的交互模式）提供：
 *      1. 用户列表（分页 + 搜索）
 *      2. 危险操作：清理用户（先 dryRun 预览，再二次确认执行）
 */

import React, { useState, useEffect, useCallback } from 'react';
import { adminApi, AdminUser, PurgeStats } from '@/services/api/backendApi';

interface AdminPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type PurgeScope = 'all' | 'inactive';

// ===== 辅助子组件 =====

/** 角色徽章 */
const RoleBadge: React.FC<{ role: AdminUser['role'] }> = ({ role }) => {
  const styles: Record<AdminUser['role'], string> = {
    admin: 'bg-indigo-100 text-indigo-700 border-indigo-200',
    paid:  'bg-emerald-100 text-emerald-700 border-emerald-200',
    free:  'bg-slate-100 text-slate-500 border-slate-200',
  };
  const labels: Record<AdminUser['role'], string> = {
    admin: '管理员', paid: '付费', free: '免费',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${styles[role]}`}>
      {labels[role]}
    </span>
  );
};

/** 统计行 */
const StatRow: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="flex justify-between text-sm">
    <span className="text-slate-500">{label}</span>
    <span className="font-bold text-rose-600">{value.toLocaleString()}</span>
  </div>
);

// ===== 主组件 =====

export const AdminPanel: React.FC<AdminPanelProps> = ({ isOpen, onClose }) => {
  // ----- 用户列表状态 -----
  const [users, setUsers]           = useState<AdminUser[]>([]);
  const [total, setTotal]           = useState(0);
  const [page, setPage]             = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch]         = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading]       = useState(false);
  const [listError, setListError]   = useState('');

  // ----- Purge 状态 -----
  const [activeTab, setActiveTab]   = useState<'users' | 'danger'>('users');
  const [purgeScope, setPurgeScope] = useState<PurgeScope>('inactive');
  const [dryRunResult, setDryRunResult] = useState<PurgeStats | null>(null);
  const [confirmInput, setConfirmInput] = useState('');
  const [purgeLoading, setPurgeLoading] = useState(false);
  const [purgeMsg, setPurgeMsg]     = useState('');
  const [purgeMsgType, setPurgeMsgType] = useState<'success' | 'error'>('success');

  // ----- 拉取用户列表 -----
  const fetchUsers = useCallback(async (p: number, s: string) => {
    setLoading(true);
    setListError('');
    try {
      const res = await adminApi.getUsers(p, 20, s || undefined);
      setUsers(res.users);
      setTotal(res.total);
      setTotalPages(res.totalPages);
      setPage(res.page);
    } catch (e: any) {
      setListError(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  // 面板打开时加载第一页
  useEffect(() => {
    if (isOpen) {
      fetchUsers(1, '');
      setSearch('');
      setSearchInput('');
      setDryRunResult(null);
      setConfirmInput('');
      setPurgeMsg('');
    }
  }, [isOpen, fetchUsers]);

  const handleSearch = () => {
    setSearch(searchInput);
    fetchUsers(1, searchInput);
  };

  // ----- Purge：Dry Run -----
  const handleDryRun = async () => {
    setPurgeLoading(true);
    setPurgeMsg('');
    setDryRunResult(null);
    try {
      const res = await adminApi.purgeUsers(purgeScope, true);
      setDryRunResult(res.willDelete ?? null);
    } catch (e: any) {
      setPurgeMsg(e.message || '预览失败');
      setPurgeMsgType('error');
    } finally {
      setPurgeLoading(false);
    }
  };

  // ----- Purge：真实执行 -----
  const handlePurge = async () => {
    if (confirmInput !== 'PURGE_USERS') {
      setPurgeMsg('确认文本输入错误，请输入 PURGE_USERS');
      setPurgeMsgType('error');
      return;
    }
    setPurgeLoading(true);
    setPurgeMsg('');
    try {
      const res = await adminApi.purgeUsers(purgeScope, false, 'PURGE_USERS');
      const d = res.deleted!;
      setPurgeMsg(`✅ 清理完成：删除 ${d.users} 个用户及 ${d.refreshTokens + d.usageRecords + d.aiRequestLogs + d.userData} 条关联记录`);
      setPurgeMsgType('success');
      setDryRunResult(null);
      setConfirmInput('');
      // 刷新用户列表
      fetchUsers(1, search);
    } catch (e: any) {
      setPurgeMsg(e.message || '清理失败');
      setPurgeMsgType('error');
    } finally {
      setPurgeLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* 面板主体 */}
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden border border-slate-200">

        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-indigo-50 to-white flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-black text-slate-800">管理员控制台</h2>
              <p className="text-[10px] text-slate-400">共 {total.toLocaleString()} 个用户</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center transition-colors">
            <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tab 切换 */}
        <div className="flex border-b border-slate-100 flex-shrink-0 px-6">
          {([['users', '用户列表'], ['danger', '⚠️ 危险操作']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`px-4 py-3 text-xs font-bold border-b-2 transition-colors ${
                activeTab === key
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* ===== 用户列表 Tab ===== */}
          {activeTab === 'users' && (
            <div className="space-y-4">
              {/* 搜索栏 */}
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="搜索邮箱或昵称..."
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  className="flex-1 px-4 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
                <button
                  onClick={handleSearch}
                  className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition-colors"
                >
                  搜索
                </button>
                {search && (
                  <button
                    onClick={() => { setSearchInput(''); setSearch(''); fetchUsers(1, ''); }}
                    className="px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-500 hover:bg-slate-50"
                  >
                    清除
                  </button>
                )}
              </div>

              {/* 错误提示 */}
              {listError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-600">{listError}</div>
              )}

              {/* 用户表格 */}
              {loading ? (
                <div className="text-center py-12 text-slate-400 text-sm">加载中...</div>
              ) : users.length === 0 ? (
                <div className="text-center py-12 text-slate-400 text-sm">暂无用户数据</div>
              ) : (
                <div className="rounded-2xl border border-slate-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        {['邮箱', '昵称', '角色', '今日请求', '注册时间'].map(h => (
                          <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {users.map(u => (
                        <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3 text-slate-700 font-mono text-xs max-w-[180px] truncate">{u.email}</td>
                          <td className="px-4 py-3 text-slate-600 text-xs">{u.nickname || <span className="text-slate-300">—</span>}</td>
                          <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                          <td className="px-4 py-3 text-slate-600 text-xs text-center">{u.today_requests}</td>
                          <td className="px-4 py-3 text-slate-400 text-xs">
                            {new Date(u.created_at).toLocaleDateString('zh-CN')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* 分页 */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 pt-2">
                  <button
                    disabled={page <= 1}
                    onClick={() => fetchUsers(page - 1, search)}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-600 disabled:opacity-40 hover:bg-slate-50"
                  >
                    上一页
                  </button>
                  <span className="text-xs text-slate-500">{page} / {totalPages}</span>
                  <button
                    disabled={page >= totalPages}
                    onClick={() => fetchUsers(page + 1, search)}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-600 disabled:opacity-40 hover:bg-slate-50"
                  >
                    下一页
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ===== 危险操作 Tab ===== */}
          {activeTab === 'danger' && (
            <div className="space-y-6">
              {/* 警告横幅 */}
              <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 flex gap-3">
                <svg className="w-5 h-5 text-rose-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                <p className="text-xs text-rose-700 leading-relaxed">
                  以下操作不可撤销，将从数据库永久删除用户及所有关联记录（Token、用量、AI日志、数据）。
                  <strong>操作前请务必先执行「预览」确认影响范围。</strong>
                </p>
              </div>

              {/* 清理范围选择 */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-600">清理范围</label>
                <div className="grid grid-cols-2 gap-3">
                  {([
                    ['inactive', '非活跃用户', '清理 is_active=false 的冻结用户'],
                    ['all',      '全部普通用户', '清理所有非 admin 角色的用户（含付费用户）'],
                  ] as const).map(([val, title, desc]) => (
                    <button
                      key={val}
                      onClick={() => { setPurgeScope(val); setDryRunResult(null); setPurgeMsg(''); }}
                      className={`p-3 rounded-2xl border-2 text-left transition-all ${
                        purgeScope === val
                          ? 'border-rose-400 bg-rose-50'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="text-xs font-bold text-slate-700">{title}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">{desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Step 1：预览 */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-slate-700 text-white text-[10px] font-bold flex items-center justify-center">1</span>
                  <span className="text-xs font-bold text-slate-600">预览将删除的数据量</span>
                </div>
                <button
                  onClick={handleDryRun}
                  disabled={purgeLoading}
                  className="px-5 py-2.5 rounded-xl bg-slate-700 text-white text-xs font-bold hover:bg-slate-800 disabled:opacity-50 transition-colors"
                >
                  {purgeLoading && !dryRunResult ? '预览中...' : '执行预览 (Dry Run)'}
                </button>

                {dryRunResult && (
                  <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 space-y-2">
                    <p className="text-xs font-bold text-amber-700 mb-2">📋 预览结果（实际未删除）：</p>
                    <StatRow label="用户" value={dryRunResult.users} />
                    <StatRow label="刷新 Token" value={dryRunResult.refreshTokens} />
                    <StatRow label="用量记录" value={dryRunResult.usageRecords} />
                    <StatRow label="AI 日志" value={dryRunResult.aiRequestLogs} />
                    <StatRow label="用户数据" value={dryRunResult.userData} />
                  </div>
                )}
              </div>

              {/* Step 2：确认执行（仅在 dryRun 看完后显示） */}
              {dryRunResult && (
                <div className="space-y-3 pt-2 border-t border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center">2</span>
                    <span className="text-xs font-bold text-slate-600">输入确认文本后执行删除</span>
                  </div>
                  <p className="text-xs text-slate-500">请输入 <code className="bg-slate-100 px-1 rounded font-mono">PURGE_USERS</code> 以确认：</p>
                  <input
                    type="text"
                    value={confirmInput}
                    onChange={e => setConfirmInput(e.target.value)}
                    placeholder="PURGE_USERS"
                    className="w-full px-4 py-2 rounded-xl border border-rose-200 bg-rose-50 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-rose-300"
                  />
                  <button
                    onClick={handlePurge}
                    disabled={purgeLoading || confirmInput !== 'PURGE_USERS'}
                    className="w-full py-3 rounded-xl bg-rose-600 text-white text-xs font-black hover:bg-rose-700 disabled:opacity-40 transition-colors"
                  >
                    {purgeLoading ? '删除中...' : `🗑️ 确认永久删除 ${dryRunResult.users} 个用户`}
                  </button>
                </div>
              )}

              {/* 操作结果消息 */}
              {purgeMsg && (
                <div className={`p-3 rounded-xl border text-xs ${
                  purgeMsgType === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    : 'bg-rose-50 border-rose-200 text-rose-700'
                }`}>
                  {purgeMsg}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
