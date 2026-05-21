from __future__ import annotations

import json
import os
import secrets
import string
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlencode, urljoin

import requests
from requests.adapters import HTTPAdapter

from .exceptions import LumaLabsAPIError, LumaLabsAuthError, LumaLabsConfigError
from .models import LumaLabsAction, LumaLabsArtifact, LumaLabsRealm


DEFAULT_BASE_URL = "https://app.lumalabs.ai"
DEFAULT_CONFIG_PATH = str(Path(__file__).resolve().parents[2] / "config" / "lumalabs_config.json")
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0"
)


class LumaLabsClient:
    def __init__(
        self,
        wos_session: str,
        *,
        team_id: str | None = None,
        default_realm_id: str | None = None,
        base_url: str = DEFAULT_BASE_URL,
        timeout: int = 60,
        session: requests.Session | None = None,
        user_agent: str = DEFAULT_USER_AGENT,
        proxy: str | None = None,
        extra_cookies: dict[str, str] | None = None,
        client_context_id: str = "2d883e57-8f68-4746-b8fb-f58765ae4184",
        client_context_name: str = "web",
        locale: str = "zh-CN",
    ):
        if not wos_session:
            raise LumaLabsConfigError("wos_session is required")

        self.wos_session = self._clean_cookie_value(wos_session)
        self.team_id = team_id
        self.default_realm_id = default_realm_id
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.user_agent = user_agent
        self.client_context_id = client_context_id
        self.client_context_name = client_context_name
        self.locale = locale
        self.session = session or requests.Session()
        self.session.mount("https://", HTTPAdapter(max_retries=0))
        self.session.mount("http://", HTTPAdapter(max_retries=0))
        self.session.cookies.set("wos-session", self.wos_session, domain="app.lumalabs.ai")
        self.session.cookies.set("user-logged-in", "true", domain="app.lumalabs.ai")
        for name, value in (extra_cookies or {}).items():
            self.session.cookies.set(name, value, domain="app.lumalabs.ai")

        self.proxies = {"http": proxy, "https": proxy} if proxy else None

    @classmethod
    def from_env(cls, env_name: str = "LUMALABS_WOS_SESSION", **kwargs: Any) -> "LumaLabsClient":
        return cls(
            os.environ.get(env_name, ""),
            team_id=kwargs.pop("team_id", os.environ.get("LUMALABS_TEAM_ID")),
            default_realm_id=kwargs.pop("default_realm_id", os.environ.get("LUMALABS_REALM_ID")),
            proxy=kwargs.pop("proxy", os.environ.get("LUMALABS_PROXY") or None),
            **kwargs,
        )

    @classmethod
    def from_config(
        cls,
        path: str | os.PathLike[str] = DEFAULT_CONFIG_PATH,
        *,
        label: str | None = None,
        **kwargs: Any,
    ) -> "LumaLabsClient":
        config_path = Path(path)
        if not config_path.exists():
            raise LumaLabsConfigError(f"LumaLabs config not found: {config_path}")

        data = json.loads(config_path.read_text(encoding="utf-8"))
        account = cls._select_account(data, label=label)
        merged = {**data, **account}
        merged.update(kwargs)
        return cls(
            merged.get("wos_session") or merged.get("session") or "",
            team_id=merged.get("team_id"),
            default_realm_id=merged.get("default_realm_id") or merged.get("realm_id"),
            base_url=merged.get("base_url", DEFAULT_BASE_URL),
            timeout=int(merged.get("timeout", 60)),
            proxy=merged.get("proxy") or None,
            extra_cookies=merged.get("extra_cookies") or None,
            user_agent=merged.get("user_agent", DEFAULT_USER_AGENT),
        )

    def headers(
        self,
        *,
        json_content: bool = True,
        referer: str | None = None,
        accept: str = "application/json, text/plain, */*",
    ) -> dict[str, str]:
        headers = {
            "accept": accept,
            "accept-language": f"{self.locale},{self.locale.split('-')[0]};q=0.9,en;q=0.8",
            "origin": self.base_url,
            "referer": referer or f"{self.base_url}/",
            "user-agent": self.user_agent,
            "x-client-capabilities": "retry,upgrade_plan",
            "x-client-context": (
                f"id={self.client_context_id},"
                f"name={self.client_context_name},"
                f"locale={self.locale}"
            ),
        }
        if json_content:
            headers["content-type"] = "application/json"
        return headers

    def request(
        self,
        method: str,
        path: str,
        *,
        json_body: Any | None = None,
        params: dict[str, Any] | None = None,
        referer: str | None = None,
        headers: dict[str, str] | None = None,
        timeout: int | None = None,
    ) -> Any:
        url = path if path.startswith("http://") or path.startswith("https://") else f"{self.base_url}{path}"
        response = self.session.request(
            method,
            url,
            params=params,
            json=json_body,
            headers={**self.headers(json_content=json_body is not None, referer=referer), **(headers or {})},
            timeout=timeout or self.timeout,
            proxies=self.proxies,
        )
        return self._parse_response(response)

    def check_login(self) -> bool:
        self.list_notifications()
        return True

    def list_notifications(self) -> Any:
        return self.request("GET", "/api/vespa/users/notifications")

    def list_realms(
        self,
        *,
        team_id: str | None = None,
        skip: int = 0,
        limit: int = 50,
        ownership: str = "all",
    ) -> Any:
        resolved_team_id = team_id or self.team_id
        if not resolved_team_id:
            raise LumaLabsConfigError("team_id is required for list_realms")
        return self.request(
            "GET",
            f"/api/vespa/teams/{resolved_team_id}/realms",
            params={"skip": skip, "limit": limit, "ownership": ownership},
        )

    def list_boards(self, **kwargs: Any) -> Any:
        return self.list_realms(**kwargs)

    def create_realm(
        self,
        name: str = "Untitled",
        *,
        team_id: str | None = None,
    ) -> LumaLabsRealm:
        resolved_team_id = team_id or self.team_id
        if not resolved_team_id:
            raise LumaLabsConfigError("team_id is required for create_realm")
        data = self.request(
            "POST",
            f"/api/vespa/teams/{resolved_team_id}/realms",
            json_body={"name": name},
            referer=f"{self.base_url}/boards",
        )
        if not isinstance(data, dict):
            raise LumaLabsAPIError(f"unexpected create_realm response: {data!r}")
        return self._realm_from_raw(data)

    def create_board(self, name: str = "Untitled", *, team_id: str | None = None) -> LumaLabsRealm:
        return self.create_realm(name=name, team_id=team_id)

    def list_realm_models(
        self,
        *,
        team_id: str | None = None,
        skip: int = 0,
        limit: int = 50,
        ownership: str = "all",
    ) -> list[LumaLabsRealm]:
        data = self.list_realms(team_id=team_id, skip=skip, limit=limit, ownership=ownership)
        items = self._extract_items(data)
        return [self._realm_from_raw(item) for item in items if isinstance(item, dict)]

    def get_usage(self, *, team_id: str | None = None) -> Any:
        resolved_team_id = team_id or self.team_id
        if not resolved_team_id:
            raise LumaLabsConfigError("team_id is required for get_usage")
        return self.request("GET", f"/api/vespa/teams/{resolved_team_id}/usage")

    def list_members(self, *, team_id: str | None = None) -> Any:
        resolved_team_id = team_id or self.team_id
        if not resolved_team_id:
            raise LumaLabsConfigError("team_id is required for list_members")
        return self.request("GET", f"/api/vespa/teams/{resolved_team_id}/members")

    def get_directives(self, *, team_id: str | None = None) -> Any:
        resolved_team_id = team_id or self.team_id
        if not resolved_team_id:
            raise LumaLabsConfigError("team_id is required for get_directives")
        return self.request("GET", f"/api/vespa/teams/{resolved_team_id}/directives")

    def get_realm_signature(self, *, realm_id: str | None = None) -> Any:
        resolved_realm_id = self._resolve_realm_id(realm_id)
        return self.request(
            "GET",
            f"/api/vespa/realms/{resolved_realm_id}/signature",
            referer=f"{self.base_url}/boards",
        )

    def register_artifact(
        self,
        *,
        realm_id: str | None = None,
        artifact_id: str,
        media_type: str,
        source: str = "upload",
        name: str | None = None,
        width: int | None = None,
        height: int | None = None,
        meta: dict[str, Any] | None = None,
    ) -> LumaLabsArtifact:
        resolved_realm_id = self._resolve_realm_id(realm_id)
        payload_meta = dict(meta or {})
        if width is not None:
            payload_meta["width"] = width
        if height is not None:
            payload_meta["height"] = height
        payload = {
            "type": media_type,
            "id": artifact_id,
            "source": source,
            "name": name or artifact_id,
            "meta": payload_meta,
        }
        data = self.request(
            "POST",
            f"/api/vespa/realms/{resolved_realm_id}/artifacts",
            json_body=payload,
            referer=f"{self.base_url}/board/{resolved_realm_id}",
        )
        return self._artifact_from_raw(data if isinstance(data, dict) else payload, fallback=payload)

    def create_image(
        self,
        prompt: str,
        *,
        realm_id: str | None = None,
        references: Iterable[str] | None = None,
        quality: str = "high",
        resolution: str = "4K",
        aspect_ratio: str = "16:9",
        output_format: str = "png",
        action_type: str = "create_image_gpt_image_2",
        optimistic_output_ids: Iterable[str] | None = None,
        extra_fields: dict[str, Any] | None = None,
    ) -> LumaLabsAction:
        resolved_realm_id = self._resolve_realm_id(realm_id)
        fields = {
            "prompt": prompt,
            "quality": quality,
            "references": list(references or []),
            "resolution": resolution,
            "aspect_ratio": aspect_ratio,
            "output_format": output_format,
        }
        fields.update(extra_fields or {})
        payload = {
            "type": action_type,
            "fields": fields,
            "optimistic_output_ids": list(optimistic_output_ids or [self.generate_optimistic_id()]),
        }
        data = self.request(
            "POST",
            f"/api/vespa/realms/{resolved_realm_id}/actions",
            json_body=payload,
            referer=f"{self.base_url}/board/{resolved_realm_id}",
        )
        return self._action_from_raw(data if isinstance(data, dict) else payload, fallback=payload)

    def create_image_action(self, *args: Any, **kwargs: Any) -> LumaLabsAction:
        return self.create_image(*args, **kwargs)

    def list_actions(self, *, realm_id: str | None = None) -> Any:
        resolved_realm_id = self._resolve_realm_id(realm_id)
        return self.request("GET", f"/api/vespa/realms/{resolved_realm_id}/actions")

    def list_artifacts(self, *, realm_id: str | None = None) -> Any:
        resolved_realm_id = self._resolve_realm_id(realm_id)
        return self.request("GET", f"/api/vespa/realms/{resolved_realm_id}/artifacts")

    def list_artifact_models(self, *, realm_id: str | None = None) -> list[LumaLabsArtifact]:
        data = self.list_artifacts(realm_id=realm_id)
        items = data if isinstance(data, list) else self._extract_items(data)
        return [self._artifact_from_raw(item) for item in items if isinstance(item, dict)]

    def get_artifact(
        self,
        artifact_id: str,
        *,
        realm_id: str | None = None,
    ) -> LumaLabsArtifact:
        for artifact in self.list_artifact_models(realm_id=realm_id):
            if artifact.artifact_id == artifact_id:
                return artifact
        raise LumaLabsAPIError(f"artifact not found: {artifact_id}")

    def build_artifact_url(
        self,
        artifact: LumaLabsArtifact | dict[str, Any] | str,
        *,
        realm_id: str | None = None,
        use_thumbnail: bool = False,
    ) -> str:
        resolved_realm_id = self._resolve_realm_id(realm_id)
        object_ref = self._artifact_object_ref(artifact, use_thumbnail=use_thumbnail)
        if not object_ref:
            raise LumaLabsAPIError("artifact has no object_ref")

        signature = self.get_realm_signature(realm_id=resolved_realm_id)
        if not isinstance(signature, dict):
            raise LumaLabsAPIError(f"unexpected signature response: {signature!r}")

        cdn_url = signature.get("cdn_url")
        if not isinstance(cdn_url, str) or not cdn_url:
            raise LumaLabsAPIError("signature response has no cdn_url")

        url = urljoin(cdn_url.rstrip("/") + "/", object_ref.lstrip("/"))
        query_params = signature.get("query_params")
        if isinstance(query_params, dict) and query_params:
            url = f"{url}?{urlencode(query_params)}"
        elif isinstance(query_params, str) and query_params:
            url = f"{url}?{query_params.lstrip('?')}"
        return url

    def download_artifact(
        self,
        artifact: LumaLabsArtifact | dict[str, Any] | str,
        *,
        realm_id: str | None = None,
        save_dir: str | os.PathLike[str] = "downloads",
        filename: str | None = None,
        use_thumbnail: bool = False,
    ) -> str:
        resolved_realm_id = self._resolve_realm_id(realm_id)
        resolved_artifact = (
            self.get_artifact(artifact, realm_id=resolved_realm_id)
            if isinstance(artifact, str)
            else artifact
        )
        url = self.build_artifact_url(
            resolved_artifact,
            realm_id=resolved_realm_id,
            use_thumbnail=use_thumbnail,
        )
        response = self.session.get(
            url,
            headers=self.headers(json_content=False, referer=f"{self.base_url}/board/{resolved_realm_id}"),
            timeout=self.timeout,
            proxies=self.proxies,
        )
        if response.status_code >= 400:
            raise LumaLabsAPIError(
                f"LumaLabs download error: HTTP {response.status_code}: {self._response_excerpt(response)}"
            )

        output_dir = Path(save_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        output_name = filename or self._artifact_filename(resolved_artifact, response.headers.get("content-type", ""))
        output_path = output_dir / output_name
        output_path.write_bytes(response.content)
        return str(output_path)

    @staticmethod
    def board_url(realm_id: str, *, artifact_id: str | None = None) -> str:
        url = f"{DEFAULT_BASE_URL}/board/{realm_id}"
        if artifact_id:
            url = f"{url}?d={artifact_id}"
        return url

    def get_board_url(self, realm_id: str, *, artifact_id: str | None = None) -> str:
        url = f"{self.base_url}/board/{realm_id}"
        if artifact_id:
            url = f"{url}?d={artifact_id}"
        return url

    def _resolve_realm_id(self, realm_id: str | None) -> str:
        resolved = realm_id or self.default_realm_id
        if not resolved:
            raise LumaLabsConfigError("realm_id is required")
        return resolved

    @staticmethod
    def generate_optimistic_id(length: int = 8) -> str:
        alphabet = string.ascii_letters + string.digits + "-_"
        return "".join(secrets.choice(alphabet) for _ in range(length))

    @staticmethod
    def _clean_cookie_value(value: str) -> str:
        value = value.strip()
        if "wos-session=" in value:
            value = value.split("wos-session=", 1)[1]
        return value.split(";", 1)[0].strip()

    @staticmethod
    def _select_account(data: dict[str, Any], *, label: str | None) -> dict[str, Any]:
        accounts = data.get("accounts")
        if not accounts:
            return data
        if label is None:
            enabled = [account for account in accounts if account.get("enabled", True)]
            if not enabled:
                raise LumaLabsConfigError("no enabled LumaLabs accounts in config")
            return enabled[0]
        for account in accounts:
            if account.get("label") == label:
                return account
        raise LumaLabsConfigError(f"LumaLabs account label not found: {label}")

    @classmethod
    def _parse_response(cls, response: requests.Response) -> Any:
        if response.status_code in {401, 403}:
            raise LumaLabsAuthError(f"LumaLabs auth failed: HTTP {response.status_code}")
        if response.status_code >= 400:
            raise LumaLabsAPIError(
                f"LumaLabs API error: HTTP {response.status_code}: {cls._response_excerpt(response)}"
            )
        if not response.content:
            return None
        content_type = response.headers.get("content-type", "")
        if "application/json" in content_type:
            return response.json()
        try:
            return response.json()
        except ValueError:
            return response.text

    @staticmethod
    def _response_excerpt(response: requests.Response, limit: int = 500) -> str:
        text = response.text or ""
        return text[:limit].replace("\n", " ")

    @staticmethod
    def _extract_items(data: Any) -> list[Any]:
        if isinstance(data, list):
            return data
        if not isinstance(data, dict):
            return []
        for key in ("items", "realms", "boards", "data", "results"):
            value = data.get(key)
            if isinstance(value, list):
                return value
        return []

    @staticmethod
    def _first_string(raw: dict[str, Any], keys: Iterable[str]) -> str | None:
        for key in keys:
            value = raw.get(key)
            if isinstance(value, str) and value:
                return value
        return None

    @classmethod
    def _realm_from_raw(cls, raw: dict[str, Any]) -> LumaLabsRealm:
        return LumaLabsRealm(
            realm_id=cls._first_string(raw, ("id", "realm_id", "realmId", "uuid")),
            title=cls._first_string(raw, ("title", "name", "display_name", "displayName")),
            raw=raw,
        )

    @classmethod
    def _artifact_from_raw(
        cls,
        raw: dict[str, Any],
        *,
        fallback: dict[str, Any] | None = None,
    ) -> LumaLabsArtifact:
        source = {**(fallback or {}), **raw}
        meta = source.get("meta") if isinstance(source.get("meta"), dict) else {}
        return LumaLabsArtifact(
            artifact_id=cls._first_string(source, ("id", "artifact_id", "artifactId")) or "",
            type=cls._first_string(source, ("type", "media_type", "mediaType")),
            source=cls._first_string(source, ("source",)),
            name=cls._first_string(source, ("name", "title")),
            state=cls._first_string(source, ("state", "status")),
            object_ref=cls._first_string(source, ("object_ref", "objectRef", "url")),
            thumbnail_ref=cls._first_string(source, ("thumbnail_ref", "thumbnailRef", "thumbnail_url", "thumbnailUrl")),
            width=cls._to_int(source.get("width") or meta.get("width")),
            height=cls._to_int(source.get("height") or meta.get("height")),
            raw=raw,
        )

    @classmethod
    def _action_from_raw(
        cls,
        raw: dict[str, Any],
        *,
        fallback: dict[str, Any] | None = None,
    ) -> LumaLabsAction:
        action_raw = raw.get("action") if isinstance(raw.get("action"), dict) else {}
        source = {**(fallback or {}), **raw, **action_raw}
        output_ids = source.get("optimistic_output_ids") or source.get("output_ids") or source.get("outputIds") or []
        if not output_ids and isinstance(raw.get("output_artifacts"), list):
            output_ids = [
                item.get("id")
                for item in raw["output_artifacts"]
                if isinstance(item, dict) and item.get("id")
            ]
        if not isinstance(output_ids, list):
            output_ids = []
        return LumaLabsAction(
            action_id=cls._first_string(source, ("id", "action_id", "actionId")),
            type=cls._first_string(source, ("type",)),
            status=cls._first_string(source, ("status", "state")),
            output_ids=[str(item) for item in output_ids],
            raw=raw,
        )

    @staticmethod
    def _to_int(value: Any) -> int | None:
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    @classmethod
    def _artifact_object_ref(
        cls,
        artifact: LumaLabsArtifact | dict[str, Any] | str,
        *,
        use_thumbnail: bool,
    ) -> str | None:
        if isinstance(artifact, str):
            return artifact
        if isinstance(artifact, LumaLabsArtifact):
            return artifact.thumbnail_ref if use_thumbnail else artifact.object_ref
        if isinstance(artifact, dict):
            keys = (
                ("thumbnail_ref", "thumbnailRef", "thumbnail_url", "thumbnailUrl")
                if use_thumbnail
                else ("object_ref", "objectRef", "url")
            )
            return cls._first_string(artifact, keys)
        return None

    @classmethod
    def _artifact_filename(cls, artifact: LumaLabsArtifact | dict[str, Any], content_type: str) -> str:
        if isinstance(artifact, LumaLabsArtifact):
            artifact_id = artifact.artifact_id or "artifact"
            object_ref = artifact.object_ref or ""
            media_type = artifact.type or content_type
        else:
            artifact_id = cls._first_string(artifact, ("id", "artifact_id", "artifactId")) or "artifact"
            object_ref = cls._first_string(artifact, ("object_ref", "objectRef", "url")) or ""
            media_type = cls._first_string(artifact, ("type", "media_type", "mediaType")) or content_type

        ext = Path(object_ref).suffix.lower()
        if not ext:
            if "jpeg" in media_type or "jpg" in media_type:
                ext = ".jpg"
            elif "webp" in media_type:
                ext = ".webp"
            else:
                ext = ".png"
        return f"{cls._safe_filename(artifact_id)}{ext}"

    @staticmethod
    def _safe_filename(value: str) -> str:
        safe = "".join(ch if ch.isalnum() or ch in {"-", "_", "."} else "_" for ch in value)
        return safe.strip("._") or "artifact"
