# ApiMart V2: AI Image Generation Client

A modern, local-first web interface for generating high-quality images using OpenAI and APIMart APIs. Built with React, TypeScript, and Python.

## ✨ Features

- **Dual API Support**: Seamlessly switch between OpenAI and APIMart models.
- **Unified Generation Logic**: Consistent handling for both synchronous (OpenAI) and asynchronous (APIMart) generation flows.
- **Modern UI/UX**:
  - Sleek Dark Theme & Glassmorphism design.
  - **Masonry Gallery** layout for browsing generated images.
  - **Expandable Prompt Input** with smooth animations.
- **Local-First Architecture**:
  - Images are saved directly to your local disk (backend server).
  - Metadata (Prompts, Tags, Favorites) stored in Browser LocalStorage.
  - "Open in Folder" button to quickly locate files.
- **Image Management**:
  - **Favorites**: Mark your best creations.
  - **Tags**: Organize images with custom tags.
  - **Date Filter**: Browse history by date.
- **Advanced Generation**:
  - Support for Reference Images (Image-to-Image).
  - Adjustable Aspect Ratios (1:1, 16:9, etc.) and Resolutions (1K/2K/4K).

## 🚀 Quick Start

### Prerequisites
- Node.js (v16+)
- Python (3.8+)
- API Keys for OpenAI or APIMart

### 1. Backend Setup
The backend handles API requests and file storage.

```bash
cd backend
# Create virtual environment (optional)
python -m venv venv
# Install dependencies
pip install flask requests openai pillow
# Run server
python app.py
```
Server runs on: `http://localhost:5050`

### 2. Frontend Setup
The user interface.

```bash
cd frontend_v2
# Install dependencies
npm install
# Start development server
npm run dev
```
Access at: `http://localhost:5173`

## ⚙️ Configuration

### Backend
Check `backend/config.py` (or environment variables) to set your API keys and storage paths:
- `OPENAI_API_KEY`: Your API Key.
- `OPENAI_API_BASE`: API Base URL.
- `OPENAI_SAVE_DIR`: Where images are saved (Default: `F:/AI_Images`).

### Frontend
- **API Settings**: Configurable via the UI Settings panel.
- **Storage**: Cleared via Browser DevTools (Application -> LocalStorage).

## ⚠️ Lessons Learned: APIMart Integration Pitfalls

This section documents critical issues encountered during APIMart API integration. **Read carefully to avoid repeating these mistakes!**

### 1. 两个端点返回不同的 `data` 类型

| 端点 | 响应中的 `data` 类型 | 示例 |
|------|---------------------|------|
| `POST /v1/images/generations` (生成) | **数组** | `{"data": [{"task_id": "xxx"}]}` |
| `GET /v1/tasks/{id}` (查询) | **对象** | `{"data": {"status": "completed"}}` |

**坑点**: 代码用 `data[0].status` 处理所有情况，导致任务查询时读不到状态。

**解决**: 使用类型检查：
```python
if isinstance(data, list):
    data = data[0] if len(data) > 0 else {}
```

---

### 2. 图片 URL 是数组而非字符串

APIMart 返回：
```json
{"result": {"images": [{"url": ["https://..."], "expires_at": 123}]}}
```

**坑点**: `images[0].url` 是 **数组**，不是字符串！直接使用会报错。

**解决**:
```python
url_data = img_obj.get('url')
if isinstance(url_data, list) and len(url_data) > 0:
    image_url = url_data[0]
elif isinstance(url_data, str):
    image_url = url_data
```

---

### 3. 轮询状态检查不完整

**坑点**: 只检查 `status === 'completed'`，但 APIMart 还有 `pending`、`processing` 等中间状态，需要继续轮询。

**解决**: 使用大小写不敏感的比较，并处理所有终态：
```typescript
const statusLower = status?.toLowerCase();
if (statusLower === 'completed') return result;
if (statusLower === 'failed') throw new Error('...');
// 其他状态继续轮询
```

---

### 4. LocalStorage 配额溢出

**坑点**: 将 Base64 图片数据存入 LocalStorage，单张 4K 图超过 5MB 限制。

**解决**: 在 Zustand persist 的 `partialize` 中过滤大字段：
```typescript
partialize: (state) => ({
  ...state,
  images: state.images.map(img => ({
    ...img,
    thumbnail: img.thumbnail?.startsWith('data:') ? '' : img.thumbnail,
    originalUrl: img.originalUrl?.startsWith('data:') ? '' : img.originalUrl,
  }))
})
```

---

### 5. 本地图片刷新后丢失

**坑点**: 使用临时 Base64 URL 显示图片，刷新后数据丢失。

**解决**: 
1. 后端保存图片到本地并返回 `saved_path`
2. 前端使用 `/api/serve-image?path=xxx` 持久化 URL
3. 存储真实路径 `savedFilePath` 用于"打开目录"功能

---

### 6. 缺少防御性错误处理

**坑点**: 假设 API 总是返回预期格式，任何异常都导致 500 崩溃。

**解决**: 添加多层防御：
```python
# 1. HTTP 状态检查
if response.status_code != 200:
    return error_response

# 2. API 错误检查
if 'error' in result:
    return error_response

# 3. 数据类型检查
if data is None:
    data = {}
elif isinstance(data, list):
    data = data[0] if data else {}
```

---

## 📝 Changelog

### v2.2 (Current) - APIMart Integration Fixes
- **Fix**: Corrected `data` type handling (array vs object) for different APIMart endpoints.
- **Fix**: Handled `images[0].url` being an array instead of string.
- **Fix**: Added comprehensive defensive error handling to prevent 500 crashes.
- **Feature**: APIMart images now auto-download and save locally, with persistent URLs.
- **Improvement**: Added detailed debug logging for task status polling.

### v2.1 - API Extensibility & Stability
- **New Feature**: Added "Open Folder" button in Image Viewer.
- **Improvement**: Unified `handleGenerationResponse` logic in frontend to support any API returning either direct URLs or Async Task IDs.
- **Fix**: Resolved APIMart generation failure caused by nested `task_id` structure.
- **Fix**: Fixed "double base64 prefix" bug where OpenAI images displayed as broken icons due to duplicate `data:` prefixes.
- **Fix**: Implemented Base64 fallback for image uploads when hosting service fails.
- **Optimization**: Stripped Base64 data from LocalStorage to prevent quota exceeded errors.

### v2.0 - Initial V2 Release
- Complete UI Rewrite using React & Tailwind.
- Introduced Masonry Gallery layout.
- Added Tags and Favorites system.
