#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import struct
import sys
from dataclasses import asdict, dataclass
from pathlib import Path


class InspectionError(Exception):
    pass


@dataclass
class MediaInfo:
    name: str
    container: str
    duration_seconds: float | None
    video_tracks: int
    audio_tracks: int
    subtitle_codecs: list[str]
    raw_subtitle_codecs: list[str]


def read_vint(data: bytes, offset: int, keep_marker: bool, max_length: int) -> tuple[int, int, bool]:
    if offset >= len(data):
        raise InspectionError("Unexpected end of EBML data")
    first = data[offset]
    marker = 0x80
    length = 1
    while length <= max_length and not first & marker:
        marker >>= 1
        length += 1
    if length > max_length or offset + length > len(data):
        raise InspectionError("Invalid EBML variable integer")
    value = first if keep_marker else first & (marker - 1)
    for byte in data[offset + 1 : offset + length]:
        value = (value << 8) | byte
    unknown = not keep_marker and value == (1 << (7 * length)) - 1
    return value, length, unknown


def iter_ebml(data: bytes, start: int, end: int):
    offset = start
    while offset < end:
        element_id, id_length, _ = read_vint(data, offset, True, 4)
        size, size_length, unknown = read_vint(data, offset + id_length, False, 8)
        payload_start = offset + id_length + size_length
        payload_end = end if unknown else payload_start + size
        if payload_end > end or payload_end < payload_start:
            raise InspectionError("EBML element exceeds its parent")
        yield element_id, payload_start, payload_end
        if payload_end == offset:
            raise InspectionError("EBML parser made no progress")
        offset = payload_end


def decode_ebml_uint(data: bytes, start: int, end: int) -> int:
    return int.from_bytes(data[start:end], "big")


def map_matroska_subtitle(codec_id: str) -> str | None:
    mapping = {
        "S_TEXT/UTF8": "subrip",
        "S_TEXT/ASS": "ass",
        "S_ASS": "ass",
        "S_TEXT/SSA": "ssa",
        "S_SSA": "ssa",
        "S_HDMV/PGS": "pgs",
        "S_VOBSUB": "vobsub",
        "S_DVBSUB": "dvb_subtitle",
    }
    return mapping.get(codec_id)


def inspect_matroska(path: Path, data: bytes) -> MediaInfo:
    segment = None
    for element_id, start, end in iter_ebml(data, 0, len(data)):
        if element_id == 0x18538067:
            segment = (start, end)
            break
    if segment is None:
        raise InspectionError("Matroska Segment not found")
    timecode_scale = 1_000_000
    duration_units = None
    tracks: list[tuple[int | None, str | None]] = []
    for element_id, start, end in iter_ebml(data, segment[0], segment[1]):
        if element_id == 0x1549A966:
            for child_id, child_start, child_end in iter_ebml(data, start, end):
                if child_id == 0x2AD7B1:
                    timecode_scale = decode_ebml_uint(data, child_start, child_end)
                elif child_id == 0x4489:
                    length = child_end - child_start
                    if length not in (4, 8):
                        raise InspectionError("Unsupported Matroska duration width")
                    duration_units = struct.unpack(">f" if length == 4 else ">d", data[child_start:child_end])[0]
        elif element_id == 0x1654AE6B:
            for track_id, track_start, track_end in iter_ebml(data, start, end):
                if track_id != 0xAE:
                    continue
                track_type = None
                codec_id = None
                for child_id, child_start, child_end in iter_ebml(data, track_start, track_end):
                    if child_id == 0x83:
                        track_type = decode_ebml_uint(data, child_start, child_end)
                    elif child_id == 0x86:
                        codec_id = data[child_start:child_end].decode("ascii", "strict")
                tracks.append((track_type, codec_id))
    raw_subtitles = [codec for track_type, codec in tracks if track_type == 17 and codec]
    subtitles = [mapped for codec in raw_subtitles if (mapped := map_matroska_subtitle(codec))]
    duration = None if duration_units is None else duration_units * timecode_scale / 1_000_000_000
    return MediaInfo(
        name=path.name,
        container="matroska",
        duration_seconds=duration,
        video_tracks=sum(track_type == 1 for track_type, _ in tracks),
        audio_tracks=sum(track_type == 2 for track_type, _ in tracks),
        subtitle_codecs=sorted(set(subtitles)),
        raw_subtitle_codecs=sorted(set(raw_subtitles)),
    )


def iter_boxes(data: bytes, start: int, end: int):
    offset = start
    while offset + 8 <= end:
        size = int.from_bytes(data[offset : offset + 4], "big")
        box_type = data[offset + 4 : offset + 8]
        header = 8
        if size == 1:
            if offset + 16 > end:
                raise InspectionError("Truncated extended MP4 box")
            size = int.from_bytes(data[offset + 8 : offset + 16], "big")
            header = 16
        elif size == 0:
            size = end - offset
        if size < header or offset + size > end:
            raise InspectionError("Invalid MP4 box size")
        yield box_type, offset + header, offset + size
        offset += size


def first_box(data: bytes, start: int, end: int, expected: bytes) -> tuple[int, int] | None:
    for box_type, box_start, box_end in iter_boxes(data, start, end):
        if box_type == expected:
            return box_start, box_end
    return None


def mp4_duration(data: bytes, moov: tuple[int, int]) -> float | None:
    box = first_box(data, moov[0], moov[1], b"mvhd")
    if box is None:
        return None
    content = data[box[0] : box[1]]
    if not content:
        return None
    if content[0] == 0 and len(content) >= 20:
        timescale = int.from_bytes(content[12:16], "big")
        duration = int.from_bytes(content[16:20], "big")
    elif content[0] == 1 and len(content) >= 32:
        timescale = int.from_bytes(content[20:24], "big")
        duration = int.from_bytes(content[24:32], "big")
    else:
        return None
    return duration / timescale if timescale else None


def inspect_mp4(path: Path, data: bytes) -> MediaInfo:
    top_boxes = list(iter_boxes(data, 0, len(data)))
    moov = next(((start, end) for box_type, start, end in top_boxes if box_type == b"moov"), None)
    if moov is None:
        raise InspectionError("MP4/MOV moov box not found")
    ftyp = next(((start, end) for box_type, start, end in top_boxes if box_type == b"ftyp"), None)
    major_brand = data[ftyp[0] : ftyp[0] + 4] if ftyp and ftyp[1] - ftyp[0] >= 4 else b""
    container = "mov" if major_brand == b"qt  " or path.suffix.lower() == ".mov" else "mp4"
    video_tracks = 0
    audio_tracks = 0
    subtitles: list[str] = []
    raw_subtitles: list[str] = []
    for box_type, track_start, track_end in iter_boxes(data, moov[0], moov[1]):
        if box_type != b"trak":
            continue
        mdia = first_box(data, track_start, track_end, b"mdia")
        if mdia is None:
            continue
        hdlr = first_box(data, mdia[0], mdia[1], b"hdlr")
        handler = data[hdlr[0] + 8 : hdlr[0] + 12] if hdlr and hdlr[1] - hdlr[0] >= 12 else b""
        if handler == b"vide":
            video_tracks += 1
        elif handler == b"soun":
            audio_tracks += 1
        minf = first_box(data, mdia[0], mdia[1], b"minf")
        stbl = first_box(data, minf[0], minf[1], b"stbl") if minf else None
        stsd = first_box(data, stbl[0], stbl[1], b"stsd") if stbl else None
        sample_types: list[bytes] = []
        if stsd and stsd[1] - stsd[0] >= 8:
            content = data[stsd[0] : stsd[1]]
            count = int.from_bytes(content[4:8], "big")
            offset = 8
            for _ in range(count):
                if offset + 8 > len(content):
                    break
                entry_size = int.from_bytes(content[offset : offset + 4], "big")
                if entry_size < 8 or offset + entry_size > len(content):
                    break
                sample_types.append(content[offset + 4 : offset + 8])
                offset += entry_size
        if handler in {b"sbtl", b"subt", b"text", b"clcp"} or any(value in {b"tx3g", b"text"} for value in sample_types):
            for value in sample_types:
                raw = value.decode("latin1")
                raw_subtitles.append(raw)
                if value in {b"tx3g", b"text"}:
                    subtitles.append("mov_text")
    return MediaInfo(
        name=path.name,
        container=container,
        duration_seconds=mp4_duration(data, moov),
        video_tracks=video_tracks,
        audio_tracks=audio_tracks,
        subtitle_codecs=sorted(set(subtitles)),
        raw_subtitle_codecs=sorted(set(raw_subtitles)),
    )


def find_ts_layout(data: bytes) -> tuple[int, int]:
    best = (0.0, 0, 0)
    for packet_size in (188, 192, 204):
        for sync_offset in range(packet_size):
            available = (len(data) - sync_offset) // packet_size
            count = min(available, 200)
            if count < 5:
                continue
            hits = sum(data[sync_offset + index * packet_size] == 0x47 for index in range(count))
            score = hits / count
            if score > best[0]:
                best = (score, packet_size, sync_offset)
    if best[0] < 0.95:
        raise InspectionError("MPEG-TS sync pattern not found")
    return best[1], best[2]


def ts_payload(packet: bytes) -> bytes:
    if len(packet) != 188 or packet[0] != 0x47 or packet[1] & 0x80:
        return b""
    adaptation_control = (packet[3] >> 4) & 3
    if adaptation_control not in (1, 3):
        return b""
    offset = 4
    if adaptation_control == 3:
        offset += 1 + packet[offset]
    return packet[offset:] if offset < len(packet) else b""


def psi_section(packets: list[bytes], pid: int, table_id: int) -> bytes:
    buffer = b""
    required = None
    collecting = False
    for packet in packets:
        packet_pid = ((packet[1] & 0x1F) << 8) | packet[2]
        if packet_pid != pid:
            continue
        payload = ts_payload(packet)
        if not payload:
            continue
        if packet[1] & 0x40:
            pointer = payload[0]
            if 1 + pointer > len(payload):
                continue
            payload = payload[1 + pointer :]
            buffer = b""
            required = None
            collecting = True
        if not collecting:
            continue
        buffer += payload
        if len(buffer) >= 3 and required is None:
            if buffer[0] != table_id:
                collecting = False
                buffer = b""
                continue
            required = 3 + (((buffer[1] & 0x0F) << 8) | buffer[2])
        if required is not None and len(buffer) >= required:
            return buffer[:required]
    raise InspectionError(f"PSI table 0x{table_id:02x} not found on PID 0x{pid:04x}")


def ts_pts_span(packets: list[bytes]) -> float | None:
    values: dict[int, list[int]] = {}
    for packet in packets:
        if not packet[1] & 0x40:
            continue
        payload = ts_payload(packet)
        if len(payload) < 14 or payload[:3] != b"\x00\x00\x01" or not payload[7] & 0x80:
            continue
        value = payload[9:14]
        pts = (
            ((value[0] >> 1) & 7) << 30
            | value[1] << 22
            | (value[2] >> 1) << 15
            | value[3] << 7
            | value[4] >> 1
        )
        pid = ((packet[1] & 0x1F) << 8) | packet[2]
        values.setdefault(pid, []).append(pts)
    spans = []
    wrap = 1 << 33
    for sequence in values.values():
        if len(sequence) < 2:
            continue
        unwrapped = [sequence[0]]
        base = 0
        for value in sequence[1:]:
            if value + base < unwrapped[-1] - (1 << 32):
                base += wrap
            unwrapped.append(value + base)
        spans.append((max(unwrapped) - min(unwrapped)) / 90_000)
    return max(spans) if spans else None


def descriptor_tags(data: bytes) -> list[int]:
    tags = []
    offset = 0
    while offset + 2 <= len(data):
        length = data[offset + 1]
        if offset + 2 + length > len(data):
            break
        tags.append(data[offset])
        offset += 2 + length
    return tags


def inspect_mpegts(path: Path, data: bytes) -> MediaInfo:
    packet_size, sync_offset = find_ts_layout(data)
    count = (len(data) - sync_offset) // packet_size
    packets = [
        data[sync_offset + index * packet_size : sync_offset + index * packet_size + 188]
        for index in range(count)
    ]
    pat = psi_section(packets, 0, 0)
    pmt_pids = []
    for offset in range(8, len(pat) - 4, 4):
        program = (pat[offset] << 8) | pat[offset + 1]
        if program:
            pmt_pids.append(((pat[offset + 2] & 0x1F) << 8) | pat[offset + 3])
    subtitle_codecs: list[str] = []
    raw_subtitles: list[str] = []
    video_tracks = 0
    audio_tracks = 0
    video_types = {0x01, 0x02, 0x10, 0x1B, 0x24, 0x42}
    audio_types = {0x03, 0x04, 0x0F, 0x11, 0x81, 0x87}
    for pmt_pid in pmt_pids:
        pmt = psi_section(packets, pmt_pid, 2)
        offset = 12 + (((pmt[10] & 0x0F) << 8) | pmt[11])
        end = len(pmt) - 4
        while offset + 5 <= end:
            stream_type = pmt[offset]
            info_length = ((pmt[offset + 3] & 0x0F) << 8) | pmt[offset + 4]
            descriptors = pmt[offset + 5 : offset + 5 + info_length]
            tags = descriptor_tags(descriptors)
            if stream_type in video_types:
                video_tracks += 1
            elif stream_type in audio_types:
                audio_tracks += 1
            if 0x59 in tags:
                subtitle_codecs.append("dvb_subtitle")
                raw_subtitles.append("descriptor:0x59")
            if stream_type == 0x90:
                subtitle_codecs.append("pgs")
                raw_subtitles.append("stream_type:0x90")
            offset += 5 + info_length
    return MediaInfo(
        name=path.name,
        container="mpegts",
        duration_seconds=ts_pts_span(packets),
        video_tracks=video_tracks,
        audio_tracks=audio_tracks,
        subtitle_codecs=sorted(set(subtitle_codecs)),
        raw_subtitle_codecs=sorted(set(raw_subtitles)),
    )


def inspect(path: Path) -> MediaInfo:
    if not path.is_file() or path.is_symlink():
        raise InspectionError("Input must be a regular file")
    data = path.read_bytes()
    if not data:
        raise InspectionError("Input is empty")
    if data.startswith(b"\x1aE\xdf\xa3"):
        return inspect_matroska(path, data)
    try:
        return inspect_mpegts(path, data)
    except InspectionError:
        pass
    try:
        return inspect_mp4(path, data)
    except InspectionError as error:
        raise InspectionError(f"Unsupported or malformed media: {error}") from error


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Inspect SubTandem test media without ffprobe")
    parser.add_argument("path", type=Path)
    parser.add_argument("--expect-container", choices=["matroska", "mp4", "mov", "mpegts"])
    parser.add_argument(
        "--expect-subtitle",
        action="append",
        choices=["subrip", "ass", "ssa", "mov_text", "pgs", "vobsub", "dvb_subtitle"],
        default=[],
    )
    parser.add_argument("--min-duration", type=float)
    parser.add_argument("--require-video", action="store_true")
    return parser.parse_args()


def validate(info: MediaInfo, args: argparse.Namespace) -> list[str]:
    errors = []
    if args.expect_container and info.container != args.expect_container:
        errors.append(f"expected container {args.expect_container}, found {info.container}")
    for codec in args.expect_subtitle:
        if codec not in info.subtitle_codecs:
            errors.append(f"expected subtitle codec {codec}, found {','.join(info.subtitle_codecs) or 'none'}")
    if args.min_duration is not None:
        if info.duration_seconds is None:
            errors.append("duration is unavailable")
        elif info.duration_seconds < args.min_duration:
            errors.append(f"expected duration >= {args.min_duration}, found {info.duration_seconds:.3f}")
    if args.require_video and info.video_tracks < 1:
        errors.append("video track is required")
    return errors


def main() -> int:
    args = parse_args()
    try:
        info = inspect(args.path.resolve())
        errors = validate(info, args)
    except (InspectionError, OSError, UnicodeError, struct.error) as error:
        print(str(error), file=sys.stderr)
        return 2
    print(json.dumps(asdict(info), ensure_ascii=False, indent=2, sort_keys=True))
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
