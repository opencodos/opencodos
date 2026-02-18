import pytest
from fastapi import HTTPException

from backend.connector.routes.context import _resolve_vault_path
from backend.connector.routes.setup import _validate_import_target_folder, _validate_workspace_name


def test_resolve_vault_path_rejects_traversal(tmp_path):
    vault = tmp_path / "vault"
    vault.mkdir()

    with pytest.raises(HTTPException) as exc:
        _resolve_vault_path(vault, "../outside.md")

    assert exc.value.status_code == 400


def test_resolve_vault_path_rejects_absolute_path(tmp_path):
    vault = tmp_path / "vault"
    vault.mkdir()

    with pytest.raises(HTTPException) as exc:
        _resolve_vault_path(vault, "/tmp/secret.md")

    assert exc.value.status_code == 400


def test_resolve_vault_path_accepts_in_vault_path(tmp_path):
    vault = tmp_path / "vault"
    vault.mkdir()

    resolved = _resolve_vault_path(vault, "Core Memory/About me.md")
    assert str(resolved).startswith(str(vault.resolve()))


def test_workspace_name_validation_blocks_path_tokens():
    with pytest.raises(HTTPException) as exc:
        _validate_workspace_name("../bad-name")

    assert exc.value.status_code == 400


def test_import_target_folder_validation():
    assert _validate_import_target_folder("3 - Todos") == "3 - Todos"

    with pytest.raises(ValueError):
        _validate_import_target_folder("../outside")
