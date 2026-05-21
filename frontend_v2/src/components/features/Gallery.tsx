import Masonry from 'react-masonry-css';
import { useStore } from '../../store';
import { useMemo, useCallback, useState, useRef, useEffect, memo } from 'react';
import { motion } from 'framer-motion';
import { Star, Trash2, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { ImageModal } from './ImageModal';
import type { ImageItem } from '../../types';

const INITIAL_LOAD = 60;
const LOAD_MORE = 30;

function normalizeSearchText(value: unknown) {
    return String(value || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/\\r\\n|\\n|\\r/g, ' ')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function localPathFromServeUrl(value?: string) {
    if (!value || !value.startsWith('/api/serve-image')) return '';
    try {
        const url = new URL(value, window.location.origin);
        return url.searchParams.get('path') || '';
    } catch {
        return '';
    }
}

function galleryThumbnailSrc(image: ImageItem) {
    const localFilePath =
        image.savedFilePath ||
        localPathFromServeUrl(image.localPath) ||
        localPathFromServeUrl(image.thumbnail);

    if (localFilePath) {
        return `/api/thumbnail?path=${encodeURIComponent(localFilePath)}&w=512`;
    }

    return image.thumbnail || image.localPath || '';
}

function galleryOriginalSrc(image: ImageItem) {
    const localFilePath =
        image.savedFilePath ||
        localPathFromServeUrl(image.localPath) ||
        localPathFromServeUrl(image.thumbnail);

    if (localFilePath) {
        return `/api/serve-image?path=${encodeURIComponent(localFilePath)}`;
    }

    return image.thumbnail || image.localPath || '';
}

// ─── Memoized Gallery Card ─────────────────────────────────────

interface GalleryCardProps {
    image: ImageItem;
    onSelect: (image: ImageItem) => void;
}

const GalleryCard = memo(function GalleryCard({ image, onSelect }: GalleryCardProps) {
    const toggleFavorite = useStore((s) => s.toggleFavorite);
    const removeImage = useStore((s) => s.removeImage);
    const deleteLocalFile = useStore((s) => s.deleteLocalFile);

    return (
        <motion.div
            initial={{ opacity: 0, y: -15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
                duration: 0.35,
                ease: 'easeOut',
            }}
            className="mb-3 group cursor-pointer"
            onClick={() => onSelect(image)}
        >
            <div className="relative rounded-xl overflow-hidden bg-[var(--bg-card)] border border-[var(--border-subtle)] hover:border-[var(--accent-primary)] transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
                {/* Image or Loading Placeholder */}
                <div className="aspect-auto min-h-[120px]">
                    {image.status === 'loading' ? (
                        <div className="w-full h-48 flex flex-col items-center justify-center bg-[var(--bg-secondary)] gap-3">
                            <Loader2 className="w-8 h-8 animate-spin text-[var(--accent-primary)]" />
                            <span className="text-xs text-[var(--text-muted)]">生成中...</span>
                        </div>
                    ) : (
                        <img
                            src={galleryThumbnailSrc(image)}
                            alt={image.prompt}
                            className="w-full h-auto object-cover"
                            loading="lazy"
                            decoding="async"
                            onError={(event) => {
                                const target = event.currentTarget;
                                if (target.dataset.fallback === '1') return;
                                target.dataset.fallback = '1';
                                target.src = galleryOriginalSrc(image);
                            }}
                        />
                    )}
                </div>

                {/* Overlay on hover */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <div className="absolute bottom-0 left-0 right-0 p-4">
                        <p className="text-white text-sm line-clamp-2 mb-2">
                            {image.prompt}
                        </p>
                        <div className="flex items-center justify-between">
                            <span className="text-white/60 text-xs">
                                {format(new Date(image.createdAt), 'M月d日 HH:mm', { locale: zhCN })}
                            </span>
                            <span className={`text-xs px-2 py-0.5 rounded ${image.apiType === 'other'
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
                    </div>
                </div>

                {/* Quick actions */}
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite(image.id);
                        }}
                        className={`p-1.5 rounded-lg backdrop-blur-sm transition-colors ${image.isFavorite
                            ? 'bg-yellow-500 text-white'
                            : 'bg-black/50 text-white hover:bg-yellow-500'
                            }`}
                        title="收藏"
                    >
                        <Star className={`w-4 h-4 ${image.isFavorite ? 'fill-current' : ''}`} />
                    </button>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            removeImage(image.id);
                        }}
                        className="p-1.5 rounded-lg backdrop-blur-sm bg-black/50 text-white hover:bg-red-500 transition-colors"
                        title={deleteLocalFile ? '删除（同时删除本地文件）' : '从画廊移除（不删除本地文件）'}
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>

                {/* Tags */}
                {image.tags.length > 0 && (
                    <div className="absolute top-2 left-2 flex flex-wrap gap-1 max-w-[70%]">
                        {image.tags.slice(0, 2).map((tag) => (
                            <span
                                key={tag}
                                className="px-2 py-0.5 rounded-full text-xs bg-[var(--accent-primary)]/80 text-white backdrop-blur-sm"
                            >
                                {tag}
                            </span>
                        ))}
                        {image.tags.length > 2 && (
                            <span className="px-2 py-0.5 rounded-full text-xs bg-black/50 text-white backdrop-blur-sm">
                                +{image.tags.length - 2}
                            </span>
                        )}
                    </div>
                )}
            </div>
        </motion.div>
    );
});

// ─── Gallery Component ──────────────────────────────────────────
export function Gallery() {
    const images = useStore((s) => s.images);
    const filters = useStore((s) => s.filters);
    const selectedImage = useStore((s) => s.selectedImage);
    const setSelectedImage = useStore((s) => s.setSelectedImage);
    const galleryColumns = useStore((s) => s.galleryColumns);

    // Compute masonry breakpoints from gallery column setting
    const masonryBreakpoints = useMemo(() => ({
        default: galleryColumns,
        1536: galleryColumns,
        1280: galleryColumns,
        1024: Math.min(galleryColumns, 3),
        768: 2,
        640: 1,
    }), [galleryColumns]);

    // Infinite scroll state
    const [visibleCount, setVisibleCount] = useState(INITIAL_LOAD);
    const sentinelRef = useRef<HTMLDivElement>(null);

    // Filter images based on current filters
    const filteredImages = useMemo(() => {
        const query = normalizeSearchText(filters.searchQuery);
        return images.filter((img) => {
            if (query) {
                const prompt = normalizeSearchText(img.prompt);
                if (!prompt.includes(query)) {
                    return false;
                }
            }
            if (filters.selectedDate) {
                const imgDate = format(new Date(img.createdAt), 'yyyy-MM-dd');
                const filterDate = format(filters.selectedDate, 'yyyy-MM-dd');
                if (imgDate !== filterDate) {
                    return false;
                }
            }
            if (filters.selectedTags.length > 0) {
                if (!filters.selectedTags.some((tag) => img.tags.includes(tag))) {
                    return false;
                }
            }
            if (filters.showFavoritesOnly && !img.isFavorite) {
                return false;
            }
            return true;
        });
    }, [images, filters]);

    // Slice for infinite scroll
    const visibleImages = useMemo(
        () => filteredImages.slice(0, visibleCount),
        [filteredImages, visibleCount]
    );

    const hasMore = visibleCount < filteredImages.length;

    // Reset visible count when filters change
    useEffect(() => {
        setVisibleCount(INITIAL_LOAD);
    }, [filters]);

    // IntersectionObserver for infinite scroll
    useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!sentinel || !hasMore) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    setVisibleCount((prev) => prev + LOAD_MORE);
                }
            },
            { rootMargin: '400px' }
        );

        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [hasMore]);

    // Stable onSelect callback
    const handleSelect = useCallback(
        (image: ImageItem) => setSelectedImage(image),
        [setSelectedImage]
    );

    if (filteredImages.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                    <div className="text-6xl mb-4">🖼️</div>
                    <h3 className="text-xl font-semibold text-[var(--text-primary)] mb-2">
                        {images.length === 0 ? '还没有图片' : '没有匹配的图片'}
                    </h3>
                    <p className="text-[var(--text-secondary)]">
                        {images.length === 0
                            ? '开始生成你的第一张图片吧'
                            : '尝试调整筛选条件'}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <>
            <div className="flex-1 px-4 py-6 overflow-x-hidden">
                <Masonry
                    breakpointCols={masonryBreakpoints}
                    className="flex -ml-3"
                    columnClassName="pl-3"
                >
                    {visibleImages.map((image) => (
                        <GalleryCard
                            key={image.id}
                            image={image}
                            onSelect={handleSelect}
                        />
                    ))}
                </Masonry>

                {/* Infinite scroll sentinel */}
                {hasMore && (
                    <div
                        ref={sentinelRef}
                        className="flex justify-center py-8"
                    >
                        <Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" />
                    </div>
                )}

                {/* End of gallery indicator */}
                {!hasMore && filteredImages.length > INITIAL_LOAD && (
                    <div className="text-center py-6 text-[var(--text-muted)] text-sm">
                        已显示全部 {filteredImages.length} 张图片
                    </div>
                )}
            </div>

            {/* Image Modal */}
            {selectedImage && (
                <ImageModal
                    image={selectedImage}
                    onClose={() => setSelectedImage(null)}
                />
            )}
        </>
    );
}
