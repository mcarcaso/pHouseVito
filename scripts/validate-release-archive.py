#!/usr/bin/env python3
"""Validate paths and links before extracting a trusted, checksummed release.

The adjacent SHA-256 is not an authentication mechanism. Only install artifacts
obtained through a separately trusted channel.
"""
import posixpath
import sys
import tarfile


def validate(archive: str, entry: str) -> None:
    total = 0
    count = 0
    with tarfile.open(archive, "r:gz") as tar:
        for member in tar:
            count += 1
            name = member.name.rstrip("/")
            parts = name.split("/")
            if not name or parts[0] != entry or any(p in ("", ".", "..") for p in parts):
                raise ValueError(f"Unsafe archive path: {member.name}")
            if len(parts) > 1 and parts[1] == "user":
                raise ValueError("Mutable user data must never be in a release")
            if not (member.isfile() or member.isdir() or member.issym() or member.islnk()):
                raise ValueError(f"Unsupported archive member: {member.name}")
            if member.issym() or member.islnk():
                if not member.linkname or member.linkname.startswith("/"):
                    raise ValueError(f"Unsafe archive link: {member.name}")
                target = posixpath.normpath(
                    member.linkname if member.islnk() else posixpath.join(posixpath.dirname(name), member.linkname)
                )
                if target != entry and not target.startswith(entry + "/"):
                    raise ValueError(f"Escaping archive link: {member.name}")
            total += member.size
            if member.size > 2 * 1024**3 or total > 8 * 1024**3 or count > 200_000:
                raise ValueError("Release exceeds extraction limits")
    if not count:
        raise ValueError("Empty release archive")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: validate-release-archive.py <archive> <entry>")
    try:
        validate(sys.argv[1], sys.argv[2])
    except (ValueError, tarfile.TarError) as exc:
        raise SystemExit(str(exc)) from exc
