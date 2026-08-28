#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlsplit


ALLOWED_SUFFIXES = {".mkv", ".mp4", ".mov", ".ts", ".m2ts", ".mts"}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download and atomically install a verified SubTandem media sample")
    parser.add_argument("--repo-root", required=True, type=Path)
    parser.add_argument("--url", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--sha256")
    parser.add_argument("--expect-container", choices=["matroska", "mp4", "mov", "mpegts"])
    parser.add_argument(
        "--expect-subtitle",
        action="append",
        choices=["subrip", "ass", "ssa", "mov_text", "pgs", "vobsub", "dvb_subtitle"],
        default=[],
    )
    parser.add_argument("--min-duration", type=float)
    parser.add_argument("--require-video", action="store_true")
    parser.add_argument("--max-bytes", type=int, default=536_870_912)
    parser.add_argument("--replace", action="store_true")
    return parser.parse_args()


def validate_inputs(args: argparse.Namespace) -> tuple[Path, Path]:
    repo_root = args.repo_root.resolve()
    if not (repo_root / "AGENTS.md").is_file() or not (repo_root / "package.json").is_file():
        raise ValueError("repo root does not look like SubTandem")
    name = Path(args.name)
    if name.name != args.name or args.name.startswith(".") or name.suffix.lower() not in ALLOWED_SUFFIXES:
        raise ValueError("name must be a non-hidden media basename with a supported extension")
    parsed = urlsplit(args.url)
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
        raise ValueError("url must be a credential-free HTTPS URL")
    if args.sha256 and not re.fullmatch(r"[0-9a-fA-F]{64}", args.sha256):
        raise ValueError("sha256 must contain 64 hexadecimal characters")
    if args.max_bytes <= 0:
        raise ValueError("max-bytes must be positive")
    samples = repo_root / "docs" /"local" / "samples"
    samples.mkdir(parents=True, exist_ok=True)
    resolved_samples = samples.resolve()
    if repo_root not in resolved_samples.parents or not resolved_samples.is_dir():
        raise ValueError("samples directory must remain inside the repository")
    return resolved_samples, resolved_samples / name


def inspection_command(args: argparse.Namespace, path: Path) -> list[str]:
    command = [sys.executable, str(Path(__file__).with_name("inspect_sample.py")), str(path)]
    if args.expect_container:
        command.extend(["--expect-container", args.expect_container])
    for codec in args.expect_subtitle:
        command.extend(["--expect-subtitle", codec])
    if args.min_duration is not None:
        command.extend(["--min-duration", str(args.min_duration)])
    if args.require_video:
        command.append("--require-video")
    return command


def inspect(args: argparse.Namespace, path: Path) -> dict:
    result = subprocess.run(inspection_command(args, path), text=True, capture_output=True)
    if result.returncode != 0:
        if result.stdout:
            print(result.stdout, end="", file=sys.stderr)
        if result.stderr:
            print(result.stderr, end="", file=sys.stderr)
        raise RuntimeError("media inspection failed")
    return json.loads(result.stdout)


def report(status: str, target: Path, digest: str, size: int, inspection: dict) -> None:
    inspection["name"] = target.name
    print(
        json.dumps(
            {
                "status": status,
                "target": str(Path("docs") / "local" / "samples" / target.name),
                "bytes": size,
                "sha256": digest,
                "inspection": inspection,
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
    )


def main() -> int:
    args = parse_args()
    temporary = None
    try:
        samples, target = validate_inputs(args)
        expected = args.sha256.lower() if args.sha256 else None
        if target.is_symlink():
            raise ValueError("target must not be a symbolic link")
        if target.exists() and not args.replace:
            if not target.is_file():
                raise ValueError("existing target is not a regular file")
            digest = sha256(target)
            if expected is None or digest != expected:
                raise FileExistsError("target exists; provide its known sha256 to reuse it or obtain approval for --replace")
            report("reused", target, digest, target.stat().st_size, inspect(args, target))
            return 0
        curl = shutil.which("curl")
        if curl is None:
            raise RuntimeError("curl is required")
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{target.stem}.", suffix=f".part{target.suffix}", dir=samples
        )
        os.close(descriptor)
        temporary = Path(temporary_name)
        subprocess.run(
            [
                curl,
                "-fL",
                "--retry",
                "3",
                "--connect-timeout",
                "20",
                "--max-filesize",
                str(args.max_bytes),
                "--output",
                str(temporary),
                args.url,
            ],
            check=True,
        )
        size = temporary.stat().st_size
        if size <= 0 or size > args.max_bytes:
            raise RuntimeError("downloaded size is outside the allowed range")
        digest = sha256(temporary)
        if expected and digest != expected:
            raise RuntimeError(f"sha256 mismatch: expected {expected}, found {digest}")
        inspection = inspect(args, temporary)
        os.replace(temporary, target)
        temporary = None
        report("installed", target, digest, size, inspection)
        return 0
    except (FileExistsError, OSError, RuntimeError, ValueError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        return 2
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    raise SystemExit(main())
