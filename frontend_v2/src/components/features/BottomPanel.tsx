import { useState, useRef, useMemo } from 'react';
import { Send, Image as ImageIcon, Settings, Loader2, X, Plus, Check, Paintbrush } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore, useGenerateParams } from '../../store';
import {
    fileToBase64,
    uploadImage,
} from '../../services/api';
import { startGeneration } from '../../services/generationService';
import type { ImageItem, UploadedImage } from '../../types';
import { isMaskSupported } from '../../types';
import { MaskEditor } from './MaskEditor';

function normalizeSousakuModel(model: string) {
    const aliases: Record<string, string> = {
        low: 'gpt-image-2-low',
        medium: 'gpt-image-2',
        high: 'gpt-image-2-high',
        'gpt-image-2-4k': 'gpt-image-2',
        'gpt-image-2-medium': 'gpt-image-2',
        'gpt-image-2-high-4k': 'gpt-image-2-high',
    };
    return aliases[model] || model;
}

export function BottomPanel() {
    const selectedApi = useStore((s) => s.selectedApi);
    const setSelectedApi = useStore((s) => s.setSelectedApi);
    const generateParams = useGenerateParams();
    const setGenerateParams = useStore((s) => s.setGenerateParams);
    const uploadedImages = useStore((s) => s.uploadedImages);
    const addUploadedImage = useStore((s) => s.addUploadedImage);
    const removeUploadedImage = useStore((s) => s.removeUploadedImage);
    const currentPrompt = useStore((s) => s.currentPrompt);
    const setCurrentPrompt = useStore((s) => s.setCurrentPrompt);
    const addImage = useStore((s) => s.addImage);
    const updateImage = useStore((s) => s.updateImage);
    const removeImage = useStore((s) => s.removeImage);
    const addThoughtImages = useStore((s) => s.addThoughtImages);
    const maskData = useStore((s) => s.maskData);
    const maskFeather = useStore((s) => s.maskFeather);
    const setMaskData = useStore((s) => s.setMaskData);
    const removeMaskData = useStore((s) => s.removeMaskData);

    const [showSettings, setShowSettings] = useState(false);
    const [maskEditingImageId, setMaskEditingImageId] = useState<string | null>(null);
    const [showImagePicker, setShowImagePicker] = useState(false);
    const [selectedRefs, setSelectedRefs] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [uploadingCount, setUploadingCount] = useState(0);
    const [isPromptFocused, setIsPromptFocused] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Upload file to image hosting and get URL
    const handleFileUpload = async (files: FileList | null) => {
        if (!files) return;

        const fileArray = Array.from(files).filter(f => f.type.startsWith('image/'));
        if (fileArray.length === 0) return;

        setUploadingCount(fileArray.length);

        for (const file of fileArray) {
            const id = crypto.randomUUID();
            const preview = URL.createObjectURL(file);

            // Add placeholder immediately for UI feedback
            addUploadedImage({
                id,
                file,
                preview,
                base64: undefined, // Will be replaced with URL
            });

            try {
                // Upload to image hosting (auto-compresses if >10MB)
                const result = await uploadImage(file);

                if (result.success && result.url) {
                    // Update with actual URL (store URL in base64 field for simplicity)
                    // The image is now on the server with a URL
                    const updatedImage: UploadedImage = {
                        id,
                        file,
                        preview,
                        base64: result.url, // Store URL here
                    };

                    // Remove old and add updated
                    removeUploadedImage(id);
                    addUploadedImage(updatedImage);
                    setSelectedRefs(prev => [...prev, id]);
                } else {
                    throw new Error(result.message || '上传失败');
                }
            } catch (err) {
                console.error('Upload to hosting failed, falling back to base64:', err);

                // Fallback: use base64 directly
                try {
                    const base64 = await fileToBase64(file);
                    const updatedImage: UploadedImage = {
                        id,
                        file,
                        preview,
                        base64,
                    };

                    removeUploadedImage(id);
                    addUploadedImage(updatedImage);
                    setSelectedRefs(prev => [...prev, id]);

                    // Warn user about fallback
                    if (file.size > 10 * 1024 * 1024) {
                        setError(`⚠️ 图床不可用，使用本地模式。大图(${(file.size / 1024 / 1024).toFixed(1)}MB)可能影响生成。`);
                    }
                } catch (base64Err) {
                    removeUploadedImage(id);
                    setError(`图片处理失败`);
                }
            }
        }

        setUploadingCount(0);
    };

    // Handle URL drop - directly use URL without downloading (avoids CORS issues)
    const handleUrlUpload = async (url: string) => {
        try {
            setUploadingCount(1);
            const id = crypto.randomUUID();

            // Directly add the URL image without uploading
            addUploadedImage({
                id,
                file: new File([], 'remote-image', { type: 'image/png' }), // Dummy file
                preview: url, // Use URL as preview
                base64: url,  // Store URL directly as the source (treat as base64/url field)
            });

            // Auto-select it
            setSelectedRefs(prev => [...prev, id]);

            setUploadingCount(0);
        } catch (err) {
            setError(`URL 处理失败: ${err instanceof Error ? err.message : '未知错误'}`);
            setUploadingCount(0);
        }
    };

    // Drag and drop event handlers
    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        // Priority 1: Handle file drops
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            await handleFileUpload(e.dataTransfer.files);
            return;
        }

        // Priority 2: Handle URL drops
        const url = e.dataTransfer.getData('text/plain');
        if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
            // Check if it's likely an image URL
            const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
            const isImageUrl = imageExtensions.some(ext => url.toLowerCase().includes(ext));

            if (isImageUrl || url.includes('image')) {
                await handleUrlUpload(url);
            } else {
                setError('请拖拽图片 URL（需包含图片格式后缀）');
            }
        }
    };

    const toggleRefSelection = (id: string) => {
        setSelectedRefs(prev =>
            prev.includes(id)
                ? prev.filter(i => i !== id)
                : [...prev, id]
        );
    };

    const handleGenerate = async () => {
        if (!currentPrompt.trim()) return;

        setError(null);

        // Get selected reference images - use their URLs, preserving SELECTION order
        const selectedImages = selectedRefs
            .map(id => uploadedImages.find(img => img.id === id))
            .filter((img): img is UploadedImage => !!img && !!img.base64);
        const imageUrls = selectedImages.map((img) => ({
            url: img.base64!,
        }));

        const prompt = currentPrompt;
        const params = { ...generateParams };
        const selectedSousakuModel = normalizeSousakuModel(generateParams.sousakuModel || 'gpt-image-2');
        const selectedSousakuHasFixedCount = ['mj-image-v7', 'mj-image-niji-7'].includes(selectedSousakuModel);
        const imageCount = selectedApi === 'sousaku' && selectedSousakuHasFixedCount
            ? 4
            : (selectedApi === 'openai' || selectedApi === 'nanobanana2' || selectedApi === 'cliproxy' || selectedApi === 'sousaku') ? (generateParams.imageCount || 1) : 1;
        if (selectedApi === 'sousaku' && selectedSousakuHasFixedCount) {
            params.imageCount = 4;
        }
        if (selectedApi === 'openai') {
            params.ratio = generateParams.ratio || '16:9';
            delete params.size;
            delete params.quality;
        }
        const apiType = selectedApi;

        // 1. Create placeholder images immediately
        const placeholderIds: string[] = [];
        for (let i = 0; i < imageCount; i++) {
            const placeholderId = crypto.randomUUID();
            placeholderIds.push(placeholderId);

            const placeholder: ImageItem = {
                id: placeholderId,
                status: 'loading',
                localPath: '',
                thumbnail: '',
                prompt,
                apiType,
                params,
                createdAt: new Date().toISOString(),
                isFavorite: false,
                tags: [],
            };
            addImage(placeholder);
        }

        // Collect mask data for selected images
        const firstMaskedId = selectedRefs.find(id => maskData[id]);
        const activeMaskData = firstMaskedId ? maskData[firstMaskedId] : undefined;
        const activeMaskFeather = firstMaskedId ? (maskFeather[firstMaskedId] ?? 0) : undefined;

        // 3. Fire generation in background (don't await)
        startGeneration(
            {
                prompt,
                apiType,
                params,
                imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
                placeholderIds,
                maskDataUrl: activeMaskData,
                maskFeather: activeMaskFeather,
            },
            {
                onSuccess: (placeholderId, result) => {
                    console.log(`✅ Image ${placeholderId} completed`);
                    updateImage(placeholderId, result);
                },
                onError: (placeholderId, error) => {
                    console.error(`❌ Image ${placeholderId} failed:`, error);
                    setError(error);
                    removeImage(placeholderId);
                },
                onThoughtImages: (images) => {
                    console.log(`🎨 Received ${images.length} thought images`);
                    addThoughtImages(images);
                },
            }
        );
    };

    const ratioOptions = ['auto', '1:1', '1:2', '1:4', '1:8', '2:1', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '9:21', '16:9', '21:9'];
    const qualityOptions = [
        { value: 'standard', label: '1K' },
        { value: 'medium', label: '2K' },
        { value: 'hd', label: '4K' },
    ];
    const gptImageQualityOptions = ['auto', 'low', 'medium', 'high'];
    const moderationOptions = ['auto', 'low'];
    const resolutionOptions = ['1K', '2K', '4K'];
    const sousakuModel = normalizeSousakuModel(generateParams.sousakuModel || 'gpt-image-2');
    const sousakuModelSupportsResolution = ['gpt-image-2-low', 'gpt-image-2', 'gpt-image-2-high', 'wan-image-2.7-pro'].includes(sousakuModel);
    const sousakuModelHasFixedCount = ['mj-image-v7', 'mj-image-niji-7'].includes(sousakuModel);
    const sousakuResolutionDefault = '4k';

    // CLIProxy: ratio + resolution -> pixel size mapping
    const cliproxySizeMap: Record<string, Record<string, string | null>> = {
        '1:1': { '1K': '1024x1024', '2K': '2048x2048', '4K': '2880x2880' },
        '3:2': { '1K': '1536x1024', '2K': '2048x1360', '4K': '3504x2336' },
        '2:3': { '1K': '1024x1536', '2K': '1360x2048', '4K': '2336x3504' },
        '4:3': { '1K': '1024x768', '2K': '2048x1536', '4K': '3264x2448' },
        '3:4': { '1K': '768x1024', '2K': '1536x2048', '4K': '2448x3264' },
        '5:4': { '1K': '1280x1024', '2K': '2560x2048', '4K': '3200x2560' },
        '4:5': { '1K': '1024x1280', '2K': '2048x2560', '4K': '2560x3200' },
        '16:9': { '1K': '1536x864', '2K': '2048x1152', '4K': '3840x2160' },
        '9:16': { '1K': '864x1536', '2K': '1152x2048', '4K': '2160x3840' },
        '2:1': { '1K': '2048x1024', '2K': '2688x1344', '4K': '3840x1920' },
        '1:2': { '1K': '1024x2048', '2K': '1344x2688', '4K': '1920x3840' },
        '21:9': { '1K': '2016x864', '2K': '2688x1152', '4K': '3840x1648' },
        '9:21': { '1K': '864x2016', '2K': '1152x2688', '4K': '1648x3840' },
    };
    const cliproxyRatioOptions = Object.keys(cliproxySizeMap);
    // Which CLIProxy ratios support 4K
    const cliproxy4kRatios = cliproxyRatioOptions.filter(r => cliproxySizeMap[r]['4K'] !== null);

    // APIMart gpt-image-2: all supported ratios, but 4K only supports these 6
    const apimart4kOnlyRatios = ['16:9', '9:16', '2:1', '1:2', '21:9', '9:21'];

    const selectedCount = selectedRefs.length;

    // Check if current API+model supports mask editing
    const currentModel = selectedApi === 'cliproxy'
        ? (generateParams.cliproxyModel || 'gpt-image-2')
        : selectedApi === 'apimart'
            ? (generateParams.apimartModel || 'gemini-3-pro-image-preview')
            : undefined;
    const maskSupported = useMemo(
        () => isMaskSupported(selectedApi, currentModel),
        [selectedApi, currentModel]
    );

    return (
        <>
            {/* Floating centered input panel */}
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 w-full max-w-2xl px-4">
                {/* Error message */}
                <AnimatePresence>
                    {error && (
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 10 }}
                            className="mb-2 px-4 py-2 rounded-xl bg-red-500/20 text-red-400 text-sm flex items-center justify-between backdrop-blur-sm"
                        >
                            <span>{error}</span>
                            <button onClick={() => setError(null)}>
                                <X className="w-4 h-4" />
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Settings panel (collapsible) */}
                <AnimatePresence>
                    {showSettings && (
                        <motion.div
                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.95 }}
                            className="mb-2 p-3 rounded-xl glass shadow-lg"
                        >
                            <div className="flex flex-wrap items-center gap-3">
                                {/* API Selector */}
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-[var(--text-muted)]">API:</span>
                                    <select
                                        value={selectedApi}
                                        onChange={(e) => setSelectedApi(e.target.value as 'apimart' | 'openai' | 'nanobanana2' | 'cliproxy' | 'sousaku')}
                                        className="px-2 py-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                                    >
                                        <option value="openai">ChatGPT2API</option>
                                        <option value="cliproxy">CLIProxy</option>
                                        <option value="sousaku">Sousaku</option>
                                        <option value="nanobanana2">Nanobanana2</option>
                                        <option value="apimart">APIMart</option>
                                    </select>
                                </div>

                                {selectedApi === 'openai' ? (
                                    <>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-[var(--text-muted)]">比例:</span>
                                            <select
                                                value={generateParams.ratio || '16:9'}
                                                onChange={(e) => setGenerateParams({ ratio: e.target.value })}
                                                className="px-2 py-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                                            >
                                                {ratioOptions.map((ratio) => (
                                                    <option key={ratio} value={ratio}>{ratio}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-[var(--text-muted)]">数量:</span>
                                            <select
                                                value={generateParams.imageCount || 1}
                                                onChange={(e) => setGenerateParams({ imageCount: parseInt(e.target.value) })}
                                                className="px-2 py-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                                            >
                                                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                                                    <option key={n} value={n}>{n}张</option>
                                                ))}
                                            </select>
                                        </div>
                                    </>
                                ) : selectedApi === 'cliproxy' ? (
                                    <>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-[var(--text-muted)]">模型:</span>
                                            <select
                                                value={generateParams.cliproxyModel || 'gpt-image-2'}
                                                onChange={(e) => setGenerateParams({ cliproxyModel: e.target.value })}
                                                className="px-2 py-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                                            >
                                                <option value="gpt-image-2">GPT-Image-2</option>
                                                <option value="gemini-3.1-flash-image">Gemini 3.1 Flash Image</option>
                                            </select>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-[var(--text-muted)]">比例:</span>
                                            <select
                                                value={generateParams.ratio || '16:9'}
                                                onChange={(e) => {
                                                    const newRatio = e.target.value;
                                                    // If current resolution is 4K but new ratio doesn't support it, downgrade to 2K
                                                    if (generateParams.resolution === '4K' && !cliproxy4kRatios.includes(newRatio)) {
                                                        setGenerateParams({ ratio: newRatio, resolution: '2K' });
                                                    } else {
                                                        setGenerateParams({ ratio: newRatio });
                                                    }
                                                }}
                                                className="px-2 py-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                                            >
                                                {cliproxyRatioOptions.map((ratio) => (
                                                    <option key={ratio} value={ratio}>{ratio}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-[var(--text-muted)]">分辨率:</span>
                                            <select
                                                value={generateParams.resolution || '2K'}
                                                onChange={(e) => setGenerateParams({ resolution: e.target.value })}
                                                className="px-2 py-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                                            >
                                                {resolutionOptions.map((res) => {
                                                    const curRatio = generateParams.ratio || '16:9';
                                                    const disabled = res === '4K' && !cliproxy4kRatios.includes(curRatio);
                                                    return (
                                                        <option key={res} value={res} disabled={disabled}>
                                                            {res}{disabled ? ' (不可用)' : ''}
                                                            {cliproxySizeMap[curRatio]?.[res] ? ` (${cliproxySizeMap[curRatio][res]})` : ''}
                                                        </option>
                                                    );
                                                })}
                                            </select>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-[var(--text-muted)]">画质:</span>
                                            <select
                                                value={generateParams.quality}
                                                onChange={(e) => setGenerateParams({ quality: e.target.value })}
                                                className="px-2 py-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                                            >
                                                <option value="low">Low</option>
                                                <option value="medium">Medium</option>
                                                <option value="high">High</option>
                                            </select>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-[var(--text-muted)]">数量:</span>
                                            <select
                                                value={generateParams.imageCount || 1}
                                                onChange={(e) => setGenerateParams({ imageCount: parseInt(e.target.value) })}
                                                className="px-2 py-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                                            >
                                                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                                                    <option key={n} value={n}>{n}张</option>
                                                ))}
                                            </select>
                                        </div>
                                    </>
                                ) : selectedApi === 'sousaku' ? (
                                    <>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-[var(--text-muted)]">模型:</span>
                                            <select
                                                value={sousakuModel}
                                                onChange={(e) => {
                                                    const nextModel = e.target.value;
                                                    setGenerateParams({
                                                        sousakuModel: nextModel,
                                                        imageCount: ['mj-image-v7', 'mj-image-niji-7'].includes(nextModel) ? 4 : generateParams.imageCount,
                                                    });
                                                }}
                                                className="px-2 py-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                                            >
                                                <option value="gpt-image-2-low">GPT Image 2.0 Low</option>
                                                <option value="gpt-image-2">GPT Image 2.0 Medium</option>
                                                <option value="gpt-image-2-high">GPT Image 2.0 High</option>
                                                <option value="wan-image-2.7-pro">WAN Image 2.7 Pro</option>
                                                <option value="mj-image-v7">Midjourney V7</option>
                                                <option value="mj-image-niji-7">Midjourney Niji 7</option>
                                            </select>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-[var(--text-muted)]">比例:</span>
                                            <select
                                                value={generateParams.ratio || '1:1'}
                                                onChange={(e) => setGenerateParams({ ratio: e.target.value })}
                                                className="px-2 py-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                                            >
                                                {ratioOptions.filter((ratio) => ratio !== 'auto').map((ratio) => (
                                                    <option key={ratio} value={ratio}>{ratio}</option>
                                                ))}
                                            </select>
                                        </div>
                                        {sousakuModelSupportsResolution && (
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs text-[var(--text-muted)]">分辨率:</span>
                                                <select
                                                    value={generateParams.resolution || sousakuResolutionDefault}
                                                    onChange={(e) => setGenerateParams({ resolution: e.target.value })}
                                                    className="px-2 py-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                                                >
                                                    <option value="2k">2K</option>
                                                    <option value="4k">4K</option>
                                                </select>
                                            </div>
                                        )}
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-[var(--text-muted)]">自动优化:</span>
                                            <select
                                                value={generateParams.sousakuAutoOptimize ?? true ? 'true' : 'false'}
                                                onChange={(e) => setGenerateParams({ sousakuAutoOptimize: e.target.value === 'true' })}
                                                className="px-2 py-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                                            >
                                                <option value="true">开启</option>
                                                <option value="false">关闭</option>
                                            </select>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-[var(--text-muted)]">数量:</span>
                                            <select
                                                value={sousakuModelHasFixedCount ? 4 : (generateParams.imageCount || 1)}
                                                onChange={(e) => setGenerateParams({ imageCount: parseInt(e.target.value) })}
                                                className="px-2 py-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                                            >
                                                {(sousakuModelHasFixedCount ? [4] : [1, 2, 3, 4]).map((n) => (
                                                    <option key={n} value={n}>{n}张</option>
                                                ))}
                                            </select>
                                        </div>
                                    </>
                                ) : selectedApi === 'nanobanana2' ? (
                                    <>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-[var(--text-muted)]">比例:</span>
                                            <select
                                                value={generateParams.ratio}
                                                onChange={(e) => setGenerateParams({ ratio: e.target.value })}
                                                className="px-2 py-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                                            >
                                                {ratioOptions.map((ratio) => (
                                                    <option key={ratio} value={ratio}>{ratio}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-[var(--text-muted)]">画质:</span>
                                            <select
                                                value={generateParams.quality}
                                                onChange={(e) => setGenerateParams({ quality: e.target.value })}
                                                className="px-2 py-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                                            >
                                                {qualityOptions.map((opt) => (
                                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-[var(--text-muted)]">数量:</span>
                                            <select
                                                value={generateParams.imageCount || 1}
                                                onChange={(e) => setGenerateParams({ imageCount: parseInt(e.target.value) })}
                                                className="px-2 py-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                                            >
                                                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                                                    <option key={n} value={n}>{n}张</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-[var(--text-muted)]">思考:</span>
                                            <select
                                                value={generateParams.thinkingLevel || 'High'}
                                                onChange={(e) => setGenerateParams({ thinkingLevel: e.target.value })}
                                                className="px-2 py-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                                            >
                                                <option value="High">High</option>
                                                <option value="Minimal">Minimal</option>
                                            </select>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-[var(--text-muted)]">模型:</span>
                                            <select
                                                value={generateParams.apimartModel || 'gemini-3-pro-image-preview'}
                                                onChange={(e) => setGenerateParams({ apimartModel: e.target.value })}
                                                className="px-2 py-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                                            >
                                                <option value="gemini-3-pro-image-preview">Gemini 3 Pro</option>
                                                <option value="gemini-3.1-flash-image-preview">Gemini 3.1 Flash</option>
                                                <option value="gpt-image-2">GPT-Image-2</option>
                                                <option value="gpt-image-2-official">GPT-Image-2 Official</option>
                                            </select>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-[var(--text-muted)]">比例:</span>
                                            <select
                                                value={generateParams.ratio}
                                                onChange={(e) => {
                                                    const newRatio = e.target.value;
                                                    // APIMart gpt-image-2: if 4K and ratio not in allowed list, downgrade
                                                    const isGptImage2 = (generateParams.apimartModel || '').startsWith('gpt-image-2');
                                                    if (isGptImage2 && generateParams.resolution === '4K' && !apimart4kOnlyRatios.includes(newRatio)) {
                                                        setGenerateParams({ ratio: newRatio, resolution: '2K' });
                                                    } else {
                                                        setGenerateParams({ ratio: newRatio });
                                                    }
                                                }}
                                                className="px-2 py-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                                            >
                                                {ratioOptions.map((ratio) => {
                                                    const isGptImage2 = (generateParams.apimartModel || '').startsWith('gpt-image-2');
                                                    const blocked4k = isGptImage2 && generateParams.resolution === '4K' && !apimart4kOnlyRatios.includes(ratio) && ratio !== 'auto';
                                                    return (
                                                        <option key={ratio} value={ratio} disabled={blocked4k}>
                                                            {ratio}{blocked4k ? ' (4K不可用)' : ''}
                                                        </option>
                                                    );
                                                })}
                                            </select>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-[var(--text-muted)]">分辨率:</span>
                                            <select
                                                value={generateParams.resolution}
                                                onChange={(e) => setGenerateParams({ resolution: e.target.value })}
                                                className="px-2 py-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                                            >
                                                {resolutionOptions.map((res) => {
                                                    const isGptImage2 = (generateParams.apimartModel || '').startsWith('gpt-image-2');
                                                    const curRatio = generateParams.ratio || '16:9';
                                                    const disabled = isGptImage2 && res === '4K' && !apimart4kOnlyRatios.includes(curRatio) && curRatio !== 'auto';
                                                    return (
                                                        <option key={res} value={res} disabled={disabled}>
                                                            {res}{disabled ? ' (当前比例不可用)' : ''}
                                                        </option>
                                                    );
                                                })}
                                            </select>
                                        </div>
                                        {generateParams.apimartModel === 'gpt-image-2-official' && (
                                            <>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs text-[var(--text-muted)]">Quality:</span>
                                                    <select
                                                        value={generateParams.quality || 'high'}
                                                        onChange={(e) => setGenerateParams({ quality: e.target.value })}
                                                        className="px-2 py-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                                                    >
                                                        {gptImageQualityOptions.map((quality) => (
                                                            <option key={quality} value={quality}>{quality}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs text-[var(--text-muted)]">Moderation:</span>
                                                    <select
                                                        value={generateParams.moderation || 'low'}
                                                        onChange={(e) => setGenerateParams({ moderation: e.target.value })}
                                                        className="px-2 py-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                                                    >
                                                        {moderationOptions.map((moderation) => (
                                                            <option key={moderation} value={moderation}>{moderation}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </>
                                        )}
                                    </>
                                )}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Main input bar */}
                <div className="flex items-center gap-2 p-2 rounded-2xl glass shadow-2xl border border-[var(--border-subtle)]">
                    {/* Image picker button */}
                    <button
                        onClick={() => setShowImagePicker(true)}
                        className={`relative p-2.5 rounded-xl transition-colors ${selectedCount > 0
                            ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-primary)]'
                            : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]'
                            }`}
                        title="选择参考图"
                    >
                        <ImageIcon className="w-5 h-5" />
                        {selectedCount > 0 && (
                            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[var(--accent-primary)] text-white text-xs flex items-center justify-center">
                                {selectedCount}
                            </span>
                        )}
                    </button>

                    {/* Settings toggle */}
                    <button
                        onClick={() => setShowSettings(!showSettings)}
                        className={`p-2.5 rounded-xl transition-colors ${showSettings
                            ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-primary)]'
                            : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]'
                            }`}
                        title="设置"
                    >
                        <Settings className="w-5 h-5" />
                    </button>

                    {/* Prompt input - expandable textarea */}
                    <motion.textarea
                        ref={textareaRef}
                        value={currentPrompt}
                        onChange={(e) => setCurrentPrompt(e.target.value)}
                        onFocus={() => setIsPromptFocused(true)}
                        onBlur={(e) => {
                            // Don't collapse if clicking on action buttons (send, image, settings)
                            const relatedTarget = e.relatedTarget as HTMLElement | null;
                            if (relatedTarget?.closest('button')) {
                                return; // Keep expanded when clicking buttons
                            }
                            setIsPromptFocused(false);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleGenerate();
                            }
                        }}
                        placeholder="输入你的创意描述..."
                        rows={1}
                        animate={{
                            height: isPromptFocused ? 120 : 40,
                        }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                        className="flex-1 px-4 py-2.5 bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none resize-none overflow-y-auto"
                        style={{ lineHeight: '1.5' }}
                    />

                    {/* Generate button */}
                    <button
                        onClick={handleGenerate}
                        disabled={!currentPrompt.trim()}
                        className={`p-2.5 rounded-xl transition-all ${currentPrompt.trim()
                            ? 'bg-[var(--accent-primary)] hover:bg-[var(--accent-secondary)] hover-glow'
                            : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] cursor-not-allowed'
                            } text-white`}
                    >
                        <Send className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* Image Picker Modal */}
            <AnimatePresence>
                {showImagePicker && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
                        onClick={() => setShowImagePicker(false)}
                    >
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            className="w-full max-w-lg mx-4 p-4 rounded-2xl glass shadow-2xl"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-semibold text-[var(--text-primary)]">选择参考图</h3>
                                <button
                                    onClick={() => setShowImagePicker(false)}
                                    className="p-1 rounded-lg hover:bg-[var(--bg-card-hover)] text-[var(--text-secondary)]"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            {/* Upload area */}
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                multiple
                                className="hidden"
                                onChange={(e) => handleFileUpload(e.target.files)}
                            />
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                disabled={uploadingCount > 0}
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                onDrop={handleDrop}
                                className={`w-full p-6 mb-4 rounded-xl border-2 border-dashed transition-colors flex flex-col items-center gap-2 disabled:opacity-50 ${isDragging
                                    ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]'
                                    : 'border-[var(--border-subtle)] hover:border-[var(--accent-primary)] text-[var(--text-secondary)] hover:text-[var(--accent-primary)]'
                                    }`}
                            >
                                {uploadingCount > 0 ? (
                                    <>
                                        <Loader2 className="w-8 h-8 animate-spin" />
                                        <span className="text-sm">正在上传 {uploadingCount} 张图片...</span>
                                    </>
                                ) : (
                                    <>
                                        <Plus className="w-8 h-8" />
                                        <span className="text-sm">点击或拖拽上传图片（支持 URL 链接）</span>
                                    </>
                                )}
                            </button>

                            {/* Uploaded images grid */}
                            {uploadedImages.length > 0 ? (
                                <div className="grid grid-cols-4 gap-2 max-h-64 overflow-y-auto">
                                    {uploadedImages.map((img) => (
                                        <div
                                            key={img.id}
                                            onClick={() => img.base64 && toggleRefSelection(img.id)}
                                            className={`relative aspect-square rounded-lg overflow-hidden cursor-pointer border-2 transition-all ${!img.base64
                                                ? 'border-yellow-500/50 opacity-50'
                                                : selectedRefs.includes(img.id)
                                                    ? 'border-[var(--accent-primary)] ring-2 ring-[var(--accent-primary)]/50'
                                                    : 'border-transparent hover:border-[var(--text-muted)]'
                                                }`}
                                        >
                                            <img
                                                src={img.preview}
                                                alt="Uploaded"
                                                className="w-full h-full object-cover"
                                            />
                                            {!img.base64 && (
                                                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                                                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                                                </div>
                                            )}
                                            {img.base64 && selectedRefs.includes(img.id) && (
                                                <div className="absolute top-1 right-1 p-0.5 rounded-full bg-[var(--accent-primary)]">
                                                    <Check className="w-3 h-3 text-white" />
                                                </div>
                                            )}
                                            {/* Mask edit button — only when mask is supported */}
                                            {maskSupported && img.base64 && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (maskData[img.id]) {
                                                            // Already has mask → remove it
                                                            removeMaskData(img.id);
                                                        } else {
                                                            // Open mask editor
                                                            setMaskEditingImageId(img.id);
                                                        }
                                                    }}
                                                    className={`absolute bottom-1 left-1 p-1 rounded-full transition-all ${
                                                        maskData[img.id]
                                                            ? 'bg-blue-500 text-white opacity-100 ring-1 ring-blue-400/50'
                                                            : 'bg-black/60 text-white/70 opacity-70 hover:opacity-100'
                                                    }`}
                                                    title={maskData[img.id] ? '已有遮罩 (点击移除)' : '编辑遮罩'}
                                                >
                                                    <Paintbrush className="w-3 h-3" />
                                                </button>
                                            )}
                                            {/* Delete button */}
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    removeUploadedImage(img.id);
                                                    setSelectedRefs(prev => prev.filter(i => i !== img.id));
                                                }}
                                                className="absolute bottom-1 right-1 p-1 rounded-full bg-red-500/80 text-white opacity-0 hover:opacity-100 transition-opacity"
                                            >
                                                <X className="w-3 h-3" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-center text-[var(--text-muted)] text-sm py-4">
                                    还没有上传图片
                                </p>
                            )}

                            {/* Footer */}
                            <div className="flex items-center justify-between mt-4 pt-4 border-t border-[var(--border-subtle)]">
                                <span className="text-sm text-[var(--text-secondary)]">
                                    已选择 {selectedRefs.length} 张
                                </span>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setSelectedRefs([])}
                                        className="px-3 py-1.5 rounded-lg text-sm bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]"
                                    >
                                        清除选择
                                    </button>
                                    <button
                                        onClick={() => setShowImagePicker(false)}
                                        className="px-3 py-1.5 rounded-lg text-sm bg-[var(--accent-primary)] text-white hover:bg-[var(--accent-secondary)]"
                                    >
                                        确定
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Full-screen Mask Editor Overlay */}
            {maskEditingImageId && (() => {
                const editImg = uploadedImages.find(img => img.id === maskEditingImageId);
                if (!editImg) return null;
                return (
                    <MaskEditor
                        imageSrc={editImg.preview}
                        existingMask={maskData[maskEditingImageId]}
                        existingFeather={maskFeather[maskEditingImageId]}
                        onConfirm={(maskDataUrl, feather, inputMaxEdge) => {
                            setMaskData(maskEditingImageId, maskDataUrl, feather);
                            if (inputMaxEdge) {
                                setGenerateParams({ inputMaxEdge });
                            }
                            setMaskEditingImageId(null);
                        }}
                        onCancel={() => setMaskEditingImageId(null)}
                    />
                );
            })()}
        </>
    );
}
