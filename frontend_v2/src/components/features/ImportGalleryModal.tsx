import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { Check, ImagePlus, Loader2, Upload, X } from 'lucide-react';
import { importGalleryImages, importPickedLocalGalleryFiles, pickLocalGalleryFiles } from '../../services/api';
import { useStore } from '../../store';
import type { ImageItem } from '../../types';
import { useProviders } from '../../hooks/useProviders';
import { importProviderOptions } from '../../utils/providers';

interface ImportGalleryModalProps {
    onClose: () => void;
}

interface LocalFileHandle {
    getFile: () => Promise<File>;
    remove?: () => Promise<void>;
    requestPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
}

interface LocalFileEntry {
    key: string;
    file?: File;
    name: string;
    previewUrl?: string;
    token?: string;
    handle?: LocalFileHandle;
}

type WindowWithFilePicker = Window & {
    showOpenFilePicker?: (options?: {
        multiple?: boolean;
        types?: Array<{
            description: string;
            accept: Record<string, string[]>;
        }>;
    }) => Promise<LocalFileHandle[]>;
};

export function ImportGalleryModal({ onClose }: ImportGalleryModalProps) {
    const addImportedImages = useStore((s) => s.addImportedImages);
    const deleteImportedOriginal = useStore((s) => s.deleteImportedOriginal);
    const backendCapabilities = useStore((s) => s.backendCapabilities);
    const { providers } = useProviders();
    const inputRef = useRef<HTMLInputElement>(null);
    const backdropPressRef = useRef<{ started: boolean; x: number; y: number }>({ started: false, x: 0, y: 0 });
    const [entries, setEntries] = useState<LocalFileEntry[]>([]);
    const [prompt, setPrompt] = useState('外部导入图片');
    const [apiType, setApiType] = useState<ImageItem['apiType']>('other');
    const [tags, setTags] = useState('');
    const [isImporting, setIsImporting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [importedCount, setImportedCount] = useState(0);
    const [deletedOriginalCount, setDeletedOriginalCount] = useState(0);
    const [deleteOriginalSkippedCount, setDeleteOriginalSkippedCount] = useState(0);
    const apiOptions = useMemo(() => importProviderOptions(providers), [providers]);

    const previews = useMemo(
        () => entries.map((entry) => ({
            key: entry.key,
            name: entry.name,
            url: entry.file ? URL.createObjectURL(entry.file) : entry.previewUrl || '',
        })),
        [entries]
    );

    useEffect(() => () => {
        previews.forEach((preview) => URL.revokeObjectURL(preview.url));
    }, [previews]);

    const addEntries = (nextEntries: LocalFileEntry[]) => {
        setEntries((prev) => {
            const seen = new Set(prev.map((entry) => entry.key));
            return [
                ...prev,
                ...nextEntries.filter((entry) => !seen.has(entry.key)),
            ];
        });
        setError(null);
        setImportedCount(0);
        setDeletedOriginalCount(0);
        setDeleteOriginalSkippedCount(0);
    };

    const handleFiles = (fileList: FileList | null) => {
        if (!fileList) return;
        const next = Array.from(fileList)
            .filter((file) => file.type.startsWith('image/'))
            .map((file) => ({
                key: `${file.name}:${file.size}:${file.lastModified}`,
                file,
                name: file.name,
            }));
        addEntries(next);
    };

    const handlePickFiles = async () => {
        if (deleteImportedOriginal && backendCapabilities.features.localPickerImport) {
            await handlePickBackendLocalFiles();
            return;
        }

        const picker = (window as WindowWithFilePicker).showOpenFilePicker;
        if (!picker) {
            inputRef.current?.click();
            return;
        }

        try {
            const handles = await picker({
                multiple: true,
                types: [{
                    description: '图片文件',
                    accept: {
                        'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tiff', '.tif'],
                    },
                }],
            });
            const next = await Promise.all(handles.map(async (handle) => {
                const file = await handle.getFile();
                return {
                    key: `${file.name}:${file.size}:${file.lastModified}`,
                    file,
                    name: file.name,
                    handle,
                };
            }));
            addEntries(next.filter((entry) => entry.file.type.startsWith('image/')));
        } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') {
                return;
            }
            inputRef.current?.click();
        }
    };

    const deleteOriginalFiles = async (currentEntries: LocalFileEntry[]) => {
        if (!deleteImportedOriginal) {
            setDeletedOriginalCount(0);
            setDeleteOriginalSkippedCount(0);
            return;
        }

        setDeletedOriginalCount(0);
        setDeleteOriginalSkippedCount(currentEntries.length);
    };

    const handlePickBackendLocalFiles = async () => {
        if (isImporting) return;
        setIsImporting(true);
        setError(null);
        setImportedCount(0);
        setDeletedOriginalCount(0);
        setDeleteOriginalSkippedCount(0);

        try {
            const picked = await pickLocalGalleryFiles();
            addEntries(picked.map((item) => ({
                key: item.token,
                name: item.name,
                previewUrl: item.previewUrl,
                token: item.token,
            })));
        } catch (err) {
            const message = err instanceof Error ? err.message : '导入失败';
            if (message !== 'No images selected') {
                setError(message);
            }
        } finally {
            setIsImporting(false);
        }
    };

    const handleImport = async () => {
        if (entries.length === 0 || isImporting) return;
        setIsImporting(true);
        setError(null);
        setImportedCount(0);
        setDeletedOriginalCount(0);
        setDeleteOriginalSkippedCount(0);

        try {
            const currentEntries = entries;
            const localTokens = currentEntries.map((entry) => entry.token).filter((token): token is string => !!token);
            if (localTokens.length > 0) {
                const result = await importPickedLocalGalleryFiles({
                    tokens: localTokens,
                    prompt: prompt.trim() || '外部导入图片',
                    apiType,
                    ratio: 'auto',
                    quality: 'imported',
                    tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
                    deleteOriginal: deleteImportedOriginal,
                });
                addImportedImages(result.images);
                setImportedCount(result.images.length);
                setDeletedOriginalCount(result.deletedOriginalCount);
                setDeleteOriginalSkippedCount(result.deleteOriginalSkippedCount);
            } else {
                const uploadEntries = currentEntries.filter((entry): entry is LocalFileEntry & { file: File } => !!entry.file);
                const images = await importGalleryImages({
                    files: uploadEntries.map((entry) => entry.file),
                    prompt: prompt.trim() || '外部导入图片',
                    apiType,
                    ratio: 'auto',
                    quality: 'imported',
                    tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
                });
                addImportedImages(images);
                setImportedCount(images.length);
                await deleteOriginalFiles(uploadEntries);
            }
            setEntries([]);
        } catch (err) {
            setError(err instanceof Error ? err.message : '导入失败');
        } finally {
            setIsImporting(false);
        }
    };

    const handleBackdropPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        backdropPressRef.current = {
            started: e.target === e.currentTarget,
            x: e.clientX,
            y: e.clientY,
        };
    };

    const handleBackdropPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        const press = backdropPressRef.current;
        backdropPressRef.current = { started: false, x: 0, y: 0 };

        const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
        if (press.started && e.target === e.currentTarget && moved < 6) {
            onClose();
        }
    };

    const cancelBackdropPress = (e: React.PointerEvent<HTMLDivElement>) => {
        backdropPressRef.current = { started: false, x: 0, y: 0 };
        e.stopPropagation();
    };

    return createPortal(
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onPointerDown={handleBackdropPointerDown}
            onPointerUp={handleBackdropPointerUp}
        >
            <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="w-full max-w-xl max-h-[calc(100vh-2rem)] rounded-xl glass shadow-2xl border border-[var(--border-subtle)] flex flex-col overflow-hidden"
                onPointerDown={cancelBackdropPress}
                onPointerUp={cancelBackdropPress}
                onPointerCancel={cancelBackdropPress}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex shrink-0 items-center justify-between px-5 py-4 border-b border-[var(--border-subtle)]">
                    <div className="flex items-center gap-2">
                        <ImagePlus className="w-5 h-5 text-[var(--accent-primary)]" />
                        <h2 className="text-lg font-semibold text-[var(--text-primary)]">导入到画廊</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]"
                        title="关闭"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-5 space-y-4 overflow-y-auto">
                    <input
                        ref={inputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(e) => handleFiles(e.target.files)}
                    />

                    <button
                        onClick={handlePickFiles}
                        disabled={isImporting}
                        className="w-full min-h-36 rounded-xl border-2 border-dashed border-[var(--border-subtle)] hover:border-[var(--accent-primary)] bg-[var(--bg-secondary)]/70 text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-colors flex flex-col items-center justify-center gap-2 disabled:opacity-60"
                    >
                        {isImporting ? <Loader2 className="w-7 h-7 animate-spin" /> : <Upload className="w-7 h-7" />}
                        <span className="text-sm">
                            {deleteImportedOriginal && backendCapabilities.features.localPickerImport
                                ? '选择或追加图片'
                                : '选择或追加图片'}
                        </span>
                    </button>

                    {entries.length > 0 && (
                        <div className="grid grid-cols-5 gap-2 max-h-40 overflow-y-auto">
                            {previews.map((preview) => (
                                <div key={preview.key} className="relative aspect-square rounded-lg overflow-hidden bg-[var(--bg-secondary)]">
                                    <img src={preview.url} alt={preview.name} className="w-full h-full object-cover" />
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className="space-y-1">
                            <span className="text-xs text-[var(--text-muted)]">来源</span>
                            <select
                                value={apiType}
                                onChange={(e) => setApiType(e.target.value as ImageItem['apiType'])}
                                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                            >
                                {apiOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </label>

                        <label className="space-y-1">
                            <span className="text-xs text-[var(--text-muted)]">标签</span>
                            <input
                                value={tags}
                                onChange={(e) => setTags(e.target.value)}
                                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                            />
                        </label>
                    </div>

                    <label className="space-y-1 block">
                        <span className="text-xs text-[var(--text-muted)]">Prompt / 备注</span>
                        <textarea
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            rows={3}
                            className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)] resize-none"
                        />
                    </label>

                    {error && (
                        <div className="px-3 py-2 rounded-lg bg-red-500/15 text-red-400 text-sm">
                            {error}
                        </div>
                    )}

                    {importedCount > 0 && (
                        <div className="px-3 py-2 rounded-lg bg-emerald-500/15 text-emerald-400 text-sm flex items-center gap-2">
                            <Check className="w-4 h-4" />
                            已导入 {importedCount} 张图片
                            {deleteImportedOriginal && deletedOriginalCount > 0 ? `，已删除 ${deletedOriginalCount} 个源文件` : ''}
                            {deleteImportedOriginal && deleteOriginalSkippedCount > 0 ? `，${deleteOriginalSkippedCount} 个源文件未删除` : ''}
                        </div>
                    )}
                </div>

                <div className="flex shrink-0 items-center justify-between px-5 py-4 border-t border-[var(--border-subtle)]">
                    <span className="text-sm text-[var(--text-secondary)]">已选择 {entries.length} 张</span>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setEntries([])}
                            disabled={entries.length === 0 || isImporting}
                            className="px-3 py-2 rounded-lg text-sm bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] disabled:opacity-50"
                        >
                            清空
                        </button>
                        <button
                            onClick={handleImport}
                            disabled={entries.length === 0 || isImporting}
                            className="min-w-24 px-3 py-2 rounded-lg text-sm bg-[var(--accent-primary)] text-white hover:bg-[var(--accent-secondary)] disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                            导入
                        </button>
                    </div>
                </div>
            </motion.div>
        </motion.div>,
        document.body
    );
}
