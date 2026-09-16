"""Build an installable extension ZIP from an explicit runtime allowlist."""
from pathlib import Path
import json
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
version = json.loads((root / 'manifest.json').read_text())['version']
output = root / 'dist' / f'TeambitionExporter-{version}.zip'
output.parent.mkdir(exist_ok=True)
files = [root / 'manifest.json', root / 'README.md']
files += sorted((root / 'src').glob('*.js'))
files += sorted((root / 'src').glob('*.html'))
files += sorted((root / 'assets/icons').glob('icon[0-9]*.png'))
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for path in files:
        archive.write(path, 'TeambitionExporter/' + path.relative_to(root).as_posix())
with ZipFile(output) as archive:
    assert archive.testzip() is None
print(output)
