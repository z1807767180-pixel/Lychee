"""Prepare code-only Render release parts and the exact previous parts offline."""
import argparse
import base64
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
from zipfile import ZipFile

PROJECT = Path(__file__).resolve().parents[1]
BASELINE = "6a983021bd5512eef4dd724b6f7028002df5905fc9c57712192af968126b3531"
PART_SIZE = 12000


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_parts(raw):
    env = dict(line.split("=", 1) for line in raw.decode("utf-8-sig").splitlines() if line)
    part_keys = [f"LYCHEE_APP_PART_{i}" for i in range(int(env["LYCHEE_APP_PARTS"]))]
    if set(env) != set(part_keys) | {"LYCHEE_APP_PARTS", "LYCHEE_STAGE_HASH"}:
        raise ValueError("Expected a code-only release file")
    zipped = base64.b64decode("".join(env[key] for key in part_keys), validate=True)
    if sha(zipped) != env["LYCHEE_STAGE_HASH"]:
        raise ValueError("Release checksum mismatch")
    return json.loads(gzip.decompress(zipped)), sha(zipped)


def create(archive, destination):
    with ZipFile(archive) as handoff:
        previous = handoff.read("release/current.env")
        original = handoff.read("working-source/server.mjs")
        for file in (PROJECT / "legacy").iterdir():
            if not file.is_file():
                continue
            archived = handoff.read("working-source/" + file.name)
            if file.name == "account.mjs":
                # The private archive supplies the original registration policy;
                # the public source takes old invite verifiers from the environment.
                if sha(archived) != "76879fa7d34d921a077928c488390008e61e1676e50b4720f81cca6b45ac2083":
                    raise ValueError("Unexpected private account module")
            elif file.read_bytes() != archived:
                raise ValueError("Unexpected legacy input: " + file.name)
    overlay, previous_hash = read_parts(previous)
    if previous_hash != BASELINE or base64.b64decode(overlay["server.mjs"]) != original:
        raise ValueError("Expected the verified 6.3.3 handoff")
    final = dict(overlay)
    with tempfile.TemporaryDirectory() as td:
        source, target = Path(td) / "original.mjs", Path(td) / "server.mjs"
        source.write_bytes(original)
        subprocess.run(["node", str(PROJECT / "server/compose-original.mjs"),
                        "--original", str(source), "--output", str(target)], check=True)
        final["server.mjs"] = base64.b64encode(target.read_bytes()).decode("ascii")

    for file in sorted((PROJECT / "server").glob("*.mjs")):
        key = "lychee-v640/server/" + file.name
        final[key] = base64.b64encode(file.read_bytes()).decode("ascii")
    final["lychee-v640/public/version.txt"] = base64.b64encode(b"6.4.0\n").decode("ascii")
    payload = gzip.compress(json.dumps(final, ensure_ascii=False, separators=(",", ":"))
                            .encode("utf-8"), compresslevel=9, mtime=0)
    encoded = base64.b64encode(payload).decode("ascii")
    parts = [encoded[i:i + PART_SIZE] for i in range(0, len(encoded), PART_SIZE)]
    lines = [f"LYCHEE_APP_PARTS={len(parts)}"]
    lines.extend(f"LYCHEE_APP_PART_{i}={part}" for i, part in enumerate(parts))
    lines.append("LYCHEE_STAGE_HASH=" + sha(payload))
    release = ("\n".join(lines) + "\n").encode("ascii")
    reread, new_hash = read_parts(release)
    if reread != final or any(final[k] != v for k, v in overlay.items() if k != "server.mjs"):
        raise ValueError("Unrelated original assets changed")
    destination.mkdir(parents=True, exist_ok=True)
    for name, content in (("candidate.env", release), ("rollback-6.3.3.env", previous)):
        (destination / name).write_bytes(content)
    receipt = {"base": previous_hash, "candidate": new_hash, "parts": len(parts),
               "preservedOriginalFiles": len(overlay) - 1,
               "newFiles": sorted(set(final) - set(overlay))}
    (destination / "receipt.json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    print(f"Prepared {len(parts)} code parts, previous release retained. {new_hash}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("handoff", type=Path)
    parser.add_argument("out", type=Path)
    args = parser.parse_args()
    create(args.handoff, args.out)
