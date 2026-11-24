#!/usr/bin/env python3
"""Make a private, consistent SQLite snapshot and a D1 data-only import.

Run locally on the PVE host/container with a safe output destination.
Never upload the snapshot or SQL file to GitHub/CI or paste it into chat.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3

TABLES = (
    "users", "calendars", "source_identities", "calendar_tokens", "devices",
    "events", "event_aliases", "sync_runs", "invitations", "pairing_codes",
    "sessions", "audit_logs",
)
SCHEMA = Path(__file__).resolve().parent.parent / "migrations" / "0001_schema.sql"


def ident(name):
    return '"' + name.replace('"', '""') + '"'


def literal(v):
    if v is None:
        return "NULL"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        raise ValueError("Unexpected floating-point value in migrated schema")
    if isinstance(v, str):
        # Preserve all UTF-8 bytes, including quotes and NULs.
        return "CAST(X'" + v.encode("utf-8").hex() + "' AS TEXT)"
    if isinstance(v, bytes):
        return "X'" + v.hex() + "'"
    raise TypeError("Unsupported value type")


def columns(db, table):
    return [r[1] for r in db.execute("PRAGMA table_info(" + ident(table) + ")")]


def integrity(db):
    if db.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
        raise ValueError("Database integrity check failed")
    if db.execute("PRAGMA foreign_key_check").fetchone():
        raise ValueError("Foreign-key check failed")


def row_digest(db, table, cols):
    # Sort on every column for a deterministic, order-independent digest.
    names = ", ".join(ident(c) for c in cols)
    h = hashlib.sha256()
    count = 0
    for row in db.execute("SELECT " + names + " FROM " + ident(table) + " ORDER BY " + names):
        # SQL literal representation distinguishes text, integers, bytes and NULL.
        h.update(json.dumps([literal(v) for v in row], separators=(",", ":")).encode())
        h.update(b"\n")
        count += 1
    return {"count": count, "sha256": h.hexdigest()}


def run(source, out):
    if not source.is_file():
        raise FileNotFoundError("Source database not found")
    os.umask(0o077)
    # A new private directory avoids overwrites and accidental public permissions.
    out.mkdir(mode=0o700, parents=False, exist_ok=False)
    snapshot = out / "snapshot.sqlite3"
    with sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True) as src:
        with sqlite3.connect(snapshot) as dest:
            src.backup(dest)
    os.chmod(snapshot, 0o600)
    manifest = {}
    # Use exactly the shipped target schema and rehearse every INSERT locally.
    with sqlite3.connect(snapshot.resolve().as_uri() + "?mode=ro", uri=True) as snap:
        integrity(snap)
        with sqlite3.connect(":memory:") as target:
            target.execute("PRAGMA foreign_keys=ON")
            target.executescript(SCHEMA.read_text(encoding="utf-8"))
            with (out / "d1-data.sql").open("x", encoding="utf-8") as sql:
                for table in TABLES:
                    src_cols, dst_cols = columns(snap, table), columns(target, table)
                    if not src_cols or set(src_cols) != set(dst_cols):
                        raise ValueError("Column mismatch: " + table)
                    names = ", ".join(ident(c) for c in dst_cols)
                    for row in snap.execute("SELECT " + names + " FROM " + ident(table)):
                        stmt = "INSERT INTO " + ident(table) + " (" + names + ") VALUES (" + ", ".join(literal(v) for v in row) + ");"
                        if len(stmt.encode("utf-8")) > 90000:
                            raise ValueError("Oversized import statement: " + table)
                        target.execute(stmt)
                        sql.write(stmt + "\n")
                    expected = row_digest(snap, table, dst_cols)
                    actual = row_digest(target, table, dst_cols)
                    if actual != expected:
                        raise ValueError("Data parity mismatch: " + table)
                    manifest[table] = expected
            integrity(target)
    (out / "manifest.json").write_text(json.dumps({"format": 1, "tables": manifest}, indent=2) + "\n")
    print("LOCAL_SNAPSHOT_AND_REHEARSAL: PASS")
    print(json.dumps({k: v["count"] for k, v in manifest.items()}, sort_keys=True))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path, help="New private directory; must not exist")
    args = parser.parse_args()
    try:
        run(args.source, args.output)
    except Exception as exc:
        # Do not print database contents, statements, credentials or private paths.
        raise SystemExit("EXPORT_FAILED: " + type(exc).__name__) from None
