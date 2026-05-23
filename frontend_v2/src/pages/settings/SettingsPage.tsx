import {
    Activity,
    Check,
    Database,
    FolderOpen,
    HardDrive,
    Loader2,
    Plug,
    RotateCw,
    Settings2,
    Shield,
    SlidersHorizontal,
    Sparkles,
    Wifi,
} from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import { HexColorPicker } from 'react-colorful';
import { loadBackendSettings, loadRuntimeProviders, saveBackendSettings, saveRuntimeProvider } from '../../services/api';
import type { BackendSettings, RuntimeProvider, SettingValue } from '../../services/api';
import {
    DEFAULT_GALLERY_SELECTION_BOX_COLOR,
    DEFAULT_GALLERY_SELECTION_COLOR,
    DEFAULT_GALLERY_TAG_COLOR,
    MAX_GALLERY_PAGE_SIZE,
    MIN_GALLERY_PAGE_SIZE,
    useStore,
} from '../../store';
import type { GalleryColumnSize, GalleryDisplayMode } from '../../store';
import { notifyProvidersUpdated } from '../../hooks/useProviders';

type SectionId = 'preferences' | 'providers' | 'jobs' | 'storage' | 'network' | 'advanced';

interface SectionDef {
    id: SectionId;
    label: string;
    icon: ComponentType<{ className?: string }>;
}

const SECTIONS: SectionDef[] = [
    { id: 'preferences', label: '偏好', icon: SlidersHorizontal },
    { id: 'providers', label: 'Provider', icon: Plug },
    { id: 'jobs', label: '任务', icon: Activity },
    { id: 'storage', label: '存储', icon: HardDrive },
    { id: 'network', label: '网络', icon: Wifi },
    { id: 'advanced', label: '高级', icon: Settings2 },
];

const COLUMN_OPTIONS: Array<{ value: GalleryColumnSize; label: string }> = [
    { value: 7, label: '小' },
    { value: 6, label: '中' },
    { value: 5, label: '大' },
];

const DISPLAY_MODE_OPTIONS: Array<{ value: GalleryDisplayMode; label: string }> = [
    { value: 'waterfall', label: '瀑布流' },
    { value: 'pagination', label: '分页' },
];

const ACCENT_COLOR_PRESETS = ['#ff8a00', '#ffb703', '#e76f51', '#2a9d8f', '#8ecae6', '#cdb4db'];
const SELECTION_BOX_COLOR_PRESETS = ['#fff3b0', '#ffd6a5', '#ffc2b4', '#b7e4c7', '#bde0fe', '#e0bbe4'];
const TAG_COLOR_PRESETS = ['#f43f5e', '#f97316', '#10b981', '#06b6d4', '#6366f1', '#d946ef'];

function sourceText(source?: string) {
    return source || 'config.py';
}

function isHexColor(value: string) {
    return /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

function SectionHeader({
    title,
    subtitle,
    actions,
}: {
    title: string;
    subtitle?: string;
    actions?: ReactNode;
}) {
    return (
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
                <h2 className="text-xl font-semibold text-[var(--text-primary)]">{title}</h2>
                {subtitle && <p className="mt-1 text-sm text-[var(--text-muted)]">{subtitle}</p>}
            </div>
            {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
    );
}

function SourceBadge({ source }: { source?: string }) {
    return (
        <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]">
            {sourceText(source)}
        </span>
    );
}

function Panel({ children }: { children: ReactNode }) {
    return (
        <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
            {children}
        </section>
    );
}

function SettingRow({
    label,
    value,
    source,
}: {
    label: string;
    value: ReactNode;
    source?: string;
}) {
    return (
        <div className="grid gap-2 border-b border-[var(--border-subtle)] py-3 last:border-b-0 md:grid-cols-[11rem_1fr_auto] md:items-center">
            <div className="text-sm font-medium text-[var(--text-secondary)]">{label}</div>
            <div className="min-w-0 text-sm text-[var(--text-primary)]">{value}</div>
            <SourceBadge source={source} />
        </div>
    );
}

function Toggle({
    checked,
    onChange,
    label,
}: {
    checked: boolean;
    onChange: (value: boolean) => void;
    label: string;
}) {
    return (
        <button type="button" onClick={() => onChange(!checked)} className="flex items-center gap-3 text-left" aria-pressed={checked}>
            <span
                className={`relative h-6 w-11 rounded-full border transition-colors ${
                    checked
                        ? 'border-[var(--accent-primary)]/45 bg-[var(--accent-primary)]/20'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)]'
                }`}
            >
                <span
                    className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full shadow transition-all ${
                        checked ? 'translate-x-5 bg-[var(--accent-primary)]' : 'translate-x-0 bg-[var(--text-muted)]'
                    }`}
                />
            </span>
            <span className="text-sm text-[var(--text-primary)]">{label}</span>
        </button>
    );
}

function ColorPreference({
    label,
    value,
    onChange,
    defaultValue,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    defaultValue: string;
}) {
    const colorInputValue = isHexColor(value) ? value : defaultValue;
    const [pickerOpen, setPickerOpen] = useState(false);
    const pickerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!pickerOpen) return;

        const handlePointerDown = (event: PointerEvent) => {
            if (!pickerRef.current?.contains(event.target as Node)) {
                setPickerOpen(false);
            }
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setPickerOpen(false);
        };

        window.addEventListener('pointerdown', handlePointerDown);
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('pointerdown', handlePointerDown);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [pickerOpen]);

    return (
        <div className="relative" ref={pickerRef}>
            <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-xs text-[var(--text-muted)]">{label}</span>
                <button
                    type="button"
                    onClick={() => onChange(defaultValue)}
                    className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] transition-colors hover:border-[var(--text-muted)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]"
                >
                    恢复默认
                </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    onClick={() => setPickerOpen((open) => !open)}
                    className="h-8 w-8 rounded-md border border-white/10 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.18)] transition-transform hover:scale-105"
                    style={{ backgroundColor: colorInputValue }}
                    aria-label={`自定义${label}`}
                />
                <input
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    className="h-8 w-24 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2 font-mono text-xs text-[var(--text-secondary)] outline-none focus:border-[var(--accent-primary)]"
                />
            </div>
            {pickerOpen && (
                <div className="absolute left-0 top-[4.3rem] z-[90] w-64 rounded-xl border border-[var(--border-subtle)] bg-[rgba(24,24,27,0.98)] p-3 shadow-[0_18px_48px_rgba(0,0,0,0.42)] backdrop-blur-xl">
                    <div className="mb-3 flex items-center justify-between gap-3">
                        <span className="text-xs font-medium text-[var(--text-secondary)]">自定义颜色</span>
                        <span className="h-5 w-5 rounded border border-white/10" style={{ backgroundColor: colorInputValue }} />
                    </div>
                    <HexColorPicker color={colorInputValue} onChange={onChange} className="proxy-color-picker" />
                    <div className="mt-3 flex items-center gap-2">
                        <input
                            value={value}
                            onChange={(event) => onChange(event.target.value)}
                            className="h-8 min-w-0 flex-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]"
                        />
                        <button
                            type="button"
                            onClick={() => setPickerOpen(false)}
                            className="h-8 rounded-md bg-[var(--bg-card-hover)] px-2.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        >
                            完成
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

interface ColorTarget {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    presets: string[];
}

function SharedColorPalette({ targets }: { targets: ColorTarget[] }) {
    const [activeTargetId, setActiveTargetId] = useState(targets[0]?.id || '');
    const activeTarget = targets.find((target) => target.id === activeTargetId) || targets[0];

    if (!activeTarget) return null;

    return (
        <div className="space-y-3">
            <div className="inline-flex flex-wrap gap-1 rounded-lg bg-[var(--bg-secondary)] p-1">
                {targets.map((target) => (
                    <button
                        key={target.id}
                        type="button"
                        onClick={() => setActiveTargetId(target.id)}
                        className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                            activeTarget.id === target.id
                                ? 'bg-[var(--bg-card-hover)] text-[var(--text-primary)] shadow-sm'
                                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                        }`}
                    >
                        {target.label}
                    </button>
                ))}
            </div>
            <div className="flex flex-wrap gap-2">
                {activeTarget.presets.map((color) => (
                    <button
                        key={color}
                        type="button"
                        onClick={() => activeTarget.onChange(color)}
                        className={`h-8 w-8 rounded-md border shadow-[inset_0_0_0_1px_rgba(0,0,0,0.18)] transition-transform hover:scale-105 ${
                            activeTarget.value.toLowerCase() === color.toLowerCase()
                                ? 'border-white/80 ring-2 ring-white/18'
                                : 'border-white/15'
                        }`}
                        style={{ backgroundColor: color }}
                        aria-label={`${activeTarget.label} ${color}`}
                    />
                ))}
            </div>
        </div>
    );
}

function PathValue({ value }: { value?: SettingValue<string> }) {
    if (!value) return <span>-</span>;
    return (
        <div className="min-w-0">
            <div className="truncate font-mono text-xs text-[var(--text-primary)]">{value.resolved || value.value}</div>
            {value.resolved && value.resolved !== value.value && (
                <div className="mt-1 truncate font-mono text-[11px] text-[var(--text-muted)]">{value.value}</div>
            )}
        </div>
    );
}

function PreferencesPanel() {
    const autoClearPrompt = useStore((s) => s.autoClearPrompt);
    const setAutoClearPrompt = useStore((s) => s.setAutoClearPrompt);
    const galleryColumns = useStore((s) => s.galleryColumns);
    const setGalleryColumns = useStore((s) => s.setGalleryColumns);
    const galleryDisplayMode = useStore((s) => s.galleryDisplayMode);
    const setGalleryDisplayMode = useStore((s) => s.setGalleryDisplayMode);
    const galleryPageSize = useStore((s) => s.galleryPageSize);
    const setGalleryPageSize = useStore((s) => s.setGalleryPageSize);
    const deleteLocalFile = useStore((s) => s.deleteLocalFile);
    const setDeleteLocalFile = useStore((s) => s.setDeleteLocalFile);
    const deleteImportedOriginal = useStore((s) => s.deleteImportedOriginal);
    const setDeleteImportedOriginal = useStore((s) => s.setDeleteImportedOriginal);
    const gallerySelectionColor = useStore((s) => s.gallerySelectionColor);
    const setGallerySelectionColor = useStore((s) => s.setGallerySelectionColor);
    const gallerySelectionBoxColor = useStore((s) => s.gallerySelectionBoxColor);
    const setGallerySelectionBoxColor = useStore((s) => s.setGallerySelectionBoxColor);
    const galleryTagColor = useStore((s) => s.galleryTagColor);
    const setGalleryTagColor = useStore((s) => s.setGalleryTagColor);

    const colorTargets = useMemo<ColorTarget[]>(() => [
        {
            id: 'selection',
            label: '选中边框',
            value: gallerySelectionColor,
            onChange: setGallerySelectionColor,
            presets: ACCENT_COLOR_PRESETS,
        },
        {
            id: 'selection-box',
            label: '框选区域',
            value: gallerySelectionBoxColor,
            onChange: setGallerySelectionBoxColor,
            presets: SELECTION_BOX_COLOR_PRESETS,
        },
        {
            id: 'tag',
            label: 'TAG',
            value: galleryTagColor,
            onChange: setGalleryTagColor,
            presets: TAG_COLOR_PRESETS,
        },
    ], [
        gallerySelectionBoxColor,
        gallerySelectionColor,
        galleryTagColor,
        setGallerySelectionBoxColor,
        setGallerySelectionColor,
        setGalleryTagColor,
    ]);

    return (
        <div>
            <SectionHeader title="偏好" subtitle="本地图廊显示、生成行为和外观颜色" />
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(22rem,0.95fr)]">
                <Panel>
                    <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                        <FolderOpen className="h-4 w-4 text-[var(--accent-primary)]" />
                        图廊
                    </div>
                    <div className="space-y-5">
                        <label className="block">
                            <span className="mb-2 block text-xs text-[var(--text-muted)]">分页每页张数</span>
                            <input
                                type="number"
                                min={MIN_GALLERY_PAGE_SIZE}
                                max={MAX_GALLERY_PAGE_SIZE}
                                step={10}
                                value={galleryPageSize}
                                onChange={(event) => setGalleryPageSize(Number(event.target.value))}
                                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]"
                            />
                            <span className="mt-1 block text-xs text-[var(--text-muted)]">
                                范围 {MIN_GALLERY_PAGE_SIZE}-{MAX_GALLERY_PAGE_SIZE}，仅分页模式生效
                            </span>
                        </label>
                        <div>
                            <div className="mb-2 text-xs text-[var(--text-muted)]">缩略图大小</div>
                            <div className="flex overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
                                {COLUMN_OPTIONS.map((option) => (
                                    <button
                                        key={option.value}
                                        type="button"
                                        onClick={() => setGalleryColumns(option.value)}
                                        className={`flex-1 px-3 py-2 text-sm transition-colors ${
                                            galleryColumns === option.value
                                                ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-primary)]'
                                                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]'
                                        }`}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div>
                            <div className="mb-2 text-xs text-[var(--text-muted)]">浏览方式</div>
                            <div className="flex overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
                                {DISPLAY_MODE_OPTIONS.map((option) => (
                                    <button
                                        key={option.value}
                                        type="button"
                                        onClick={() => setGalleryDisplayMode(option.value)}
                                        className={`flex-1 px-3 py-2 text-sm transition-colors ${
                                            galleryDisplayMode === option.value
                                                ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-primary)]'
                                                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]'
                                        }`}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <Toggle checked={deleteLocalFile} onChange={setDeleteLocalFile} label="删除记录时删除本地文件" />
                        <Toggle checked={deleteImportedOriginal} onChange={setDeleteImportedOriginal} label="导入成功后删除源文件" />
                    </div>
                </Panel>

                <div className="space-y-4">
                    <Panel>
                        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                            <Sparkles className="h-4 w-4 text-[var(--accent-primary)]" />
                            生成行为
                        </div>
                        <Toggle checked={autoClearPrompt} onChange={setAutoClearPrompt} label="生成后自动清除提示词" />
                    </Panel>

                    <Panel>
                        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                            <Check className="h-4 w-4 text-[var(--accent-primary)]" />
                            外观颜色
                        </div>
                        <div className="space-y-4">
                            <SharedColorPalette targets={colorTargets} />
                            <div className="grid gap-4 md:grid-cols-3">
                                <ColorPreference
                                    label="选中边框颜色"
                                    value={gallerySelectionColor}
                                    onChange={setGallerySelectionColor}
                                    defaultValue={DEFAULT_GALLERY_SELECTION_COLOR}
                                />
                                <ColorPreference
                                    label="框选区域颜色"
                                    value={gallerySelectionBoxColor}
                                    onChange={setGallerySelectionBoxColor}
                                    defaultValue={DEFAULT_GALLERY_SELECTION_BOX_COLOR}
                                />
                                <ColorPreference
                                    label="TAG 颜色"
                                    value={galleryTagColor}
                                    onChange={setGalleryTagColor}
                                    defaultValue={DEFAULT_GALLERY_TAG_COLOR}
                                />
                            </div>
                        </div>
                    </Panel>
                </div>
            </div>
        </div>
    );
}

function ProviderPanel({
    providers,
    activeProviderId,
    onReload,
}: {
    providers: RuntimeProvider[];
    activeProviderId?: string;
    onReload: () => Promise<void>;
}) {
    const activeProvider = providers.find((provider) => provider.id === activeProviderId) || providers[0];
    return (
        <div className="grid gap-4 xl:grid-cols-[16rem_1fr]">
            <Panel>
                <div className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Provider 列表</div>
                <div className="space-y-1">
                    {providers.map((provider) => (
                        <NavLink
                            key={provider.id}
                            to={`/settings/providers/${provider.id}`}
                            className={({ isActive }) =>
                                [
                                    'block rounded-lg px-3 py-2 text-sm transition-colors',
                                    isActive || activeProvider?.id === provider.id
                                        ? 'bg-[var(--accent-primary)]/18 text-[var(--text-primary)]'
                                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]',
                                ].join(' ')
                            }
                        >
                            <div className="font-medium">{provider.label}</div>
                            <div className="mt-0.5 truncate text-xs text-[var(--text-muted)]">{provider.type}</div>
                        </NavLink>
                    ))}
                </div>
            </Panel>

            {activeProvider ? <ProviderDetails provider={activeProvider} onReload={onReload} /> : null}
        </div>
    );
}

function ProviderDetails({ provider, onReload }: { provider: RuntimeProvider; onReload: () => Promise<void> }) {
    const isSousaku = provider.type === 'sousaku';
    const [label, setLabel] = useState(provider.label);
    const [enabled, setEnabled] = useState(provider.enabled);
    const [baseUrl, setBaseUrl] = useState(provider.baseUrl);
    const [apiKey, setApiKey] = useState(provider.apiKey || '');
    const [notes, setNotes] = useState(provider.notes || '');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setLabel(provider.label);
        setEnabled(provider.enabled);
        setBaseUrl(provider.baseUrl);
        setApiKey(provider.apiKey || '');
        setNotes(provider.notes || '');
    }, [provider]);

    const handleSave = useCallback(async () => {
        if (saving) return;
        setSaving(true);
        try {
            await saveRuntimeProvider(provider.id, {
                label: label.trim() || provider.label,
                enabled,
                ...(!isSousaku ? {
                    baseUrl: baseUrl.trim(),
                    apiKey: apiKey.trim(),
                } : {}),
                notes: notes.trim(),
            });
            notifyProvidersUpdated();
            await onReload();
        } finally {
            setSaving(false);
        }
    }, [apiKey, baseUrl, enabled, isSousaku, label, notes, onReload, provider.id, provider.label, saving]);

    return (
        <div>
            <SectionHeader
                title={provider.label}
                subtitle={provider.type}
                actions={
                    <>
                        <SourceBadge source={provider.source} />
                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={saving}
                            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--text-secondary)] transition-colors hover:border-[var(--text-muted)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                            保存
                        </button>
                    </>
                }
            />
            <Panel>
                <div className="grid gap-4 xl:grid-cols-2">
                    <label className="block">
                        <span className="mb-2 block text-xs text-[var(--text-muted)]">显示名称</span>
                        <input
                            value={label}
                            onChange={(event) => setLabel(event.target.value)}
                            className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]"
                        />
                    </label>
                    <label className="block">
                        <span className="mb-2 block text-xs text-[var(--text-muted)]">类型</span>
                        <input
                            value={provider.type}
                            readOnly
                            className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-muted)] outline-none"
                        />
                    </label>
                    {!isSousaku && (
                        <>
                            <label className="block xl:col-span-2">
                                <span className="mb-2 block text-xs text-[var(--text-muted)]">Base URL</span>
                                <input
                                    value={baseUrl}
                                    onChange={(event) => setBaseUrl(event.target.value)}
                                    className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 font-mono text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]"
                                />
                            </label>
                            <label className="block">
                                <span className="mb-2 block text-xs text-[var(--text-muted)]">API Key</span>
                                <input
                                    value={apiKey}
                                    onChange={(event) => setApiKey(event.target.value)}
                                    placeholder="未配置"
                                    className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 font-mono text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]"
                                />
                            </label>
                        </>
                    )}
                    <div className="xl:col-span-2">
                        <Toggle checked={enabled} onChange={setEnabled} label="启用 Provider" />
                    </div>
                    <label className="block xl:col-span-2">
                        <span className="mb-2 block text-xs text-[var(--text-muted)]">备注</span>
                        <textarea
                            value={notes}
                            onChange={(event) => setNotes(event.target.value)}
                            rows={3}
                            className="w-full resize-none rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]"
                        />
                    </label>
                </div>
                <div className="mt-5">
                    <div className="mb-2 text-xs text-[var(--text-muted)]">能力</div>
                    <div className="flex flex-wrap gap-2">
                        {provider.capabilities.map((capability) => (
                            <span
                                key={capability}
                                className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2.5 py-1 text-xs text-[var(--text-secondary)]"
                            >
                                {capability}
                            </span>
                        ))}
                    </div>
                </div>
                {provider.notes && <p className="mt-5 text-sm text-[var(--text-muted)]">{provider.notes}</p>}
            </Panel>
        </div>
    );
}

function JobsPanel({ settings }: { settings?: BackendSettings }) {
    const limits = settings?.jobs.providerLimits.value || {};
    return (
        <div>
            <SectionHeader title="任务" subtitle="Worker、并发和轮询参数" />
            <Panel>
                <SettingRow label="Worker" value={String(settings?.jobs.maxWorkers.value ?? '-')} source={settings?.jobs.maxWorkers.source} />
                <SettingRow label="轮询间隔" value={`${settings?.jobs.pollIntervalSeconds.value ?? '-'} 秒`} source={settings?.jobs.pollIntervalSeconds.source} />
                <SettingRow
                    label="默认超时"
                    value={`${Math.round((settings?.jobs.defaultTimeoutSeconds.value || 0) / 60)} 分钟`}
                    source={settings?.jobs.defaultTimeoutSeconds.source}
                />
                <div className="py-3">
                    <div className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Provider 并发</div>
                    <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)]">
                        {Object.entries(limits).map(([provider, limit]) => (
                            <div key={provider} className="grid grid-cols-[1fr_6rem] border-b border-[var(--border-subtle)] px-3 py-2 text-sm last:border-b-0">
                                <span className="text-[var(--text-secondary)]">{provider}</span>
                                <span className="text-right font-mono text-[var(--text-primary)]">{limit}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </Panel>
        </div>
    );
}

function StoragePanel({ settings, onReload }: { settings?: BackendSettings; onReload: () => Promise<void> }) {
    const [saveDir, setSaveDir] = useState('');
    const [thumbnailWidth, setThumbnailWidth] = useState(512);
    const [thumbnailQuality, setThumbnailQuality] = useState(78);
    const [thumbnailCacheMaxGb, setThumbnailCacheMaxGb] = useState(3);
    const [saving, setSaving] = useState(false);
    const reloadGalleryFromServer = useStore((state) => state.reloadGalleryFromServer);

    useEffect(() => {
        setSaveDir(settings?.paths.saveDir.value || '');
        setThumbnailWidth(settings?.gallery.thumbnailWidth.value || 512);
        setThumbnailQuality(settings?.gallery.thumbnailQuality.value || 78);
        setThumbnailCacheMaxGb(settings?.gallery.thumbnailCacheMaxGb.value || 3);
    }, [settings]);

    const handleSave = useCallback(async () => {
        if (saving) return;
        setSaving(true);
        try {
            await saveBackendSettings({
                storage: {
                    saveDir: saveDir.trim(),
                },
                gallery: {
                    thumbnailWidth,
                    thumbnailQuality,
                    thumbnailCacheMaxGb,
                },
            });
            await onReload();
            await reloadGalleryFromServer();
        } finally {
            setSaving(false);
        }
    }, [onReload, reloadGalleryFromServer, saveDir, saving, thumbnailCacheMaxGb, thumbnailQuality, thumbnailWidth]);

    return (
        <div>
            <SectionHeader
                title="存储"
                subtitle="图片目录、数据库和缩略图缓存"
                actions={
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={saving}
                        className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--text-secondary)] transition-colors hover:border-[var(--text-muted)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        保存
                    </button>
                }
            />
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.8fr)]">
                <Panel>
                    <div className="space-y-4">
                        <label className="block">
                            <span className="mb-2 block text-xs text-[var(--text-muted)]">图片保存目录</span>
                            <input
                                value={saveDir}
                                onChange={(event) => setSaveDir(event.target.value)}
                                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 font-mono text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]"
                            />
                            <span className="mt-1 block truncate text-xs text-[var(--text-muted)]">
                                当前解析路径：{settings?.paths.saveDir.resolved || '-'}
                            </span>
                        </label>
                        <div className="grid gap-3 md:grid-cols-3">
                            <label className="block">
                                <span className="mb-2 block text-xs text-[var(--text-muted)]">缩略图宽度</span>
                                <input
                                    type="number"
                                    min={128}
                                    max={2048}
                                    step={64}
                                    value={thumbnailWidth}
                                    onChange={(event) => setThumbnailWidth(Number(event.target.value))}
                                    className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]"
                                />
                            </label>
                            <label className="block">
                                <span className="mb-2 block text-xs text-[var(--text-muted)]">缩略图质量</span>
                                <input
                                    type="number"
                                    min={30}
                                    max={95}
                                    value={thumbnailQuality}
                                    onChange={(event) => setThumbnailQuality(Number(event.target.value))}
                                    className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]"
                                />
                            </label>
                            <label className="block">
                                <span className="mb-2 block text-xs text-[var(--text-muted)]">缓存上限 GB</span>
                                <input
                                    type="number"
                                    min={1}
                                    max={100}
                                    value={thumbnailCacheMaxGb}
                                    onChange={(event) => setThumbnailCacheMaxGb(Number(event.target.value))}
                                    className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]"
                                />
                            </label>
                        </div>
                    </div>
                </Panel>
                <Panel>
                    <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                        <Database className="h-4 w-4 text-[var(--accent-primary)]" />
                        数据库
                    </div>
                    <SettingRow label="任务数据库" value={<PathValue value={settings?.paths.jobsDb} />} source={settings?.paths.jobsDb.source} />
                    <SettingRow label="图廊数据库" value={<PathValue value={settings?.paths.galleryDb} />} source={settings?.paths.galleryDb.source} />
                </Panel>
            </div>
        </div>
    );
}

function NetworkPanel({ settings }: { settings?: BackendSettings }) {
    const proxies = settings?.network.httpProxies.value;
    return (
        <div>
            <SectionHeader title="网络" subtitle="代理和连接参数" />
            <Panel>
                <SettingRow label="HTTP 代理" value={proxies?.http || '未启用'} source={settings?.network.httpProxies.source} />
                <SettingRow label="HTTPS 代理" value={proxies?.https || '未启用'} source={settings?.network.httpProxies.source} />
            </Panel>
        </div>
    );
}

function AdvancedPanel({ settings }: { settings?: BackendSettings }) {
    const configFiles = settings?.configFiles || {};
    return (
        <div>
            <SectionHeader title="高级" subtitle="配置来源、端口和诊断信息" />
            <div className="grid gap-4 xl:grid-cols-2">
                <Panel>
                    <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                        <Shield className="h-4 w-4 text-[var(--accent-primary)]" />
                        服务
                    </div>
                    <SettingRow label="后端端口" value={String(settings?.server.backendPort.value ?? '-')} source={settings?.server.backendPort.source} />
                    <SettingRow label="前端端口" value={String(settings?.server.frontendPort.value ?? '-')} source={settings?.server.frontendPort.source} />
                    <SettingRow label="自动重载" value={settings?.server.useReloader.value ? '开启' : '关闭'} source={settings?.server.useReloader.source} />
                </Panel>
                <Panel>
                    <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                        <Database className="h-4 w-4 text-[var(--accent-primary)]" />
                        配置文件
                    </div>
                    {Object.entries(configFiles).map(([key, file]) => (
                        <SettingRow
                            key={key}
                            label={key}
                            value={
                                <div className="flex items-center gap-2">
                                    {file.exists ? <Check className="h-4 w-4 text-emerald-400" /> : <span className="h-4 w-4 rounded-full border border-[var(--border-subtle)]" />}
                                    <span className="font-mono text-xs">{file.path}</span>
                                </div>
                            }
                            source={file.exists ? '文件存在' : '未创建'}
                        />
                    ))}
                </Panel>
            </div>
        </div>
    );
}

function LoadingPanel() {
    return (
        <div className="flex min-h-[24rem] items-center justify-center text-[var(--text-muted)]">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            加载设置
        </div>
    );
}

export function SettingsPage() {
    const params = useParams();
    const navigate = useNavigate();
    const section = (params.category || 'preferences') as SectionId;
    const [settings, setSettings] = useState<BackendSettings>();
    const [providers, setProviders] = useState<RuntimeProvider[]>([]);
    const [loading, setLoading] = useState(true);
    const [resetting, setResetting] = useState(false);
    const resetUiSettingsToDefaults = useStore((state) => state.resetUiSettingsToDefaults);

    const loadSettings = useCallback(async (cancelled?: () => boolean) => {
        setLoading(true);
        try {
            const [settingsData, providerData] = await Promise.all([
                loadBackendSettings(),
                loadRuntimeProviders(),
            ]);
            if (!cancelled?.()) {
                setSettings(settingsData);
                setProviders(providerData);
            }
        } finally {
            if (!cancelled?.()) setLoading(false);
        }
    }, []);

    useEffect(() => {
        let cancelled = false;
        loadSettings(() => cancelled).catch(() => {
            if (!cancelled) setLoading(false);
        });
        return () => {
            cancelled = true;
        };
    }, [loadSettings]);

    useEffect(() => {
        const valid = SECTIONS.some((item) => item.id === section);
        if (!valid) {
            navigate('/settings/preferences', { replace: true });
            return;
        }
        if (section === 'providers' && providers.length > 0 && !params.item) {
            navigate(`/settings/providers/${providers[0].id}`, { replace: true });
        }
    }, [navigate, params.item, providers, section]);

    const activeSection = useMemo(
        () => SECTIONS.find((item) => item.id === section) || SECTIONS[0],
        [section],
    );

    const handleResetDefaults = useCallback(async () => {
        if (resetting) return;
        setResetting(true);
        try {
            await resetUiSettingsToDefaults();
            await loadSettings();
        } finally {
            setResetting(false);
        }
    }, [loadSettings, resetUiSettingsToDefaults, resetting]);

    return (
        <main className="mx-auto flex w-full max-w-[1800px] flex-1 flex-col gap-4 px-4 py-4">
            <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
                <div>
                    <div className="text-lg font-semibold text-[var(--text-primary)]">设置</div>
                    <div className="text-xs text-[var(--text-muted)]">本地工作台、Provider 和运行参数</div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        disabled={resetting}
                        onClick={handleResetDefaults}
                        className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--text-secondary)] transition-colors hover:border-[var(--text-muted)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {resetting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
                        恢复默认
                    </button>
                </div>
            </section>

            <div className="grid min-h-[calc(100vh-8rem)] gap-4 lg:grid-cols-[13rem_1fr]">
                <aside className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-2">
                    <nav className="space-y-1">
                        {SECTIONS.map((item) => {
                            const Icon = item.icon;
                            return (
                                <NavLink
                                    key={item.id}
                                    to={`/settings/${item.id}`}
                                    className={({ isActive }) =>
                                        [
                                            'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
                                            isActive || activeSection.id === item.id
                                                ? 'bg-[var(--accent-primary)]/18 text-[var(--text-primary)]'
                                                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]',
                                        ].join(' ')
                                    }
                                >
                                    <Icon className="h-4 w-4" />
                                    {item.label}
                                </NavLink>
                            );
                        })}
                    </nav>
                </aside>

                <section className="min-w-0">
                    {loading ? (
                        <LoadingPanel />
                    ) : section === 'preferences' ? (
                        <PreferencesPanel />
                    ) : section === 'providers' ? (
                        <ProviderPanel providers={providers} activeProviderId={params.item} onReload={() => loadSettings()} />
                    ) : section === 'jobs' ? (
                        <JobsPanel settings={settings} />
                    ) : section === 'storage' ? (
                        <StoragePanel settings={settings} onReload={() => loadSettings()} />
                    ) : section === 'network' ? (
                        <NetworkPanel settings={settings} />
                    ) : (
                        <AdvancedPanel settings={settings} />
                    )}
                </section>
            </div>
        </main>
    );
}
