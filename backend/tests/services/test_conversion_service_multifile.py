"""Tests for multi-file output packaging in run_conversion_service.

Multi-page PDF -> image conversions now return one file per page; the
service layer packages multi-file results into a single ZIP so the rest
of the pipeline keeps a one-record-per-conversion contract.
"""
from __future__ import annotations

import errno
from pathlib import Path
from unittest.mock import MagicMock
from uuid import uuid4
from zipfile import ZipFile

import pytest

from services import conversion_service


class _FakeConverter:
    """Pluggable converter stub that writes pre-defined files."""

    payloads: list[tuple[str, bytes]] = []

    def __init__(self, input_file, output_dir, input_type, output_type):
        self.output_dir = Path(output_dir)

    def convert(self, quality=None):
        # Legacy service unit fixture owns its temporary workspace. The client-only
        # server deliberately does not create file-processing directories.
        self.output_dir.mkdir(parents=True, exist_ok=True)
        out: list[str] = []
        for name, data in self._payloads:
            target = self.output_dir / name
            target.write_bytes(data)
            out.append(str(target))
        return out


def _make_converter(payloads: list[tuple[str, bytes]]):
    return type(
        "ConfiguredFakeConverter",
        (_FakeConverter,),
        {"_payloads": payloads},
    )


def _source_metadata(upload_dir: Path) -> dict:
    src = upload_dir / f"{uuid4().hex}.pdf"
    src.write_bytes(b"%PDF-fake")
    return {
        "id": "src-id",
        "user_id": "user-a",
        "media_type": "pdf",
        "extension": ".pdf",
        "size_bytes": src.stat().st_size,
        "original_filename": "report.pdf",
        "storage_path": str(src),
    }


@pytest.fixture(autouse=True)
def legacy_workspace(safe_path_test_settings, monkeypatch):
    """Legacy service tests use explicit fixture-owned file storage, never app startup."""
    safe_path_test_settings.tmp_dir.mkdir(parents=True, exist_ok=True)
    safe_path_test_settings.output_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(conversion_service, "get_settings", lambda: safe_path_test_settings)


@pytest.fixture
def fake_dbs():
    conversion_db = MagicMock()
    conversion_relations_db = MagicMock()
    file_db = MagicMock()
    settings_db = MagicMock()
    settings_db.get_settings.return_value = {"keep_originals": True}
    return file_db, conversion_db, conversion_relations_db, settings_db


def test_single_output_keeps_format_and_extension(safe_path_test_settings, fake_dbs):
    file_db, conversion_db, conversion_relations_db, settings_db = fake_dbs
    src_meta = _source_metadata(safe_path_test_settings.upload_dir)
    converter_cls = _make_converter([("page-001.png", b"\x89PNG-1")])

    result = conversion_service.run_conversion_job(
        source_metadata=src_meta,
        output_format="png",
        quality=None,
        converter_type=converter_cls,
        user_id="user-a",
        file_db=file_db,
        conversion_db=conversion_db,
        conversion_relations_db=conversion_relations_db,
        settings_db=settings_db,
    )

    assert result["media_type"] == "png"
    assert result["extension"] == ".png"
    out_path = Path(result["storage_path"])
    assert out_path.exists()
    assert out_path.suffix == ".png"
    assert out_path.read_bytes() == b"\x89PNG-1"


def test_single_output_falls_back_when_rename_crosses_devices(
    safe_path_test_settings, fake_dbs, monkeypatch
):
    file_db, conversion_db, conversion_relations_db, settings_db = fake_dbs
    src_meta = _source_metadata(safe_path_test_settings.upload_dir)
    converter_cls = _make_converter([("page-001.png", b"\x89PNG-1")])
    original_rename = Path.rename

    def fake_rename(self, target):
        if self.parent == safe_path_test_settings.tmp_dir:
            raise OSError(errno.EXDEV, "Invalid cross-device link")
        return original_rename(self, target)

    monkeypatch.setattr(Path, "rename", fake_rename)

    result = conversion_service.run_conversion_job(
        source_metadata=src_meta,
        output_format="png",
        quality=None,
        converter_type=converter_cls,
        user_id="user-a",
        file_db=file_db,
        conversion_db=conversion_db,
        conversion_relations_db=conversion_relations_db,
        settings_db=settings_db,
    )

    out_path = Path(result["storage_path"])
    assert out_path.exists()
    assert out_path.suffix == ".png"
    assert out_path.read_bytes() == b"\x89PNG-1"
    assert not (safe_path_test_settings.tmp_dir / "page-001.png").exists()


def test_multi_output_is_packaged_as_zip(safe_path_test_settings, fake_dbs):
    file_db, conversion_db, conversion_relations_db, settings_db = fake_dbs
    src_meta = _source_metadata(safe_path_test_settings.upload_dir)
    payloads = [
        ("abc123-page-001.png", b"page-1-bytes"),
        ("abc123-page-002.png", b"page-2-bytes"),
        ("abc123-page-003.png", b"page-3-bytes"),
    ]
    converter_cls = _make_converter(payloads)

    result = conversion_service.run_conversion_job(
        source_metadata=src_meta,
        output_format="png",
        quality=None,
        converter_type=converter_cls,
        user_id="user-a",
        file_db=file_db,
        conversion_db=conversion_db,
        conversion_relations_db=conversion_relations_db,
        settings_db=settings_db,
    )

    assert result["media_type"] == "zip"
    assert result["extension"] == ".zip"
    out_path = Path(result["storage_path"])
    assert out_path.exists()
    assert out_path.suffix == ".zip"

    with ZipFile(out_path) as zf:
        names = sorted(zf.namelist())
        # Entries should use the original uploaded filename stem, not the
        # UUID-based temp stem.
        assert names == [
            "report-page-001.png",
            "report-page-002.png",
            "report-page-003.png",
        ]
        assert zf.read("report-page-002.png") == b"page-2-bytes"

    # Per-page temp files should be cleaned up after packaging.
    for name, _ in payloads:
        assert not (safe_path_test_settings.tmp_dir / name).exists()


def test_empty_output_raises(safe_path_test_settings, fake_dbs):
    file_db, conversion_db, conversion_relations_db, settings_db = fake_dbs
    src_meta = _source_metadata(safe_path_test_settings.upload_dir)
    converter_cls = _make_converter([])

    with pytest.raises(conversion_service.ConversionFailedError):
        conversion_service.run_conversion_job(
            source_metadata=src_meta,
            output_format="png",
            quality=None,
            converter_type=converter_cls,
            user_id="user-a",
            file_db=file_db,
            conversion_db=conversion_db,
            conversion_relations_db=conversion_relations_db,
            settings_db=settings_db,
        )
