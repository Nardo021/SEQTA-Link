"""Single synthetic migration smoke; no production data."""
import pathlib
import sqlite3
import tempfile
from export_sqlite import SCHEMA, run

with tempfile.TemporaryDirectory() as tmp:
    root = pathlib.Path(tmp)
    db = root / "source.sqlite3"
    stamp = "2026-11-24 00:00:00.000000"
    with sqlite3.connect(db) as c:
        c.execute("PRAGMA foreign_keys=ON")
        c.executescript(SCHEMA.read_text())
        c.execute("INSERT INTO users(id,display_name,created_at,updated_at) VALUES (?,?,?,?)", ("u", "Synthetic 学生 ' \x00", stamp, stamp))
        c.execute("INSERT INTO calendars(id,owner_user_id,name,created_at,updated_at) VALUES (?,?,?,?,?)", ("c","u","Synthetic timetable",stamp,stamp))
        c.execute("INSERT INTO calendar_tokens(id,calendar_id,token_hash,token_prefix,created_at) VALUES (?,?,?,?,?)", ("t","c","0"*64,"sl_cal_test",stamp))
        c.execute("INSERT INTO devices(id,owner_user_id,calendar_id,name,token_hash,token_prefix,created_at) VALUES (?,?,?,?,?,?,?)", ("d","u","c","Fixture","1"*64,"sl_dvc_test",stamp))
        c.execute("INSERT INTO events(id,owner_user_id,calendar_id,natural_key,ical_uid,local_date,period_key,title,starts_at_utc,ends_at_utc,timezone,content_hash,sequence,status,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", ("e","u","c","2"*64,"fixture@seqta.link","2026-11-24","period-1","Music","2026-11-23T22:00:00Z","2026-11-23T23:00:00Z","Australia/Sydney","3"*64",2,"cancelled",0,stamp,stamp))
    run(db, root/"export")
    assert (root/"export"/"manifest.json").is_file()
    assert (root/"export"/"d1-data.sql").stat().st_mode & 0o077 == 0
