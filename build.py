#!/usr/bin/env python3
"""Build a self-contained HTML file; standard-library only."""
from pathlib import Path
import json
import re
ROOT=Path(__file__).resolve().parent
def javascript(name):
    return re.sub(r'^export ', '', (ROOT/'src'/name).read_text(), flags=re.M)
def build():
    parser=javascript('gcode.mjs')
    app=parser+'\n'+javascript('viewer.mjs')+'\n'
    profile=json.loads((ROOT/'integration/profile.json').read_text())
    app+='\nconst PR_PROFILE='+json.dumps(profile,ensure_ascii=False)+';\n'
    app+=javascript('ui.mjs')+'\n'+javascript('moonraker.mjs')
    template=(ROOT/'src/page.html').read_text()
    # Function form prevents replacement content from being processed twice.
    version=(ROOT/'VERSION').read_text().strip()
    if not re.fullmatch(r'\d+\.\d+\.\d+',version):raise ValueError('Ungültige VERSION')
    values={'__PARSER_SOURCE__':parser.replace('</script','<\\/script'),'__APP_SOURCE__':app.replace('</script','<\\/script'),'__APP_VERSION__':version}
    html=re.sub(r'__PARSER_SOURCE__|__APP_SOURCE__|__APP_VERSION__',lambda m:values[m.group()],template)
    (ROOT/'index.html').write_text(html)
    print('Built',ROOT/'index.html')
if __name__=='__main__':build()
