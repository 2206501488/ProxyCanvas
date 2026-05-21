import axios from 'axios';
import type { BackendCapabilities, GenerateRequest, GenerateResponse, ImageItem, TaskStatusResponse } from '../types';

const api = axios.create({
    baseURL: '/api',
    timeout: 1200000, // 20 minutes for image generation
});

// APIMart API (async with polling)
export async function generateWithAPIMart(request: GenerateRequest): Promise<GenerateResponse> {
    const response = await api.post<GenerateResponse>('/generate', request);
    return response.data;
}

export async function getBackendCapabilities(): Promise<BackendCapabilities> {
    try {
        const response = await api.get<BackendCapabilities>('/capabilities', { timeout: 3000 });
        return response.data;
    } catch {
        return {
            backendVersion: 'v1',
            features: {
                galleryImport: false,
            },
        };
    }
}

// OpenAI API (sync)
export async function generateWithOpenAI(request: GenerateRequest): Promise<GenerateResponse> {
    const response = await api.post<GenerateResponse>('/generate-openai', request);
    return response.data;
}

export interface OpenAITaskItem {
    task_id: string;
    status: string;
    index?: number;
    data?: GenerateResponse['data'];
    error?: { message: string } | null;
}

export interface OpenAITaskCreateResponse {
    success: boolean;
    data: OpenAITaskItem[];
    error?: { message: string };
}

export interface OpenAITaskStatusResponse {
    success: boolean;
    data: OpenAITaskItem[];
    missing_ids?: string[];
    error?: { message: string };
}

// ChatGPT2API task mode (matches its own frontend more closely)
export async function generateOpenAITasks(request: GenerateRequest): Promise<OpenAITaskCreateResponse> {
    const response = await api.post<OpenAITaskCreateResponse>('/generate-openai-tasks', request);
    return response.data;
}

export async function checkOpenAITasks(taskIds: string[]): Promise<OpenAITaskStatusResponse> {
    const response = await api.get<OpenAITaskStatusResponse>('/openai-tasks', {
        params: { ids: taskIds.join(',') },
    });
    return response.data;
}

// Nanobanana2 API (Gemini 3.1 Flash Image - sync, concurrent)
export async function generateWithNanobanana2(request: GenerateRequest): Promise<GenerateResponse> {
    const response = await api.post<GenerateResponse>('/generate-nanobanana2', request);
    return response.data;
}

// CLIProxyAPI (Local Proxy for Codex/Claude/Gemini OAuth - OpenAI compatible, gpt-image-2)
export async function generateWithCliProxy(request: GenerateRequest): Promise<GenerateResponse> {
    const response = await api.post<GenerateResponse>('/generate-cliproxy', request);
    return response.data;
}

// Sousaku.ai API (async with partial-result polling)
export async function generateWithSousaku(request: GenerateRequest): Promise<GenerateResponse> {
    const response = await api.post<GenerateResponse>('/generate-sousaku', request);
    return response.data;
}

export async function checkSousakuTask(taskId: string): Promise<TaskStatusResponse> {
    const response = await api.get<TaskStatusResponse>(`/sousaku-task/${taskId}`);
    return response.data;
}

export interface GenerationJob {
    id: string;
    job_id: string;
    provider: string;
    status: 'queued' | 'submitting' | 'running' | 'saving' | 'succeeded' | 'failed' | 'cancelled' | 'timeout';
    prompt: string;
    params: Record<string, unknown>;
    input_images: Array<{ url: string }>;
    external_task_id?: string;
    progress: number;
    result: Array<Record<string, any>>;
    error?: string;
    created_at: string;
    updated_at: string;
    started_at?: string;
    finished_at?: string;
    events?: Array<Record<string, unknown>>;
}

export interface GenerationJobResponse {
    success: boolean;
    job_id?: string;
    data?: GenerationJob;
    error?: { message: string };
}

export async function createGenerationJob(provider: string, request: Record<string, unknown>): Promise<GenerationJobResponse> {
    const response = await api.post<GenerationJobResponse>('/jobs', {
        provider,
        ...request,
    }, {
        timeout: 30000,
    });
    return response.data;
}

export async function checkGenerationJob(jobId: string): Promise<GenerationJobResponse> {
    const response = await api.get<GenerationJobResponse>(`/jobs/${jobId}`, {
        timeout: 30000,
    });
    return response.data;
}

export async function listGenerationJobs(params?: {
    status?: string;
    active?: boolean;
    limit?: number;
}): Promise<{ success: boolean; data: GenerationJob[]; error?: { message: string } }> {
    const response = await api.get('/jobs', {
        params: {
            status: params?.status || undefined,
            active: params?.active ? '1' : undefined,
            limit: params?.limit || 100,
        },
        timeout: 30000,
    });
    return response.data;
}

export async function deleteGenerationJob(jobId: string): Promise<GenerationJobResponse> {
    const response = await api.delete<GenerationJobResponse>(`/jobs/${jobId}`, {
        timeout: 30000,
    });
    return response.data;
}

export async function deleteGenerationJobs(options?: { includeActive?: boolean }): Promise<{
    success: boolean;
    data?: { deleted: number };
    error?: { message: string };
}> {
    const response = await api.delete('/jobs', {
        data: { include_active: options?.includeActive ?? true },
        timeout: 30000,
    });
    return response.data;
}

export interface ProviderAccount {
    id: string;
    provider: string;
    label: string;
    status: 'available' | 'busy' | 'low_quota' | 'invalid' | 'disabled';
    quota?: {
        total?: number;
        remaining?: number;
        unit?: string;
    };
    running_jobs?: number;
    last_used_at?: string;
    tags?: string[];
    metadata?: Record<string, any>;
}

export async function listProviderAccounts(provider = 'sousaku', options?: { refresh?: boolean }): Promise<{
    success: boolean;
    provider: string;
    count?: number;
    updated_at?: string;
    low_credit_threshold?: number;
    data: ProviderAccount[];
    error?: { message: string };
}> {
    const response = await api.get('/provider-accounts', {
        params: { provider, refresh: options?.refresh ? '1' : undefined },
        timeout: options?.refresh ? 120000 : 30000,
    });
    return response.data;
}

export async function addSousakuTokens(tokens: string): Promise<{
    success: boolean;
    added?: number;
    skipped?: number;
    total?: number;
    refreshed?: number;
    error?: { message: string };
}> {
    const response = await api.post('/provider-accounts/sousaku/tokens', { tokens }, {
        timeout: 120000,
    });
    return response.data;
}

export async function refreshSousakuAccount(accountId: string): Promise<{
    success: boolean;
    provider?: string;
    account_id?: string;
    error?: { message: string };
}> {
    const response = await api.post(`/provider-accounts/sousaku/${encodeURIComponent(accountId)}/refresh`, {}, {
        timeout: 120000,
    });
    return response.data;
}

export async function updateSousakuAccount(accountId: string, updates: { disabled: boolean }): Promise<{
    success: boolean;
    provider?: string;
    account_id?: string;
    disabled?: boolean;
    error?: { message: string };
}> {
    const response = await api.patch(`/provider-accounts/sousaku/${encodeURIComponent(accountId)}`, updates, {
        timeout: 30000,
    });
    return response.data;
}

export async function deleteSousakuAccount(accountId: string): Promise<{
    success: boolean;
    provider?: string;
    account_id?: string;
    error?: { message: string };
}> {
    const response = await api.delete(`/provider-accounts/sousaku/${encodeURIComponent(accountId)}`, {
        timeout: 30000,
    });
    return response.data;
}

// Save a thought/draft image to local storage
export async function saveThoughtImage(dataUri: string): Promise<{ saved_path: string; filename: string }> {
    const response = await api.post<{ success: boolean; saved_path: string; filename: string }>('/save-thought-image', { data_uri: dataUri });
    return response.data;
}

// Check task status (for APIMart polling)
export async function checkTaskStatus(taskId: string): Promise<TaskStatusResponse> {
    const response = await api.get<TaskStatusResponse>(`/task/${taskId}`);
    return response.data;
}

// Poll task until complete
export async function pollTaskUntilComplete(
    taskId: string,
    onProgress?: (status: string) => void,
    maxAttempts = 200,  // 200 attempts × 3s = 10 minutes max
    interval = 3000     // 3 seconds between polls
): Promise<TaskStatusResponse> {
    for (let i = 0; i < maxAttempts; i++) {
        const response = await checkTaskStatus(taskId);

        // APIMart task query: data is OBJECT {status}, not array [{status}]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const respAny = response as any;
        // Handle both: data as object (task query) or data as array (generation)
        const dataObj = respAny.data;
        const statusFromData = Array.isArray(dataObj)
            ? dataObj[0]?.status
            : dataObj?.status;
        const status = response.status || statusFromData || '';

        if (onProgress) {
            onProgress(status);
        }

        // Case-insensitive status check for APIMart compatibility
        const statusLower = status?.toLowerCase();

        if (statusLower === 'completed' || statusLower === 'success' || statusLower === 'succeeded') {
            return response;
        }

        if (statusLower === 'failed' || response.error) {
            throw new Error(response.error?.message || 'Task failed');
        }

        await new Promise((resolve) => setTimeout(resolve, interval));
    }

    throw new Error('Task polling timeout');
}

// Get balance
export async function getBalance(): Promise<{ balance: number }> {
    const response = await api.get('/balance');
    return response.data;
}

// Upload image to image hosting (auto-compresses if >10MB)
export async function uploadImage(file: File): Promise<{
    success: boolean;
    url?: string;
    message?: string;
    compressed?: boolean;
    original_size?: number;
    final_size?: number;
}> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await api.post('/upload-image', formData, {
        // Don't set Content-Type manually - axios will set it with correct boundary
        timeout: 60000,
    });

    return response.data;
}

// Convert file to base64 data URI
export function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Unified response handler
export async function handleGenerationResponse(response: GenerateResponse): Promise<{ url: string; localPath?: string }> {
    // Returns first image only - for backward compatibility
    const results = await handleMultipleImagesResponse(response);
    if (results.length > 0) {
        return results[0];
    }
    throw new Error('生成结果为空');
}

// Handle multiple images response
export async function handleMultipleImagesResponse(response: GenerateResponse): Promise<Array<{ url: string; localPath?: string }>> {
    const results: Array<{ url: string; localPath?: string }> = [];

    // 1. Check for Sync Response (Data available immediately)
    if (response.data && response.data.length > 0) {
        // Process ALL images in data array
        for (const result of response.data) {
            const directUrl = result.url || result.b64_json || result.data_uri;
            const localPath = result.saved_path;

            if (directUrl || localPath) {
                results.push({ url: directUrl || '', localPath });
            }
        }

        if (results.length > 0) {
            return results;
        }
    }

    // 2. Check for Async Task (Needs polling)
    // APIMart nests task_id in data[0], legacy/OpenAI might use root task_id
    const taskId = response.task_id || (response.data && response.data[0]?.task_id);

    if (taskId) {
        console.log('Async task submitted, ID:', taskId);
        const taskResult = await pollTaskUntilComplete(taskId);
        console.log('Task completed, result:', JSON.stringify(taskResult, null, 2));

        // Backend returns: {code, data: {status, result: {images: [{url, saved_path}]}}}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const respAny = taskResult as any;
        const data = respAny.data || respAny;  // Handle both wrapped and unwrapped
        const images = data?.result?.images || taskResult.result?.images;

        let imageUrl: string | undefined;
        let localPath: string | undefined;

        if (images && images.length > 0) {
            const imgData = images[0];
            // Backend normalizes url to string, but handle array just in case
            const urlField = imgData.url;
            imageUrl = Array.isArray(urlField) ? urlField[0] : urlField;
            localPath = imgData.saved_path;
            console.log('📦 Found image:', { imageUrl: imageUrl?.substring(0, 50), localPath });
        }

        if (imageUrl || localPath) {
            return [{ url: imageUrl || '', localPath }];
        } else {
            console.error('Task result invalid - no image URL found:', taskResult);
            throw new Error(respAny.error?.message || taskResult.error?.message || '生成结果为空');
        }
    }

    // 3. Error Case
    console.error('Invalid response structure:', response);
    throw new Error(response.error?.message || '生成失败: 未收到有效数据或任务ID');
}

export interface GalleryData {
    images: ImageItem[];
    tags: string[];
}

export interface ImportGalleryImagesOptions {
    files: File[];
    prompt?: string;
    apiType?: ImageItem['apiType'];
    ratio?: string;
    quality?: string;
    tags?: string[];
}

export async function importGalleryImages(options: ImportGalleryImagesOptions): Promise<ImageItem[]> {
    const formData = new FormData();
    options.files.forEach((file) => formData.append('files', file));
    formData.append('prompt', options.prompt || '外部导入图片');
    formData.append('apiType', options.apiType || 'other');
    formData.append('ratio', options.ratio || 'auto');
    formData.append('quality', options.quality || 'imported');
    if (options.tags && options.tags.length > 0) {
        formData.append('tags', options.tags.join(','));
    }

    const response = await api.post<{ success: boolean; data?: ImageItem[]; message?: string }>('/gallery/import', formData, {
        timeout: 120000,
    });

    if (!response.data.success || !response.data.data) {
        throw new Error(response.data.message || '导入失败');
    }

    return response.data.data;
}

export interface ImportLocalPickerResult {
    images: ImageItem[];
    deletedOriginalCount: number;
    deleteOriginalSkippedCount: number;
}

export interface PickedLocalFile {
    token: string;
    name: string;
    previewUrl: string;
}

export async function pickLocalGalleryFiles(): Promise<PickedLocalFile[]> {
    const response = await api.post<{ success: boolean; data?: PickedLocalFile[]; message?: string }>('/gallery/pick-local-files', {}, {
        timeout: 0,
    });

    if (!response.data.success || !response.data.data) {
        throw new Error(response.data.message || '选择文件失败');
    }

    return response.data.data;
}

export async function importPickedLocalGalleryFiles(options: Omit<ImportGalleryImagesOptions, 'files'> & { tokens: string[]; deleteOriginal?: boolean }): Promise<ImportLocalPickerResult> {
    let response;
    try {
        response = await api.post<{
            success: boolean;
            data?: ImageItem[];
            deletedOriginalCount?: number;
            deleteOriginalSkippedCount?: number;
            message?: string;
        }>('/gallery/import-picked-local-files', {
            tokens: options.tokens,
            prompt: options.prompt || '外部导入图片',
            apiType: options.apiType || 'other',
            ratio: options.ratio || 'auto',
            quality: options.quality || 'imported',
            tags: options.tags || [],
            deleteOriginal: options.deleteOriginal || false,
        }, {
            timeout: 0,
        });
    } catch (error) {
        if (axios.isAxiosError(error) && error.response?.data?.message) {
            throw new Error(error.response.data.message);
        }
        throw error;
    }

    if (!response.data.success || !response.data.data) {
        throw new Error(response.data.message || '导入失败');
    }

    return {
        images: response.data.data,
        deletedOriginalCount: response.data.deletedOriginalCount || 0,
        deleteOriginalSkippedCount: response.data.deleteOriginalSkippedCount || 0,
    };
}

export async function loadGallery(): Promise<GalleryData> {
    const response = await api.get<{ success: boolean; data: GalleryData }>('/gallery');
    if (response.data.success) {
        return response.data.data;
    }
    throw new Error('Failed to load gallery');
}

// Serialized gallery save queue to prevent concurrent writes from racing
let _gallerySaveQueue: Promise<void> = Promise.resolve();

function queuedSaveToGallery(image: ImageItem): void {
    _gallerySaveQueue = _gallerySaveQueue
        .then(() => api.post('/gallery', image))
        .then(() => {})
        .catch(e => console.error('Failed to save image to gallery:', e));
}

export async function saveToGallery(image: ImageItem): Promise<void> {
    queuedSaveToGallery(image);
}

export async function deleteFromGallery(imageId: string, deleteLocal?: boolean): Promise<void> {
    const params = deleteLocal ? '?delete_local=true' : '';
    await api.delete(`/gallery/${imageId}${params}`);
}

export async function updateGalleryTags(tags: string[]): Promise<void> {
    await api.post('/gallery/tags', { tags });
}
