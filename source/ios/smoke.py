"""Boot the built app on an iPhone simulator and verify its offline login screen."""
import json
from pathlib import Path
import subprocess
import time
from build import APP_ID, OUT, compile_app


def sim(*args):
    return subprocess.check_output(['xcrun','simctl',*args],text=True).strip()


app = compile_app(simulator=True)
subprocess.run(['codesign','--force','--sign','-',app],check=True)
devices = json.loads(sim('list','devices','available','--json'))['devices']
candidates = [(key,d) for key,rows in devices.items() if '.iOS-' in key for d in rows
              if d['name'].startswith('iPhone') and d['isAvailable']]
if not candidates:
    raise RuntimeError('No available iPhone simulator')
key, device = max(candidates,key=lambda item:tuple(map(int,item[0].split('.iOS-')[-1].split('-'))))
udid = device['udid']
if device['state'] != 'Booted':
    sim('boot',udid)
sim('bootstatus',udid,'-b')
sim('install',udid,str(app))
data = Path(sim('get_app_container',udid,APP_ID,'data'))
receipt = data/'Documents/smoke.ok'
failure = data/'Documents/smoke.error'
for marker in (receipt,failure):
    marker.unlink(missing_ok=True)
sim('launch',udid,APP_ID,'--offline-smoke')
for _ in range(80):
    if receipt.exists() and receipt.read_text()=='6.4.7':
        print(f"Verified {device['name']} {key}: bundled 6.4.7 login screen, offline fixture.")
        break
    if failure.exists():
        raise RuntimeError(failure.read_text())
    time.sleep(1)
else:
    raise RuntimeError('The bundled 6.4.7 login screen was not verified')
