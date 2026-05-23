/**
 * Generation Service - unified background job orchestration.
 *
 * The frontend submits stable generation params through the Job System.
 * Provider-specific payload translation lives in the backend Provider Adapters.
 */

import type { GenerateParams, ImageItem, ThoughtImage } from '../types';
import {
    checkGenerationJob,
    createGenerationJob,
    type GenerationJob,
    type RuntimeProvider,
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
    modelConfig?: RuntimeProvider['models'][number];
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
    const fixedCount = Number(request.modelConfig?.constraints?.fixedImageCount || 0);
    return Math.max(1, fixedCount || request.placeholderIds.length || request.params.imageCount || Number(request.modelConfig?.defaults?.imageCount || 1) || 1);
}

function resolveProvider(apiType: GenerationRequest['apiType']) {
    return apiType === 'other' ? 'apimart' : apiType;
}

function modelValueFor(provider: string, params: GenerateParams, modelConfig?: GenerationRequest['modelConfig']) {
    if (modelConfig?.value) return modelConfig.value;
    if (provider === 'apimart') return params.apimartModel || 'gemini-3-pro-image-preview';
    if (provider === 'cliproxy') return params.cliproxyModel || 'gpt-image-2';
    if (provider === 'sousaku') return params.sousakuModel || 'gpt-image-2';
    return params.model || modelConfig?.value || '';
}

function buildProviderRequest(request: GenerationRequest): { provider: string; payload: ProviderPayload } {
    const { prompt, apiType, params, modelConfig, imageUrls, maskDataUrl, maskFeather } = request;
    const provider = resolveProvider(apiType);
    const n = imageCountFor(request);
    const model = modelValueFor(provider, params, modelConfig);
    return {
        provider,
        payload: {
            prompt,
            ...params,
            n,
            image_urls: imageUrls,
            model: model || undefined,
            mask_data: maskDataUrl,
            feather: maskFeather,
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
