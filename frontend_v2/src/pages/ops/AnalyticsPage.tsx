import { BarChart3 } from 'lucide-react';

export function AnalyticsPage() {
    return (
        <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-8">
            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--bg-secondary)] text-[var(--accent-primary)]">
                    <BarChart3 className="h-5 w-5" />
                </div>
                <div>
                    <div className="text-lg font-semibold text-[var(--text-primary)]">数据分析</div>
                    <div className="text-sm text-[var(--text-muted)]">
                        后续会在这里展示渠道对比、失败原因、平均耗时、账号负载和模型表现。
                    </div>
                </div>
            </div>
        </section>
    );
}
