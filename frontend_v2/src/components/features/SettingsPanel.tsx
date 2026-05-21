import { MoreHorizontal } from 'lucide-react';
import { useStore } from '../../store';
import type { GalleryColumnSize } from '../../store';
import { useState, useRef, useEffect, useCallback } from 'react';

const COLUMN_OPTIONS: { label: string; value: GalleryColumnSize }[] = [
    { label: '小', value: 7 },
    { label: '中', value: 6 },
    { label: '大', value: 5 },
];

export function SettingsPanel() {
    const galleryColumns = useStore((s) => s.galleryColumns);
    const setGalleryColumns = useStore((s) => s.setGalleryColumns);
    const deleteLocalFile = useStore((s) => s.deleteLocalFile);
    const setDeleteLocalFile = useStore((s) => s.setDeleteLocalFile);
    const deleteImportedOriginal = useStore((s) => s.deleteImportedOriginal);
    const setDeleteImportedOriginal = useStore((s) => s.setDeleteImportedOriginal);

    const [open, setOpen] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    const handleColumnChange = useCallback(
        (value: GalleryColumnSize) => setGalleryColumns(value),
        [setGalleryColumns]
    );

    return (
        <div className="relative" ref={panelRef}>
            {/* Trigger button */}
            <button
                onClick={() => setOpen((v) => !v)}
                className={`flex h-10 w-10 items-center justify-center rounded-lg border transition-colors ${
                    open
                        ? 'bg-[var(--accent-primary)]/20 border-[var(--accent-primary)] text-[var(--accent-primary)]'
                        : 'bg-[var(--bg-secondary)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]'
                }`}
                title="配置"
            >
                <MoreHorizontal className="w-4 h-4" />
            </button>

            {/* Dropdown panel */}
            {open && (
                <div className="absolute left-1/2 top-full z-50 mt-2 w-64 -translate-x-1/2 rounded-2xl border border-[var(--border-subtle)] bg-[rgba(18,18,22,0.94)] p-4 shadow-[0_18px_48px_rgba(0,0,0,0.42)] backdrop-blur-xl animate-fade-in">
                    {/* Section: Thumbnail size */}
                    <div className="mb-4">
                        <div className="text-xs text-[var(--text-muted)] mb-2 font-medium">缩略图大小</div>
                        <div className="flex overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/70">
                            {COLUMN_OPTIONS.map((opt) => (
                                <button
                                    key={opt.value}
                                    onClick={() => handleColumnChange(opt.value)}
                                    className={`flex-1 py-1.5 text-sm font-medium transition-colors ${
                                        galleryColumns === opt.value
                                            ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] shadow-[inset_0_0_0_1px_rgba(244,63,94,0.22)]'
                                            : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]'
                                    }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Divider */}
                    <div className="border-t border-[var(--border-subtle)] my-3" />

                    {/* Section: Delete local file toggle */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-sm text-[var(--text-primary)]">删除本地文件</div>
                                <div className="text-xs text-[var(--text-muted)] mt-0.5">
                                    {deleteLocalFile ? '删除画廊时同时删除本地' : '仅从画廊移除'}
                                </div>
                            </div>
                            <button
                                onClick={() => setDeleteLocalFile(!deleteLocalFile)}
                                className={`relative h-6 w-11 rounded-full border transition-colors ${
                                    deleteLocalFile
                                        ? 'border-[var(--accent-primary)]/45 bg-[var(--accent-primary)]/20 shadow-[0_0_14px_rgba(244,63,94,0.12)]'
                                        : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)]'
                                }`}
                                aria-pressed={deleteLocalFile}
                            >
                                <span
                                    className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full shadow transition-all ${
                                        deleteLocalFile
                                            ? 'translate-x-5 bg-[var(--accent-primary)]'
                                            : 'translate-x-0 bg-[var(--text-muted)]'
                                    }`}
                                />
                            </button>
                        </div>

                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-sm text-[var(--text-primary)]">删除导入原文件</div>
                                <div className="text-xs text-[var(--text-muted)] mt-0.5">
                                    {deleteImportedOriginal ? '导入成功后尝试删除源文件' : '保留导入前的源文件'}
                                </div>
                            </div>
                            <button
                                onClick={() => setDeleteImportedOriginal(!deleteImportedOriginal)}
                                className={`relative h-6 w-11 rounded-full border transition-colors ${
                                    deleteImportedOriginal
                                        ? 'border-[var(--accent-primary)]/45 bg-[var(--accent-primary)]/20 shadow-[0_0_14px_rgba(244,63,94,0.12)]'
                                        : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)]'
                                }`}
                                aria-pressed={deleteImportedOriginal}
                            >
                                <span
                                    className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full shadow transition-all ${
                                        deleteImportedOriginal
                                            ? 'translate-x-5 bg-[var(--accent-primary)]'
                                            : 'translate-x-0 bg-[var(--text-muted)]'
                                    }`}
                                />
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
