import { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Download, Trash2, Palette, ChevronDown } from 'lucide-react';
import { useStore } from '../../store';
import { saveThoughtImage } from '../../services/api';

export function ThoughtNotification() {
    const thoughtImages = useStore((s) => s.thoughtImages);
    const removeThoughtImage = useStore((s) => s.removeThoughtImage);
    const clearThoughtImages = useStore((s) => s.clearThoughtImages);
    const [isExpanded, setIsExpanded] = useState(false);
    const [savingIds, setSavingIds] = useState<Set<string>>(new Set());

    // Distinguish drag from click
    const isDragging = useRef(false);

    const handleSave = useCallback(async (id: string, dataUri: string) => {
        setSavingIds((prev) => new Set(prev).add(id));
        try {
            await saveThoughtImage(dataUri);
            removeThoughtImage(id);
        } catch (e) {
            console.error('Failed to save thought image:', e);
        } finally {
            setSavingIds((prev) => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
        }
    }, [removeThoughtImage]);

    const handleDismiss = useCallback((id: string) => {
        removeThoughtImage(id);
    }, [removeThoughtImage]);

    const handleDismissAll = useCallback(() => {
        clearThoughtImages();
        setIsExpanded(false);
    }, [clearThoughtImages]);

    if (thoughtImages.length === 0) return null;

    return (
        <>
            {/* ── Draggable circular icon (always mounted, hidden when expanded) ── */}
            <motion.div
                drag
                dragMomentum={false}
                dragElastic={0.1}
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{
                    opacity: isExpanded ? 0 : 1,
                    scale: isExpanded ? 0.5 : 1,
                    pointerEvents: isExpanded ? 'none' as const : 'auto' as const,
                }}
                whileHover={isExpanded ? undefined : { scale: 1.12 }}
                whileTap={isExpanded ? undefined : { scale: 0.95 }}
                onDragStart={() => { isDragging.current = true; }}
                onDragEnd={() => {
                    setTimeout(() => { isDragging.current = false; }, 50);
                }}
                onClick={() => {
                    if (!isDragging.current) setIsExpanded(true);
                }}
                className="fixed bottom-20 right-4 z-50 w-11 h-11 rounded-full text-white shadow-lg flex items-center justify-center cursor-grab active:cursor-grabbing border border-white/20"
                style={{
                    background: 'linear-gradient(135deg, #8B5CF6 0%, #6366F1 50%, #4F46E5 100%)',
                    boxShadow: '0 4px 15px rgba(139, 92, 246, 0.4), inset 0 1px 0 rgba(255,255,255,0.15)',
                }}
            >
                <Palette className="w-5 h-5" />
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center shadow-sm">
                    {thoughtImages.length}
                </span>
            </motion.div>

            {/* ── Expanded panel ── */}
            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ opacity: 0, y: 20, scale: 0.9 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 20, scale: 0.9 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                        className="fixed bottom-20 right-4 z-50 w-80 rounded-xl overflow-hidden border border-[var(--border-subtle)] bg-[var(--bg-card)] shadow-2xl"
                        style={{ backdropFilter: 'blur(16px)' }}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between px-4 py-3">
                            <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
                                    <Palette className="w-4 h-4 text-purple-400" />
                                </div>
                                <div>
                                    <p className="text-sm font-medium text-[var(--text-primary)]">
                                        {thoughtImages.length} 张草图
                                    </p>
                                    <p className="text-xs text-[var(--text-muted)]">
                                        来自 Thinking 阶段
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={handleDismissAll}
                                    className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                    title="全部忽略"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={() => setIsExpanded(false)}
                                    className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
                                    title="收起"
                                >
                                    <ChevronDown className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {/* Image list */}
                        <div className="px-4 pb-3 space-y-3 max-h-[50vh] overflow-y-auto">
                            {thoughtImages.map((img) => (
                                <motion.div
                                    key={img.id}
                                    layout
                                    initial={{ opacity: 0, x: 20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -20 }}
                                    className="rounded-lg overflow-hidden border border-[var(--border-subtle)] bg-[var(--bg-secondary)]"
                                >
                                    <img
                                        src={img.data_uri}
                                        alt="Thought draft"
                                        className="w-full h-auto max-h-48 object-contain bg-black/20"
                                    />
                                    <div className="flex gap-2 p-2">
                                        <button
                                            onClick={() => handleSave(img.id, img.data_uri)}
                                            disabled={savingIds.has(img.id)}
                                            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 transition-colors disabled:opacity-50"
                                        >
                                            <Download className="w-3.5 h-3.5" />
                                            {savingIds.has(img.id) ? '保存中...' : '保存到本地'}
                                        </button>
                                        <button
                                            onClick={() => handleDismiss(img.id)}
                                            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--bg-primary)] text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                            忽略
                                        </button>
                                    </div>
                                </motion.div>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}
