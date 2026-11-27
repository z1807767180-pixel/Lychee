"""Keep the mobile wheel illustrations available with their version of the tool."""
from base64 import b64encode
from pathlib import Path

ART = Path(__file__).resolve().parents[1] / "client"
IMAGES = {
    "client/wheel-v7.js": ("wheel-banner-v7.webp", "wheel-banner-v7.jpg", "image/jpeg"),
    "client/wheel-v7.css": ("wheel-hub-v7.webp", "wheel-hub-v7.png", "image/png"),
}


def include_wheel_art(name, data):
    if name not in IMAGES:
        return data
    source, compatible, media_type = IMAGES[name]
    reference = ("/client/" + source).encode("ascii")
    if data.count(reference) != 1:
        raise ValueError(f"Expected one wheel illustration in {name}")
    inline = f"data:{media_type};base64,".encode("ascii") + b64encode((ART / compatible).read_bytes())
    return data.replace(reference, inline)
