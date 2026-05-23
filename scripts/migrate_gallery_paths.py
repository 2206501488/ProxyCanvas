from __future__ import annotations

import argparse
import os
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB_PATH = PROJECT_ROOT / "data" / "gallery.sqlite"


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Convert legacy absolute gallery image paths to paths relative to "
            "OPENAI_SAVE_DIR. Runs in dry-run mode unless --apply is passed."
        )
    )
    parser.add_argument("--old-save-dir", required=True, help="Old OPENAI_SAVE_DIR used by existing absolute paths.")
    parser.add_argument("--new-save-dir", required=True, help="Current/new OPENAI_SAVE_DIR used after migration.")
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH), help=f"Gallery SQLite path. Default: {DEFAULT_DB_PATH}")
    parser.add_argument("--apply", action="store_true", help="Write changes to the database.")
    parser.add_argument("--no-backup", action="store_true", help="Do not create a .bak copy before --apply.")
    parser.add_argument(
        "--keep-saved-file-path",
        action="store_true",
        help="Keep saved_file_path instead of clearing it after relative_path is set.",
    )
    args = parser.parse_args()

    db_path = Path(args.db).resolve()
    old_save_dir = Path(args.old_save_dir).resolve()
    new_save_dir = Path(args.new_save_dir).resolve()

    if not db_path.exists():
        raise SystemExit(f"Database not found: {db_path}")

    if args.apply and not args.no_backup:
        backup_path = _backup_database(db_path)
        print(f"Backup: {backup_path}")

    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        _ensure_relative_path_column(connection)
        result = migrate_gallery_paths(
            connection,
            old_save_dir=old_save_dir,
            new_save_dir=new_save_dir,
            apply=args.apply,
            clear_saved_file_path=not args.keep_saved_file_path,
        )
        if args.apply:
            connection.commit()
        else:
            connection.rollback()

    _print_result(result, apply=args.apply)
    return 0


def migrate_gallery_paths(
    connection: sqlite3.Connection,
    *,
    old_save_dir: Path,
    new_save_dir: Path,
    apply: bool,
    clear_saved_file_path: bool,
) -> dict[str, int]:
    rows = connection.execute(
        """
        SELECT id, local_path, saved_file_path, relative_path, thumbnail
        FROM gallery_images
        ORDER BY created_at DESC, id ASC
        """
    ).fetchall()

    stats = {
        "total": len(rows),
        "updated": 0,
        "unchanged": 0,
        "skipped": 0,
        "missing_in_new_dir": 0,
        "already_relative": 0,
    }

    for row in rows:
        migration = _migration_for_row(row, old_save_dir=old_save_dir, new_save_dir=new_save_dir)
        if not migration:
            stats["skipped"] += 1
            print(f"SKIP  {row['id']}: no path under old/new OPENAI_SAVE_DIR")
            continue

        relative_path = migration["relative_path"]
        serve_url = _serve_url(relative_path)
        thumbnail = row["thumbnail"]
        next_thumbnail = serve_url if _should_replace_thumbnail(thumbnail) else thumbnail
        next_saved_file_path = None if clear_saved_file_path else row["saved_file_path"]

        if migration["already_relative"]:
            stats["already_relative"] += 1
        if not (new_save_dir / Path(relative_path)).exists():
            stats["missing_in_new_dir"] += 1

        changed = (
            row["relative_path"] != relative_path
            or row["local_path"] != serve_url
            or row["thumbnail"] != next_thumbnail
            or row["saved_file_path"] != next_saved_file_path
        )
        if not changed:
            stats["unchanged"] += 1
            continue

        stats["updated"] += 1
        print(f"UPDATE {row['id']}: {relative_path}")
        if apply:
            connection.execute(
                """
                UPDATE gallery_images
                SET relative_path = ?,
                    local_path = ?,
                    thumbnail = ?,
                    saved_file_path = ?
                WHERE id = ?
                """,
                (relative_path, serve_url, next_thumbnail, next_saved_file_path, row["id"]),
            )

    return stats


def _migration_for_row(row: sqlite3.Row, *, old_save_dir: Path, new_save_dir: Path) -> dict[str, object] | None:
    existing_relative = _clean_relative_path(row["relative_path"])
    if existing_relative:
        return {"relative_path": existing_relative, "already_relative": True}

    for value in (row["saved_file_path"], _path_from_serve_url(row["local_path"]), _path_from_serve_url(row["thumbnail"])):
        if not value:
            continue

        relative = _relative_from_any_path(value, old_save_dir=old_save_dir, new_save_dir=new_save_dir)
        if relative:
            return {"relative_path": relative, "already_relative": False}

    return None


def _relative_from_any_path(value: str, *, old_save_dir: Path, new_save_dir: Path) -> str | None:
    relative = _clean_relative_path(value)
    if relative:
        return relative

    path = Path(value)
    if not path.is_absolute():
        return None

    for root in (old_save_dir, new_save_dir):
        relative = _relative_to_root(path, root)
        if relative:
            return relative
    return None


def _relative_to_root(path: Path, root: Path) -> str | None:
    resolved_path = path.resolve()
    resolved_root = root.resolve()
    try:
        return resolved_path.relative_to(resolved_root).as_posix()
    except ValueError:
        pass

    path_text = os.path.normcase(str(resolved_path))
    root_text = os.path.normcase(str(resolved_root))
    try:
        common = os.path.commonpath([path_text, root_text])
    except ValueError:
        return None
    if common != root_text:
        return None
    return Path(os.path.relpath(resolved_path, resolved_root)).as_posix()


def _path_from_serve_url(value: str | None) -> str | None:
    if not value or "/api/serve-image" not in value:
        return None
    parsed = urlparse(value)
    raw_path = parse_qs(parsed.query).get("path", [None])[0]
    return unquote(raw_path) if raw_path else None


def _clean_relative_path(value: str | None) -> str | None:
    if not value:
        return None
    text = str(value).replace("\\", "/").strip()
    if not text:
        return None
    parsed = urlparse(text)
    if parsed.scheme and parsed.scheme.lower() not in {"", "file"}:
        return None
    path = Path(text)
    first_part = text.split("/", 1)[0]
    if ":" in first_part:
        return None
    if path.is_absolute() or text.startswith("../") or "/../" in text or text == "..":
        return None
    return path.as_posix()


def _serve_url(relative_path: str) -> str:
    return f"/api/serve-image?path={quote(relative_path, safe='')}"


def _should_replace_thumbnail(value: str | None) -> bool:
    return not value or "/api/serve-image" in value


def _ensure_relative_path_column(connection: sqlite3.Connection) -> None:
    columns = {row["name"] for row in connection.execute("PRAGMA table_info(gallery_images)").fetchall()}
    if "relative_path" not in columns:
        connection.execute("ALTER TABLE gallery_images ADD COLUMN relative_path TEXT")


def _backup_database(db_path: Path) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = db_path.with_name(f"{db_path.name}.{timestamp}.bak")
    shutil.copy2(db_path, backup_path)
    for suffix in ("-wal", "-shm"):
        sidecar = Path(f"{db_path}{suffix}")
        if sidecar.exists():
            shutil.copy2(sidecar, Path(f"{backup_path}{suffix}"))
    return backup_path


def _print_result(result: dict[str, int], *, apply: bool) -> None:
    mode = "APPLY" if apply else "DRY RUN"
    print("")
    print(f"Mode: {mode}")
    for key in ("total", "updated", "unchanged", "skipped", "already_relative", "missing_in_new_dir"):
        print(f"{key}: {result[key]}")
    if not apply:
        print("")
        print("No database changes were written. Re-run with --apply to migrate.")


if __name__ == "__main__":
    raise SystemExit(main())
