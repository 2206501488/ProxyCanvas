/**
 * Generation Service - unified background job orchestration.
 *
 * The frontend submits every provider through the Job System. Provider-specific
 * request details stay in buildProviderRequest(), while execution, polling and
 * task history are handled by backend Provider Adapters.
 */

import type { GenerateParams, ImageItem, ThoughtImage } from '../types';
import {
    checkGenerationJob,
    createGenerationJob,
    type GenerationJob,
} from './api';

export interface GenerationCallbacks {
    onSuccess: (placeholderId: string, result: Partial<ImageItem>) => void;
    onError: (placeholderId: string, error: string) => void;
    onThoughtImages?: (images: ThoughtImage[]) => void;
}

export interface GenerationRequest {
    prompt: string;
    apiType: 'apimart' | 'openai' | 'nanobanana2' | 'cliproxy' | 'sousaku' | 'other';
    params: GenerateParams;
    imageUrls?: { url: string }[];
    placeholderIds: string[];
    maskDataUrl?: string;
    maskFeather?: number;
}

type ProviderPayload = Record<string, unknown> & {
    prompt: string;
    n?: number;
    image_urls?: { url: string }[];
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function imageCountFor(request: GenerationRequest) {
    return Math.max(1, request.placeholderIds.length || request.params.imageCount || 1);
}

function resolveProvider(apiType: GenerationRequest['apiType']) {
    return apiType === 'other' ? 'apimart' : apiType;
}

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

function sousakuDefaultResolution(model: string) {
    model = normalizeSousakuModel(model);
    if (['gpt-image-2-low', 'gpt-image-2', 'gpt-image-2-high', 'wan-image-2.7-pro'].includes(model)) return '4k';
    if (model === 'seedream-4.5') return '2k';
    return undefined;
}

function sousakuFixedImageCount(model: string) {
    model = normalizeSousakuModel(model);
    return ['mj-image-v7', 'mj-image-niji-7'].includes(model) ? 4 : undefined;
}

function cliproxyPixelSize(params: GenerateParams) {
    const cliproxySizeMap: Record<string, Record<string, string>> = {
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
    const ratio = params.ratio || '16:9';
    const resolution = params.resolution || '2K';
    if (resolution.includes('x')) return resolution;
    return cliproxySizeMap[ratio]?.[resolution] || cliproxySizeMap[ratio]?.['2K'] || '2048x1152';
}

function buildProviderRequest(request: GenerationRequest): { provider: string; payload: ProviderPayload } {
    const { prompt, apiType, params, imageUrls, maskDataUrl, maskFeather } = request;
    const provider = resolveProvider(apiType);
    const n = imageCountFor(request);

    if (provider === 'sousaku') {
        const sousakuModel = normalizeSousakuModel(params.sousakuModel || 'gpt-image-2');
        const defaultResolution = sousakuDefaultResolution(sousakuModel);
        const fixedCount = sousakuFixedImageCount(sousakuModel);
        return {
            provider,
            payload: {
                prompt,
                size: params.ratio || '1:1',
                resolution: defaultResolution ? (params.resolution || defaultResolution) : undefined,
                auto_optimize: params.sousakuAutoOptimize ?? true,
                n: fixedCount || n,
                image_urls: imageUrls,
                model: sousakuModel,
            },
        };
    }

    if (provider === 'nanobanana2') {
        return {
            provider,
            payload: {
                prompt,
                size: params.ratio,
                quality: params.quality,
                n,
                image_urls: imageUrls,
                thinking_level: params.thinkingLevel || 'High',
                mask_data: maskDataUrl,
                feather: maskFeather,
            },
        };
    }

    if (provider === 'cliproxy') {
        const cliproxyModel = params.cliproxyModel || 'gpt-image-2';
        const ratio = params.ratio || '16:9';
        const resolution = params.resolution || '2K';
        return {
            provider,
            payload: {
                prompt,
                size: cliproxyModel === 'gemini-3.1-flash-image' ? ratio : cliproxyPixelSize(params),
                quality: params.quality,
                resolution,
                n,
                image_urls: imageUrls,
                model: cliproxyModel,
                mask_data: maskDataUrl,
                feather: maskFeather,
                input_max_edge: params.inputMaxEdge ? parseInt(params.inputMaxEdge, 10) : undefined,
            },
        };
    }

    if (provider === 'openai') {
        return {
            provider,
            payload: {
                prompt,
                size: params.ratio || '16:9',
                n,
                image_urls: imageUrls,
            },
        };
    }

    const isOfficialGptImage2 = params.apimartModel === 'gpt-image-2-official';
    return {
        provider: 'apimart',
        payload: {
            prompt,
            size: params.ratio,
            resolution: params.resolution,
            image_urls: imageUrls,
            model: params.apimartModel || 'gemini-3-pro-image-preview',
            mask_data: maskDataUrl,
            feather: maskFeather,
            ...(isOfficialGptImage2
                ? {
                    quality: params.quality || 'high',
                    moderation: params.moderation || 'low',
                }
                : {}),
        },
    };
}

function imageIdentity(image: Record<string, unknown>) {
    return String(
        image.content_id ||
        image.file_id ||
        image.saved_path ||
        image.url ||
        image.data_uri ||
        image.filename ||
        ''
    );
}

function toDisplayResult(image: Record<string, unknown>): Partial<ImageItem> {
    const localPath = image.saved_path as string | undefined;
    const directUrl = (image.url || image.data_uri || image.b64_json) as string | undefined;
    const serveUrl = localPath ? `/api/serve-image?path=${encodeURIComponent(localPath)}` : undefined;
    const displayUrl = serveUrl || directUrl || '';

    return {
        status: 'success',
        localPath: displayUrl,
        savedFilePath: localPath || undefined,
        thumbnail: displayUrl,
        width: image.width as number | undefined,
        height: image.height as number | undefined,
        originalUrl: directUrl,
        tags: image.download_failed ? ['下载失败'] : [],
    };
}

function applyJobImages(
    job: GenerationJob,
    placeholderIds: string[],
    filled: Set<string>,
    seenImages: Set<string>,
    callbacks: GenerationCallbacks,
) {
    for (const image of job.result || []) {
        const identity = imageIdentity(image);
        if (!identity || seenImages.has(identity)) continue;

        const placeholderId = placeholderIds.find((id) => !filled.has(id));
        if (!placeholderId) break;

        seenImages.add(identity);
        filled.add(placeholderId);
        callbacks.onSuccess(placeholderId, toDisplayResult(image));
    }
}

async function runProviderJob(request: GenerationRequest, callbacks: GenerationCallbacks): Promise<void> {
    const { provider, payload } = buildProviderRequest(request);
    const createResponse = await createGenerationJob(provider, payload);
    if (!createResponse.success) {
        throw new Error(createResponse.error?.message || `${provider} 任务提交失败`);
    }

    const jobId = createResponse.job_id || createResponse.data?.job_id || createResponse.data?.id;
    if (!jobId) {
        throw new Error(`${provider} 未返回 job_id`);
    }

    const filled = new Set<string>();
    const seenImages = new Set<string>();
    const maxElapsedMs = 30 * 60 * 1000;
    const startedAt = Date.now();

    while (Date.now() - startedAt < maxElapsedMs) {
        await sleep(2000);
        const jobResponse = await checkGenerationJob(jobId);
        const job = jobResponse.data;
        if (!jobResponse.success || !job) {
            throw new Error(jobResponse.error?.message || `${provider} Job 查询失败`);
        }

        applyJobImages(job, request.placeholderIds, filled, seenImages, callbacks);

        const status = String(job.status || '').toLowerCase();
        if (status === 'succeeded') {
            for (const placeholderId of request.placeholderIds) {
                if (!filled.has(placeholderId)) {
                    callbacks.onError(placeholderId, `${provider} 返回图片数量不足`);
                }
            }
            return;
        }

        if (['failed', 'error', 'timeout', 'cancelled'].includes(status)) {
            const message = job.error || `${provider} 生成失败`;
            for (const placeholderId of request.placeholderIds) {
                if (!filled.has(placeholderId)) {
                    callbacks.onError(placeholderId, message);
                }
            }
            return;
        }
    }

    for (const placeholderId of request.placeholderIds) {
        if (!filled.has(placeholderId)) {
            callbacks.onError(placeholderId, `${provider} 任务轮询超时`);
        }
    }
}

/**
 * Start async generation. Returns immediately after the backend job is submitted.
 * Results are delivered via callbacks as the job record receives images.
 */
export async function startGeneration(
    request: GenerationRequest,
    callbacks: GenerationCallbacks
): Promise<void> {
    try {
        await runProviderJob(request, callbacks);
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : '生成失败';
        console.error('Generation error:', err);
        for (const id of request.placeholderIds) {
            callbacks.onError(id, errorMessage);
        }
    }
}
