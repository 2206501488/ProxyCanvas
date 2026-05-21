import { BarChart3, KeyRound, ListChecks } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';

const tabBase = 'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors';

function tabClass({ isActive }: { isActive: boolean }) {
    return [
        tabBase,
        isActive
            ? 'bg-[var(--accent-primary)] text-white'
            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]',
    ].join(' ');
}

export function OpsLayout() {
    return (
        <main className="mx-auto flex w-full max-w-[1800px] flex-1 flex-col gap-4 px-4 py-4">
            <section className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
                <div className="mr-2">
                    <div className="text-lg font-semibold text-[var(--text-primary)]">运行中心</div>
                    <div className="text-xs text-[var(--text-muted)]">任务调度、账号池和渠道运行状态</div>
                </div>
                <nav className="flex rounded-full border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-1">
                    <NavLink to="/ops/jobs" className={tabClass}>
                        <ListChecks className="h-4 w-4" />
                        任务
                    </NavLink>
                    <NavLink to="/ops/accounts" className={tabClass}>
                        <KeyRound className="h-4 w-4" />
                        账号池
                    </NavLink>
                    <NavLink to="/ops/analytics" className={tabClass}>
                        <BarChart3 className="h-4 w-4" />
                        数据分析
                    </NavLink>
                </nav>
            </section>
            <Outlet />
        </main>
    );
}
