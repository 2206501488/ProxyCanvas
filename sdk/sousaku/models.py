from dataclasses import dataclass, field
from typing import Any


@dataclass
class SousakuModelConfig:
    model: str
    credits_per_image: int
    label: str | None = None


@dataclass
class SousakuUserProfile:
    user_id: str | None
    user_name: str | None
    nick_name: str | None
    user_email: str | None
    share_code: str | None
    inviter_share_code: str | None
    inviter_share_code_status: int | None
    total_credit: int | None
    subscription_credit: int | None
    permanent_credit: int | None
    package_level: str | None
    running_task_count: int | None
    complete_pending_claim_num: int | None
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class SousakuImage:
    url: str
    saved_path: str | None = None
    width: int | None = None
    height: int | None = None
    thumbnail_url: str | None = None
    attachment_url: str | None = None
    file_id: str | None = None
    content_id: str | None = None
    status: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class SousakuTask:
    task_id: str
    status: str
    progress: Any = None
    images: list[SousakuImage] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def is_success(self) -> bool:
        return self.status.lower() in {"success", "completed", "complete", "done", "succeeded", "3", "4"}

    @property
    def is_failed(self) -> bool:
        return self.status.lower() in {"failed", "failure", "error", "canceled", "cancelled", "-1", "-2"}
