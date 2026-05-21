import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { BackendCapabilities, ImageItem, FilterState, UploadedImage, GenerateParams, ThoughtImage } from '../types';
import { getBackendCapabilities, loadGallery, saveToGallery, deleteFromGallery, updateGalleryTags } from '../services/api';

export type GalleryColumnSize = 5 | 6 | 7;
export type ApiType = 'apimart' | 'openai' | 'nanobanana2' | 'cliproxy' | 'sousaku';

function deriveTags(images: ImageItem[]): string[] {
    const tags = new Set<string>();
    images.forEach((image) => {
        image.tags.forEach((tag) => {
            const cleaned = tag.trim();
            if (cleaned) tags.add(cleaned);
        });
    });
    return Array.from(tags).sort();
}

const DEFAULT_PER_API_PARAMS: Record<ApiType, GenerateParams> = {
    openai: {
        ratio: '16:9',
        imageCount: 1,
    },
    cliproxy: {
        cliproxyModel: 'gpt-image-2',
        ratio: '16:9',
        resolution: '2K',
        quality: 'high',
        imageCount: 1,
    },
    nanobanana2: {
        ratio: '16:9',
        quality: 'hd',
        imageCount: 1,
        thinkingLevel: 'High',
    },
    apimart: {
        apimartModel: 'gemini-3-pro-image-preview',
        ratio: '16:9',
        resolution: '4K',
        quality: 'high',
        moderation: 'low',
    },
    sousaku: {
        sousakuModel: 'gpt-image-2',
        ratio: '1:1',
        resolution: '4k',
        sousakuAutoOptimize: true,
        imageCount: 1,
    },
};

interface AppState {
    // Images (loaded from backend JSON)
    images: ImageItem[];
    galleryLoaded: boolean;
    backendCapabilities: BackendCapabilities;
    loadBackendCapabilities: () => Promise<void>;
    loadGalleryFromServer: () => Promise<void>;
    addImage: (image: ImageItem) => void;
    addImportedImages: (images: ImageItem[]) => void;
    updateImage: (id: string, updates: Partial<ImageItem>) => void;
    removeImage: (id: string) => void;
    toggleFavorite: (id: string) => void;
    addTagToImage: (id: string, tag: string) => void;
    removeTagFromImage: (id: string, tag: string) => void;

    // All available tags
    allTags: string[];
    addTag: (tag: string) => void;
    removeTag: (tag: string) => void;

    // Filters
    filters: FilterState;
    setSearchQuery: (query: string) => void;
    setSelectedDate: (date: Date | null) => void;
    setSelectedTags: (tags: string[]) => void;
    toggleFavoritesOnly: () => void;

    // Generation state
    selectedApi: ApiType;
    setSelectedApi: (api: ApiType) => void;
    perApiParams: Record<string, GenerateParams>;
    setGenerateParams: (params: Partial<GenerateParams>) => void;

    // Upload state
    uploadedImages: UploadedImage[];
    addUploadedImage: (image: UploadedImage) => void;
    removeUploadedImage: (id: string) => void;
    clearUploadedImages: () => void;

    // Mask state (in-memory only, NOT persisted)
    maskData: Record<string, string>;      // imageId -> mask PNG dataURL
    maskFeather: Record<string, number>;   // imageId -> feather radius
    setMaskData: (imageId: string, dataUrl: string, feather?: number) => void;
    removeMaskData: (imageId: string) => void;
    clearMaskData: () => void;

    // UI state
    isGenerating: boolean;
    setIsGenerating: (value: boolean) => void;
    currentPrompt: string;
    setCurrentPrompt: (prompt: string) => void;

    // Gallery modal state
    selectedImage: ImageItem | null;
    setSelectedImage: (image: ImageItem | null) => void;

    // Gallery settings
    galleryColumns: GalleryColumnSize;
    setGalleryColumns: (cols: GalleryColumnSize) => void;
    deleteLocalFile: boolean;
    setDeleteLocalFile: (value: boolean) => void;
    deleteImportedOriginal: boolean;
    setDeleteImportedOriginal: (value: boolean) => void;

    // Thought images (draft images from Nanobanana2 thinking)
    thoughtImages: ThoughtImage[];
    addThoughtImages: (images: ThoughtImage[]) => void;
    removeThoughtImage: (id: string) => void;
    clearThoughtImages: () => void;
}

export const useStore = create<AppState>()(
    persist(
        (set, get) => ({
            // Images - loaded from backend JSON, NOT persisted to localStorage
            images: [],
            galleryLoaded: false,
            backendCapabilities: {
                backendVersion: 'v1',
                features: {
                    galleryImport: false,
                },
            },

            loadBackendCapabilities: async () => {
                const capabilities = await getBackendCapabilities();
                set({ backendCapabilities: capabilities });
            },

            loadGalleryFromServer: async () => {
                if (get().galleryLoaded) return;
                try {
                    const data = await loadGallery();
                    // Sort by createdAt descending so newest images appear first
                    const sorted = [...data.images].sort((a, b) =>
                        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                    );
                    set({ images: sorted, allTags: deriveTags(sorted), galleryLoaded: true });
                    console.log(`📦 Loaded ${data.images.length} images from server`);
                } catch (e) {
                    console.warn('Failed to load gallery from server:', e);
                    set({ galleryLoaded: true });
                }
            },

            addImage: (image) => {
                set((state) => {
                    const images = [image, ...state.images];
                    return { images, allTags: deriveTags(images) };
                });
                // Only save to backend if not a loading placeholder
                if (image.status === 'success') {
                    saveToGallery(image).catch(e => console.error('Failed to save image:', e));
                }
            },

            addImportedImages: (images) => {
                set((state) => {
                    const existingIds = new Set(state.images.map((img) => img.id));
                    const nextImages = images.filter((img) => !existingIds.has(img.id));
                    const mergedImages = [...nextImages, ...state.images];
                    return {
                        images: mergedImages,
                        allTags: deriveTags(mergedImages),
                    };
                });
            },

            updateImage: (id, updates) => {
                console.log(`📝 updateImage called for ${id}`, updates);
                set((state) => {
                    const images = state.images.map((img) =>
                        img.id === id ? { ...img, ...updates } : img
                    );
                    return { images, allTags: deriveTags(images) };
                });
                // Save to backend if updated to success status
                const updated = get().images.find(img => img.id === id);
                if (updated && updated.status === 'success') {
                    console.log(`💾 Saving to gallery: ${id}`);
                    saveToGallery(updated).catch(e => console.error('Failed to update image:', e));
                }
            },

            removeImage: (id) => {
                // Check if image was saved to backend before deleting
                const image = get().images.find(img => img.id === id);
                const wasSaved = image && image.status === 'success';
                const shouldDeleteLocal = get().deleteLocalFile;

                console.log(`🗑️ removeImage called for ${id}, wasSaved=${wasSaved}, deleteLocal=${shouldDeleteLocal}`);
                set((state) => {
                    const images = state.images.filter((img) => img.id !== id);
                    const allTags = deriveTags(images);
                    return {
                        images,
                        allTags,
                        filters: {
                            ...state.filters,
                            selectedTags: state.filters.selectedTags.filter((tag) =>
                                allTags.includes(tag)
                            ),
                        },
                    };
                });

                // Only delete from backend if it was successfully saved
                if (wasSaved) {
                    deleteFromGallery(id, shouldDeleteLocal).catch(e => console.error('Failed to delete image:', e));
                }
            },

            toggleFavorite: (id) => {
                const state = get();
                const updatedImages = state.images.map((img) =>
                    img.id === id ? { ...img, isFavorite: !img.isFavorite } : img
                );
                set({ images: updatedImages });
                // Save updated image to backend
                const updated = updatedImages.find(img => img.id === id);
                if (updated) saveToGallery(updated).catch(e => console.error('Failed to update image:', e));
            },

            addTagToImage: (id, tag) => {
                const state = get();
                const updatedImages = state.images.map((img) =>
                    img.id === id && !img.tags.includes(tag)
                        ? { ...img, tags: [...img.tags, tag] }
                        : img
                );
                set({ images: updatedImages, allTags: deriveTags(updatedImages) });
                const updated = updatedImages.find(img => img.id === id);
                if (updated) saveToGallery(updated).catch(e => console.error('Failed to update image:', e));
            },

            removeTagFromImage: (id, tag) => {
                const state = get();
                const updatedImages = state.images.map((img) =>
                    img.id === id ? { ...img, tags: img.tags.filter((t) => t !== tag) } : img
                );
                const allTags = deriveTags(updatedImages);
                set((state) => ({
                    images: updatedImages,
                    allTags,
                    filters: {
                        ...state.filters,
                        selectedTags: state.filters.selectedTags.filter((selected) => allTags.includes(selected)),
                    },
                }));
                const updated = updatedImages.find(img => img.id === id);
                if (updated) saveToGallery(updated).catch(e => console.error('Failed to update image:', e));

                // Auto-remove from global tags if no image uses this tag anymore
                const stillInUse = updatedImages.some(img => img.tags.includes(tag));
                if (!stillInUse) {
                    get().removeTag(tag);
                }
            },

            // Tags
            allTags: [],
            addTag: (tag) => {
                set((state) => ({
                    allTags: state.allTags.includes(tag) ? state.allTags : [...state.allTags, tag]
                }));
                updateGalleryTags(get().allTags).catch(e => console.error('Failed to update tags:', e));
            },
            removeTag: (tag) => {
                set((state) => ({ allTags: state.allTags.filter((t) => t !== tag) }));
                updateGalleryTags(get().allTags).catch(e => console.error('Failed to update tags:', e));
            },

            // Filters (NOT persisted)
            filters: {
                searchQuery: '',
                selectedDate: null,
                selectedTags: [],
                showFavoritesOnly: false,
            },
            setSearchQuery: (query) => set((state) => ({
                filters: { ...state.filters, searchQuery: query }
            })),
            setSelectedDate: (date) => set((state) => ({
                filters: { ...state.filters, selectedDate: date }
            })),
            setSelectedTags: (tags) => set((state) => ({
                filters: { ...state.filters, selectedTags: tags }
            })),
            toggleFavoritesOnly: () => set((state) => ({
                filters: { ...state.filters, showFavoritesOnly: !state.filters.showFavoritesOnly }
            })),

            // Generation - each API has its own default params
            selectedApi: 'openai',
            setSelectedApi: (api) => set((state) => ({
                selectedApi: api,
                perApiParams: {
                    ...DEFAULT_PER_API_PARAMS,
                    ...state.perApiParams,
                    [api]: {
                        ...DEFAULT_PER_API_PARAMS[api],
                        ...(state.perApiParams?.[api] || {}),
                    },
                },
            })),
            perApiParams: DEFAULT_PER_API_PARAMS,
            // generateParams is computed via selector: useGenerateParams()
            setGenerateParams: (params) => set((state) => ({
                perApiParams: {
                    ...DEFAULT_PER_API_PARAMS,
                    ...state.perApiParams,
                    [state.selectedApi]: {
                        ...DEFAULT_PER_API_PARAMS[state.selectedApi],
                        ...(state.perApiParams?.[state.selectedApi] || {}),
                        ...params,
                    },
                },
            })),

            // Uploads (NOT persisted)
            uploadedImages: [],
            addUploadedImage: (image) => set((state) => ({
                uploadedImages: [...state.uploadedImages, image]
            })),
            removeUploadedImage: (id) => set((state) => {
                // Also clean up mask data when removing an uploaded image
                const { [id]: _m, ...restMask } = state.maskData;
                const { [id]: _f, ...restFeather } = state.maskFeather;
                return {
                    uploadedImages: state.uploadedImages.filter((img) => img.id !== id),
                    maskData: restMask,
                    maskFeather: restFeather,
                };
            }),
            clearUploadedImages: () => set({ uploadedImages: [], maskData: {}, maskFeather: {} }),

            // Mask data (NOT persisted — lives only in memory)
            maskData: {},
            maskFeather: {},
            setMaskData: (imageId, dataUrl, feather) => set((state) => ({
                maskData: { ...state.maskData, [imageId]: dataUrl },
                maskFeather: { ...state.maskFeather, [imageId]: feather ?? 0 },
            })),
            removeMaskData: (imageId) => set((state) => {
                const { [imageId]: _m, ...restMask } = state.maskData;
                const { [imageId]: _f, ...restFeather } = state.maskFeather;
                return { maskData: restMask, maskFeather: restFeather };
            }),
            clearMaskData: () => set({ maskData: {}, maskFeather: {} }),

            // UI
            isGenerating: false,
            setIsGenerating: (value) => set({ isGenerating: value }),
            currentPrompt: '',
            setCurrentPrompt: (prompt) => set({ currentPrompt: prompt }),

            // Gallery modal
            selectedImage: null,
            setSelectedImage: (image) => set({ selectedImage: image }),

            // Gallery settings
            galleryColumns: 5,
            setGalleryColumns: (cols) => set({ galleryColumns: cols }),
            deleteLocalFile: false,
            setDeleteLocalFile: (value) => set({ deleteLocalFile: value }),
            deleteImportedOriginal: false,
            setDeleteImportedOriginal: (value) => set({ deleteImportedOriginal: value }),

            // Thought images (NOT persisted)
            thoughtImages: [],
            addThoughtImages: (images) => set((state) => ({
                thoughtImages: [...state.thoughtImages, ...images]
            })),
            removeThoughtImage: (id) => set((state) => ({
                thoughtImages: state.thoughtImages.filter((img) => img.id !== id)
            })),
            clearThoughtImages: () => set({ thoughtImages: [] }),
        }),
        {
            name: 'apimart-v2-storage',
            // Only persist settings, NOT images (they're in backend JSON now)
            partialize: (state) => ({
                selectedApi: state.selectedApi,
                perApiParams: state.perApiParams,
                galleryColumns: state.galleryColumns,
                deleteLocalFile: state.deleteLocalFile,
                deleteImportedOriginal: state.deleteImportedOriginal,
            }),
        }
    )
);

// Selector hook: returns generateParams for the currently selected API
export const useGenerateParams = () =>
    useStore((s) => s.perApiParams?.[s.selectedApi] || DEFAULT_PER_API_PARAMS[s.selectedApi]);
