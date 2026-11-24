"""Download + unpack the ambientCG (CC0) texture sets used by blender/lib/textures.py.

    python3 blender/fetch_ambientcg.py            # every asset id referenced in textures.SETS
    python3 blender/fetch_ambientcg.py Metal009   # explicit ids

* asks the ambientCG API v2 for the 2K-JPG zip of each id
* zips are cached in assets/src/ambientcg/_downloads/ (not needed at runtime)
* unpacks ONLY the map JPGs (Color, NormalGL, Roughness, Opacity, Metalness, ...)
  to assets/textures/<id>/ - no path from the zip is trusted
* appends missing rows to assets/textures/SOURCES.md (licence trail)
Plain stdlib, runs outside Blender (textures.py is read with ast, not imported).
"""
import ast
import json
import re
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "assets" / "src" / "ambientcg" / "_downloads"
DEST = ROOT / "assets" / "textures"
TEXTURES_PY = ROOT / "blender" / "lib" / "textures.py"
API = "https://ambientcg.com/api/v2/full_json?id={id}&include=downloadData"
RES = "2K-JPG"
UA = {"User-Agent": "leyonet-dc-asset-fetch/1.0"}
ID_RE = re.compile(r"^[A-Z][A-Za-z]+\d{3}[A-Z]?$")
MAP_RE = re.compile(r"^(?P<id>[A-Za-z0-9]+)_" + RES + r"_(?P<kind>[A-Za-z]+)\.jpg$")


def ids_from_textures():
    tree = ast.parse(TEXTURES_PY.read_text())
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(getattr(t, "id", "") == "SETS" for t in node.targets):
            return sorted({n.value for n in ast.walk(node.value)
                           if isinstance(n, ast.Constant) and isinstance(n.value, str)
                           and ID_RE.match(n.value)})
    raise RuntimeError("SETS not found in textures.py")


def _get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def zip_url(asset_id):
    d = json.loads(_get(API.format(id=asset_id)))
    assets = d.get("foundAssets") or []
    if not assets:
        raise RuntimeError(f"{asset_id}: not found on ambientCG")
    a = assets[0]
    for f in a["downloadFolders"]["default"]["downloadFiletypeCategories"]["zip"]["downloads"]:
        if f["attribute"] == RES:
            return f["downloadLink"], int(f["size"]), a.get("displayName", asset_id)
    raise RuntimeError(f"{asset_id}: no {RES} download")


def fetch(asset_id):
    CACHE.mkdir(parents=True, exist_ok=True)
    zpath = CACHE / f"{asset_id}_{RES}.zip"
    title = asset_id
    if not zpath.exists():
        url, size, title = zip_url(asset_id)
        if not url.startswith("https://ambientcg.com/"):
            raise RuntimeError(f"{asset_id}: unexpected download host {url}")
        print(f"[fetch] {asset_id}: {url} ({size / 1e6:.1f} MB)", flush=True)
        data = _get(url)
        tmp = zpath.with_suffix(".part")
        tmp.write_bytes(data)
        tmp.rename(zpath)
    out = DEST / asset_id
    out.mkdir(parents=True, exist_ok=True)
    kinds = []
    with zipfile.ZipFile(zpath) as z:
        for info in z.infolist():
            base = Path(info.filename).name          # never trust directories in the zip
            m = MAP_RE.match(base)
            if not m or m["id"] != asset_id or info.file_size > 200_000_000:
                continue
            target = out / base
            if not target.exists() or target.stat().st_size != info.file_size:
                target.write_bytes(z.read(info))
            kinds.append(m["kind"])
    for need in ("Color", "NormalGL", "Roughness"):
        if need not in kinds and asset_id not in ("Fingerprints002", "SurfaceImperfections015"):
            print(f"[fetch] WARNING {asset_id}: no {need} map")
    print(f"[fetch] {asset_id} -> {out.relative_to(ROOT)} {sorted(kinds)}")
    return title


def note_source(asset_id):
    src = DEST / "SOURCES.md"
    if not src.exists():
        src.write_text("# ambientCG texture sets (CC0 1.0, https://ambientcg.com/license)\n\n"
                       f"{RES} downloads via blender/fetch_ambientcg.py; zips cached in "
                       "assets/src/ambientcg/_downloads/.\n\n| AssetID | Used for | URL |\n|---|---|---|\n")
    text = src.read_text()
    if f"| {asset_id} |" not in text:
        src.write_text(text + f"| {asset_id} | (see lib/textures.py SETS) | https://ambientcg.com/view?id={asset_id} |\n")


if __name__ == "__main__":
    ids = sys.argv[1:] or ids_from_textures()
    for i in ids:
        if not ID_RE.match(i):
            sys.exit(f"bad asset id {i!r}")
        fetch(i)
        note_source(i)
