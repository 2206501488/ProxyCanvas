# Sousaku SDK

Minimal Python SDK for the private Sousaku image generation API captured from `https://sousaku.ai/`.

## Token

Recommended: copy `sousaku_config.example.json` to `sousaku_config.json` and edit it:

```json
{
  "tokens": ["token_a", "token_b"],
  "save_dir": "F:\\BaiduNetdiskDownload\\api_tmp",
  "accounts_path": "sousaku_accounts.json",
  "model_credits": {
    "medium": 4,
    "high": 13
  },
  "timeout": 30,
  "generation_timeout": 1200,
  "poll_interval": 3
}
```

Then:

```python
from sdk.sousaku import SousakuClient

client = SousakuClient.from_config()
```

Use one token:

```powershell
$env:SOUSAKU_TOKEN="token_a"
```

Use multiple tokens. The SDK rotates to the next token when the current one receives `401` or `403`:

```powershell
$env:SOUSAKU_TOKEN="token_a,token_b,token_c"
```

Optional model credit config. Useful when campaign pricing changes:

```powershell
$env:SOUSAKU_MODEL_CREDITS="gpt-image-2-low=2,gpt-image-2=4,gpt-image-2-high=13,wan-image-2.7-pro=2,mj-image-v7=2,mj-image-niji-7=2"
$env:SOUSAKU_SAVE_DIR="F:\BaiduNetdiskDownload\api_tmp"
```

Or configure in code:

```python
client = SousakuClient(
    tokens=["token_a", "token_b"],
    model_configs={
        "medium": 4,
        "high": 13,
    },
)
client.set_model_config("high", credits_per_image=20)
```

## Text to Image

```python
from sdk.sousaku import SousakuClient

client = SousakuClient.from_env()
profile = client.get_user_profile()
print(profile.nick_name, profile.total_credit, profile.share_code)

images = client.generate_sync(
    "1girl, solo, masterpiece, best quality",
    model="gpt-image-2",  # alias: "medium"
    resolution="4k",
    ratio="1:1",
    number=1,
)

for image in images:
    print(image.url, image.saved_path)
```

## Image to Image

```python
from sdk.sousaku import SousakuClient

client = SousakuClient(tokens=["token_a", "token_b"])
refs = client.upload_reference_images([
    r"C:\path\to\ref1.jpg",
    r"C:\path\to\ref2.png",
])

task_id = client.create_image(
    "Based on the references, create a cinematic anime image.",
    model="medium",
    ratio="1:1",
    number=4,
    reference_images=refs,
)
task = client.wait_for_task(task_id)

for image in task.images:
    print(image.url)
```

## User and History

```python
from sdk.sousaku import SousakuClient

client = SousakuClient.from_env()

user = client.get_user()
print(user["nick_name"], user["subscription"]["total_credit"])

profile = client.get_user_profile()
print(profile.share_code, profile.inviter_share_code, profile.complete_pending_claim_num)

client.save_user_profile("accounts/current_user.json")

# Save every configured token/account into a local multi-account index.
client.save_account_records()

tasks = client.list_history_tasks(page=1, page_size=15)
for task in tasks:
    print(task.task_id, task.status, len(task.images))
    for image in task.images:
        print(" ", image.url, image.width, image.height)
```

## Batch Task Status

```python
tasks = client.get_task_statuses([
    "bd9ec53374e64a65a976bb72b3a5c53e",
    "d562ddeeb93f408394d4ef40e23fc190",
])

for task in tasks:
    print(task.task_id, task.status, task.progress)
    # A running task may already contain partial succeeded images.
    for image in task.images:
        print(image.url)
```

## Notes

The response parser intentionally keeps `raw` data on `SousakuTask` and `SousakuImage`. Sousaku is not a public stable API, so real captured responses are useful for tightening status codes, result fields, model names, and credit rules.

Known image models from current captures:

| UI label | API model | Credits |
| --- | --- | --- |
| GPT Image 2.0 Low | `gpt-image-2-low` | 2 / image |
| GPT Image 2.0 Medium | `gpt-image-2` | 4 / image (configurable) |
| GPT Image 2.0 High | `gpt-image-2-high` | 13 / image (configurable) |
| WAN Image 2.7 Pro | `wan-image-2.7-pro` | 2 / image |
| Midjourney V7 | `mj-image-v7` | fixed 4 images, 8 total |
| Midjourney Niji 7 | `mj-image-niji-7` | fixed 4 images, 8 total |
