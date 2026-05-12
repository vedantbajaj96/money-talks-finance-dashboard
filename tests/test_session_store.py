"""
Unit tests for _SessionStore — the file-backed session persistence layer in core/auth.py.
"""
import datetime
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.auth import _SessionStore


class TestSessionStore:
    def _store(self, tmp_path: Path) -> _SessionStore:
        return _SessionStore(tmp_path / "sessions.json")

    def test_empty_on_fresh_path(self, tmp_path):
        store = self._store(tmp_path)
        assert store.get("nonexistent") is None

    def test_set_and_get(self, tmp_path):
        store   = self._store(tmp_path)
        expires = datetime.datetime.utcnow() + datetime.timedelta(days=7)
        store["tok1"] = {"username": "alice", "is_admin": False, "expires": expires}
        assert store.get("tok1")["username"] == "alice"

    def test_persists_to_disk(self, tmp_path):
        expires = datetime.datetime.utcnow() + datetime.timedelta(days=7)
        store1  = self._store(tmp_path)
        store1["tok1"] = {"username": "alice", "is_admin": False, "expires": expires}

        store2  = self._store(tmp_path)
        session = store2.get("tok1")
        assert session is not None
        assert session["username"] == "alice"

    def test_expires_survives_round_trip(self, tmp_path):
        expires = datetime.datetime(2030, 6, 15, 12, 0, 0)
        store1  = self._store(tmp_path)
        store1["tok1"] = {"username": "bob", "is_admin": True, "expires": expires}

        store2         = self._store(tmp_path)
        loaded_expires = store2.get("tok1")["expires"]
        assert isinstance(loaded_expires, datetime.datetime)
        assert loaded_expires == expires

    def test_delete_removes_entry(self, tmp_path):
        store   = self._store(tmp_path)
        expires = datetime.datetime.utcnow() + datetime.timedelta(days=1)
        store["tok1"] = {"username": "carol", "is_admin": False, "expires": expires}
        del store["tok1"]
        assert store.get("tok1") is None

    def test_delete_persisted(self, tmp_path):
        expires = datetime.datetime.utcnow() + datetime.timedelta(days=1)
        store1  = self._store(tmp_path)
        store1["tok1"] = {"username": "dave", "is_admin": False, "expires": expires}
        del store1["tok1"]

        store2 = self._store(tmp_path)
        assert store2.get("tok1") is None

    def test_contains(self, tmp_path):
        store   = self._store(tmp_path)
        expires = datetime.datetime.utcnow() + datetime.timedelta(days=1)
        store["tok1"] = {"username": "eve", "is_admin": False, "expires": expires}
        assert "tok1" in store
        assert "tok999" not in store

    def test_items(self, tmp_path):
        store   = self._store(tmp_path)
        expires = datetime.datetime.utcnow() + datetime.timedelta(days=1)
        store["t1"] = {"username": "a", "is_admin": False, "expires": expires}
        store["t2"] = {"username": "b", "is_admin": True,  "expires": expires}
        tokens = {t for t, _ in store.items()}
        assert tokens == {"t1", "t2"}

    def test_corrupt_file_gives_empty_store(self, tmp_path):
        f = tmp_path / "sessions.json"
        f.write_text("not valid json{{{{")
        store = self._store(tmp_path)
        assert store.get("anything") is None

    def test_delete_nonexistent_does_not_raise(self, tmp_path):
        store = self._store(tmp_path)
        del store["ghost"]  # should not raise
