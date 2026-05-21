import { motion, AnimatePresence } from 'framer-motion';
import { X, Copy, Star, Plus, Folder, Loader2 } from 'lucide-react';
import { useStore } from '../../store';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { useState } from 'react';
import React from 'react';
import type { ImageItem } from '../../types';
import axios from 'axios';
import { TransformWrapper, TransformComponent, useControls } from 'react-zoom-pan-pinch';

function formatSousakuModel(model: string) {
    const labels: Record<string, string> = {
        low: 'GPT Image 2.0 Low',
        medium: 'GPT Image 2.0 Medium',
        high: 'GPT Image 2.0 High',
        'gpt-image-2-4k': 'GPT Image 2.0 Medium',
        'gpt-image-2-high-4k': 'GPT Image 2.0 High',
        'gpt-image-2-low': 'GPT Image 2.0 Low',
        'gpt-image-2': 'GPT Image 2.0 Medium',
        'gpt-image-2-medium': 'GPT Image 2.0 Medium',
        'gpt-image-2-high': 'GPT Image 2.0 High',
        'wan-image-2.7-pro': 'WAN Image 2.7 Pro',
        'mj-image-v7': 'Midjourney V7',
        'mj-image-niji-7': 'Midjourney Niji 7',
    };
    return labels[model] || model;
}

// Reset button that lives inside TransformWrapper context
function ResetButton() {
    const { resetTransform } = useControls();
    return (
        <button
            onClick={(e) => { e.stopPropagation(); resetTransform(); }}
            className="px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs backdrop-blur-md border border-white/20 transition-all flex items-center gap-1"
            title="双击图片也可重置"
        >
            重置
        </button>
    );
}

// Quick zoom button that cycles [1, 3, 5, 7]
function QuickZoomButton({ currentScale }: { currentScale: number }) {
    const { centerView } = useControls();
    
    const handleQuickZoom = (e: React.MouseEvent) => {
        e.stopPropagation();
        
        // Helper to zoom and center smoothly
        const zoomAndCenter = (targetScale: number) => {
            centerView(targetScale, 400);
        };

        if (currentScale < 2.5) {
            zoomAndCenter(3);
        } else if (currentScale < 4.5) {
            zoomAndCenter(5);
        } else if (currentScale < 6.5) {
            zoomAndCenter(7);
        } else {
            zoomAndCenter(1);
        }
    };

    // Calculate display multiplier (1x, 3x, 5x, 7x)
    let displayMulti = "1";
    if (currentScale >= 2.5 && currentScale < 4.5) displayMulti = "3";
    else if (currentScale >= 4.5 && currentScale < 6.5) displayMulti = "5";
    else if (currentScale >= 6.5) displayMulti = "7";

    return (
        <button
            onClick={handleQuickZoom}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-bold backdrop-blur-md border border-white/20 transition-all flex items-center justify-center"
            title="快速调整倍率"
        >
            x{displayMulti}
        </button>
    );
}

interface ImageModalProps {
    image: ImageItem;
    onClose: () => void;
}

export function ImageModal({ image: initialImage, onClose }: ImageModalProps) {
    const toggleFavorite = useStore((s) => s.toggleFavorite);
    const addTagToImage = useStore((s) => s.addTagToImage);
    const removeTagFromImage = useStore((s) => s.removeTagFromImage);
    const addTag = useStore((s) => s.addTag);
    const [newTag, setNewTag] = useState('');
    const [showAddTag, setShowAddTag] = useState(false);
    const [copied, setCopied] = useState(false);
    const [currentScale, setCurrentScale] = useState(1);
    const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
    
    // Track if a pan/drag is currently happening to prevent accidental closing
    const isDraggingRef = React.useRef(false);

    // Get current image from store to ensure we have latest state (including isFavorite)
    const image = useStore((s) => s.images.find(img => img.id === initialImage.id)) || initialImage;
    const actualSize = image.width && image.height
        ? `${image.width}x${image.height}`
        : naturalSize
            ? `${naturalSize.width}x${naturalSize.height}`
            : undefined;

    // Build image URL - either use thumbnail URL, or use backend serve API
    const getImageSrc = () => {
        if (image.thumbnail && !image.thumbnail.startsWith('data:')) {
            return image.thumbnail;
        }
        if (image.localPath) {
            return `/api/serve-image?path=${encodeURIComponent(image.localPath)}`;
        }
        return image.thumbnail || '';
    };

    const copyPrompt = () => {
        navigator.clipboard.writeText(image.prompt);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleAddTag = () => {
        if (newTag.trim()) {
            addTag(newTag.trim());
            addTagToImage(image.id, newTag.trim());
            setNewTag('');
            setShowAddTag(false);
        }
    };

    const handleToggleFavorite = () => {
        toggleFavorite(image.id);
    };

    const openFolder = async () => {
        if (!image.savedFilePath) {
            console.warn('No saved file path available');
            return;
        }
        try {
            await axios.post('/api/open-folder', { path: image.savedFilePath });
        } catch (err) {
            console.error('Failed to open folder:', err);
        }
    };

    const handleBackgroundClick = () => {
        // If we just finished dragging, don't close the modal
        if (isDraggingRef.current) return;
        onClose();
    };

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
                onClick={handleBackgroundClick}
            >
                <motion.div
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    className="relative max-w-6xl max-h-[90vh] w-full mx-4 flex gap-2 justify-center items-stretch"
                    onClick={(e) => {
                        // Prevent click on the modal content from propagating to the background
                        e.stopPropagation();
                    }}
                >
                    {/* Image or Loading State */}
                    <div className="flex items-center justify-center relative">
                        {image.status === 'loading' ? (
                            <div className="w-96 h-96 flex flex-col items-center justify-center bg-[var(--bg-secondary)] rounded-xl gap-4">
                                <Loader2 className="w-12 h-12 animate-spin text-[var(--accent-primary)]" />
                                <span className="text-[var(--text-muted)]">生成中...</span>
                            </div>
                        ) : (
                            <TransformWrapper
                                initialScale={1}
                                minScale={1}
                                maxScale={8}
                                centerOnInit={true}
                                doubleClick={{ mode: 'reset' }}
                                wheel={{ step: 0.3 }}
                                panning={{ velocityDisabled: true }}
                                alignmentAnimation={{ sizeX: 0, sizeY: 0 }}
                                onTransformed={(_ref, state) => { setCurrentScale(state.scale); }}
                                onPanningStart={() => {
                                    isDraggingRef.current = true;
                                }}
                                onPanningStop={() => {
                                    // Delay resetting the flag so the onClick handler can catch it first
                                    setTimeout(() => {
                                        isDraggingRef.current = false;
                                    }, 100);
                                }}
                            >
                                <TransformComponent
                                    wrapperStyle={{ width: '100%', height: '100%', overflow: 'hidden', borderRadius: '0.75rem' }}
                                    contentStyle={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                >
                                    <img
                                        src={getImageSrc()}
                                        alt={image.prompt}
                                        className="max-w-full max-h-[80vh] object-contain rounded-xl shadow-2xl select-none"
                                        draggable={false}
                                        onLoad={(e) => {
                                            const img = e.currentTarget;
                                            setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
                                        }}
                                    />
                                </TransformComponent>
                                {/* Zoom indicators and controls (always visible, outside image but wrapper handles vertical layout) */}
                                <div className="absolute -bottom-14 left-1/2 -translate-x-1/2 flex items-center gap-2 z-10 p-1.5 rounded-full bg-black/60 backdrop-blur-lg border border-white/10 shadow-lg">
                                    <QuickZoomButton currentScale={currentScale} />
                                    <span className="px-3 text-white/90 text-xs font-mono min-w-[3.5rem] text-center">
                                        {Math.round(currentScale * 100)}%
                                    </span>
                                    <div className="w-px h-4 bg-white/20"></div>
                                    <ResetButton />
                                </div>
                            </TransformWrapper>
                        )}
                    </div>

                    {/* Info Panel */}
                    <div className="w-80 bg-[var(--bg-card)] rounded-xl p-4 flex flex-col gap-4 overflow-y-auto relative group/panel">
                        {/* Close button - shows on hover */}
                        <button
                            onClick={onClose}
                            className="absolute top-2 right-2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-all opacity-0 group-hover/panel:opacity-100"
                        >
                            <X className="w-5 h-5" />
                        </button>

                        {/* Actions */}
                        <div className="flex gap-2">
                            <button
                                onClick={handleToggleFavorite}
                                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg transition-colors ${image.isFavorite
                                    ? 'bg-yellow-500 text-white'
                                    : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]'
                                    }`}
                            >
                                <Star className={`w-4 h-4 ${image.isFavorite ? 'fill-current' : ''}`} />
                                <span className="text-sm">{image.isFavorite ? '已收藏' : '收藏'}</span>
                            </button>
                            <button
                                onClick={openFolder}
                                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] transition-colors"
                            >
                                <Folder className="w-4 h-4" />
                                <span className="text-sm">打开目录</span>
                            </button>
                        </div>

                        {/* Prompt */}
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="text-sm font-medium text-[var(--text-secondary)]">Prompt</h3>
                                <button
                                    onClick={copyPrompt}
                                    className="flex items-center gap-1 text-xs text-[var(--accent-primary)] hover:underline"
                                >
                                    <Copy className="w-3 h-3" />
                                    {copied ? '已复制' : '复制'}
                                </button>
                            </div>
                            <p className="text-sm text-[var(--text-primary)] bg-[var(--bg-secondary)] rounded-lg p-3 max-h-40 overflow-y-auto">
                                {image.prompt}
                            </p>
                        </div>

                        {/* Tags */}
                        <div>
                            <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-2">标签</h3>
                            <div className="flex flex-wrap gap-2">
                                {image.tags.map((tag) => (
                                    <span
                                        key={tag}
                                        className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-[var(--accent-primary)]/20 text-[var(--accent-primary)]"
                                    >
                                        {tag}
                                        <button
                                            onClick={() => removeTagFromImage(image.id, tag)}
                                            className="hover:text-red-400"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    </span>
                                ))}
                                {showAddTag ? (
                                    <div className="flex items-center gap-1">
                                        <input
                                            type="text"
                                            value={newTag}
                                            onChange={(e) => setNewTag(e.target.value)}
                                            onKeyPress={(e) => e.key === 'Enter' && handleAddTag()}
                                            placeholder="标签名"
                                            className="w-20 px-2 py-1 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border-subtle)] focus:outline-none focus:border-[var(--accent-primary)]"
                                            autoFocus
                                        />
                                        <button
                                            onClick={handleAddTag}
                                            className="p-1 rounded bg-[var(--accent-primary)] text-white"
                                        >
                                            <Plus className="w-3 h-3" />
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => setShowAddTag(true)}
                                        className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]"
                                    >
                                        <Plus className="w-3 h-3" />
                                        添加
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Info */}
                        <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                                <span className="text-[var(--text-muted)]">API</span>
                                <span className={`px-2 py-0.5 rounded text-xs ${image.apiType === 'other'
                                    ? 'bg-yellow-500/20 text-yellow-400'
                                    : image.apiType === 'openai'
                                        ? 'bg-green-500/20 text-green-400'
                                        : image.apiType === 'nanobanana2'
                                            ? 'bg-purple-500/20 text-purple-400'
                                            : image.apiType === 'cliproxy'
                                                ? 'bg-red-500/20 text-red-400'
                                                : image.apiType === 'sousaku'
                                                    ? 'bg-cyan-500/20 text-cyan-400'
                                                    : 'bg-blue-500/20 text-blue-400'
                                    }`}>
                                    {image.apiType === 'other' ? 'Other' : image.apiType === 'openai' ? 'ChatGPT2API' : image.apiType === 'nanobanana2' ? 'Nanobanana2' : image.apiType === 'cliproxy' ? 'CLIProxy' : image.apiType === 'sousaku' ? 'Sousaku' : 'APIMart'}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-[var(--text-muted)]">生成时间</span>
                                <span className="text-[var(--text-primary)]">
                                    {format(new Date(image.createdAt), 'yyyy/M/d HH:mm', { locale: zhCN })}
                                </span>
                            </div>
                            {image.params.quality && image.apiType !== 'openai' && (
                                <div className="flex justify-between">
                                    <span className="text-[var(--text-muted)]">画质</span>
                                    <span className="text-[var(--text-primary)]">{
                                        image.apiType === 'nanobanana2'
                                            ? ({ standard: '1K', medium: '2K', hd: '4K' }[image.params.quality] || image.params.quality)
                                            : (image.params.quality.charAt(0).toUpperCase() + image.params.quality.slice(1))
                                    }</span>
                                </div>
                            )}
                            {(image.params.ratio && (image.apiType === 'openai' || image.apiType === 'nanobanana2' || image.apiType === 'apimart' || image.apiType === 'cliproxy' || image.apiType === 'sousaku')) && (
                                <div className="flex justify-between">
                                    <span className="text-[var(--text-muted)]">比例</span>
                                    <span className="text-[var(--text-primary)]">{image.params.ratio}</span>
                                </div>
                            )}
                            {actualSize && (
                                <div className="flex justify-between">
                                    <span className="text-[var(--text-muted)]">实际尺寸</span>
                                    <span className="text-[var(--text-primary)]">{actualSize}</span>
                                </div>
                            )}
                            {image.apiType === 'nanobanana2' && (
                                <div className="flex justify-between">
                                    <span className="text-[var(--text-muted)]">思考</span>
                                    <span className={`px-2 py-0.5 rounded text-xs ${(image.params.thinkingLevel || 'Minimal') === 'High'
                                            ? 'bg-amber-500/20 text-amber-400'
                                            : 'bg-gray-500/20 text-gray-400'
                                        }`}>
                                        {image.params.thinkingLevel || 'Minimal'}
                                    </span>
                                </div>
                            )}
                            {image.apiType === 'apimart' && image.params.apimartModel && (
                                <div className="flex justify-between">
                                    <span className="text-[var(--text-muted)]">模型</span>
                                    <span className="text-[var(--text-primary)]">{image.params.apimartModel}</span>
                                </div>
                            )}
                            {image.apiType === 'apimart' && image.params.resolution && (
                                <div className="flex justify-between">
                                    <span className="text-[var(--text-muted)]">分辨率</span>
                                    <span className="text-[var(--text-primary)]">{image.params.resolution}</span>
                                </div>
                            )}
                            {image.apiType === 'cliproxy' && image.params.cliproxyModel && (
                                <div className="flex justify-between">
                                    <span className="text-[var(--text-muted)]">模型</span>
                                    <span className="text-[var(--text-primary)]">{image.params.cliproxyModel}</span>
                                </div>
                            )}
                            {image.apiType === 'cliproxy' && image.params.resolution && (
                                <div className="flex justify-between">
                                    <span className="text-[var(--text-muted)]">分辨率</span>
                                    <span className="text-[var(--text-primary)]">{image.params.resolution}</span>
                                </div>
                            )}
                            {image.apiType === 'sousaku' && image.params.sousakuModel && (
                                <div className="flex justify-between">
                                    <span className="text-[var(--text-muted)]">模型</span>
                                    <span className="text-[var(--text-primary)]">{formatSousakuModel(image.params.sousakuModel)}</span>
                                </div>
                            )}
                            {image.apiType === 'sousaku' && image.params.resolution && (
                                <div className="flex justify-between">
                                    <span className="text-[var(--text-muted)]">分辨率</span>
                                    <span className="text-[var(--text-primary)]">{String(image.params.resolution).toUpperCase()}</span>
                                </div>
                            )}
                            {image.apiType === 'sousaku' && image.params.sousakuAutoOptimize !== undefined && (
                                <div className="flex justify-between">
                                    <span className="text-[var(--text-muted)]">自动优化</span>
                                    <span className={`px-2 py-0.5 rounded text-xs ${image.params.sousakuAutoOptimize ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-500/20 text-gray-400'}`}>
                                        {image.params.sousakuAutoOptimize ? '开启' : '关闭'}
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* File path */}
                        {image.savedFilePath && (
                            <div className="mt-auto pt-2 border-t border-[var(--border-subtle)]">
                                <p className="text-xs text-[var(--text-muted)] break-all">
                                    {image.savedFilePath}
                                </p>
                            </div>
                        )}
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}
