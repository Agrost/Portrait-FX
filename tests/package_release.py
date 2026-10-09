"""Package only the independently authored module; do not bundle dependencies."""
from pathlib import Path
import json
import zipfile

module_root = Path(__file__).resolve().parent.parent
manifest = json.loads((module_root / "module.json").read_text(encoding="utf-8"))
archive = module_root.parent / f"{manifest['id']}-{manifest['version']}.zip"
files = [module_root / name for name in ("module.json", "README.md", "CHANGELOG.md", "VERIFICATION.md", "VERSIONING.md")]
if manifest.get("license"):
    license_file = module_root / manifest["license"]
    assert license_file.is_file(), manifest["license"]
    files.append(license_file)
files += sorted((module_root / "scripts").glob("*.js"))
files += sorted((module_root / "styles").glob("*.css"))

for entry in manifest["esmodules"] + manifest["styles"]:
    assert (module_root / entry).is_file(), entry

with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as output:
    for file in files:
        output.write(file, f"{manifest['id']}/{file.relative_to(module_root).as_posix()}")

with zipfile.ZipFile(archive) as packaged:
    assert packaged.testzip() is None
    assert set(packaged.namelist()) == {f"{manifest['id']}/{file.relative_to(module_root).as_posix()}" for file in files}
    assert f"{manifest['id']}/module.json" in packaged.namelist()

print(f"Created {archive.name}: {len(files)} files, {archive.stat().st_size} bytes.")
