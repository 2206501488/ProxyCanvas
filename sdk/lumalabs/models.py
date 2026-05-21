from dataclasses import dataclass, field
from typing import Any


@dataclass
class LumaLabsRealm:
    realm_id: str | None
    title: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class LumaLabsArtifact:
    artifact_id: str
    type: str | None = None
    source: str | None = None
    name: str | None = None
    state: str | None = None
    object_ref: str | None = None
    thumbnail_ref: str | None = None
    width: int | None = None
    height: int | None = None
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class LumaLabsAction:
    action_id: str | None
    type: str | None = None
    status: str | None = None
    output_ids: list[str] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)
