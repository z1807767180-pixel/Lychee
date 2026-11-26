"""Read the QA MSI tables and installed component path without modifying registration."""
import ctypes
from ctypes import wintypes
import json
import msilib
import sys
import uuid
from pathlib import Path


def rows(db, sql):
    view = db.OpenView(sql)
    view.Execute(None)
    result = []
    while record := view.Fetch():
        result.append([record.GetString(i + 1) for i in range(record.GetFieldCount())])
    return result


def inspect(path):
    db = msilib.OpenDatabase(str(Path(path).resolve()), msilib.MSIDBOPEN_READONLY)
    props = dict(rows(db, 'SELECT `Property`, `Value` FROM `Property`'))
    components = dict(rows(db, 'SELECT `Component`, `ComponentId` FROM `Component`'))
    return {
        'name': props['ProductName'], 'version': props['ProductVersion'], 'product': props['ProductCode'],
        'upgrade': props['UpgradeCode'], 'components': components,
        'shortcuts': rows(db, 'SELECT `Directory_`, `Name` FROM `Shortcut`'),
        'directories': rows(db, 'SELECT `Directory`, `Directory_Parent`, `DefaultDir` FROM `Directory`'),
        'registry': rows(db, 'SELECT `Root`, `Key` FROM `Registry`'),
        'upgrades': rows(db, 'SELECT `UpgradeCode` FROM `Upgrade`'),
    }


def state(path):
    props = inspect(path)
    msi = ctypes.WinDLL('msi')
    query = msi.MsiQueryProductStateW
    query.argtypes = [ctypes.c_wchar_p]
    target = ctypes.create_unicode_buffer(32768)
    size = ctypes.c_ulong(len(target))
    get = msi.MsiGetComponentPathW
    get.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.POINTER(ctypes.c_ulong)]
    status = get(props['product'], props['components']['DesktopClient'], target, ctypes.byref(size))
    return {'productState': query(props['product']), 'componentState': status, 'exePath': target.value}

def isolated(path, instance):
    if not __debug__:
        raise RuntimeError('QA package isolation checks require normal assertion mode.')
    token = str(uuid.UUID(instance))
    props = inspect(path)
    def expected(name):
        return '{' + str(uuid.uuid5(uuid.NAMESPACE_URL, 'lychee-desktop/qa/' + token + '/' + name)).upper() + '}'
    assert props['name'] == 'Lychee Desktop QA ' + token
    assert props['product'] == expected('product/' + props['version']) and props['upgrade'] == expected('upgrade')
    assert props['upgrades'] and all(row == [props['upgrade']] for row in props['upgrades'])
    components = {'DesktopClient': expected('component/main'), 'StartMenuItem': expected('component/startmenu')}
    folders = ['ProgramMenuFolder']
    if 'DesktopItem' in props['components']:
        components['DesktopItem'] = expected('component/desktop')
        folders.append('DesktopFolder')
    assert props['components'] == components
    name = 'Q' + token.replace('-', '')[:7].upper() + '|Lychee Desktop QA ' + token
    assert sorted(props['shortcuts']) == sorted([[folder, name] for folder in folders])
    assert props['registry'] == [['1', 'Software\\LycheeGardenDesktop QA ' + token + '\\Installer']] * len(folders)
    assert ['INSTALLDIR', 'LocalAppDataFolder', 'LycheeGardenApp QA ' + token] in props['directories']
    return props

def dpapi():
    class Blob(ctypes.Structure):
        _fields_ = [('size', wintypes.DWORD), ('data', ctypes.c_void_p)]
    api = ctypes.WinDLL('crypt32', use_last_error=True)
    local_free = ctypes.WinDLL('kernel32').LocalFree
    local_free.argtypes = [ctypes.c_void_p]
    data = ctypes.create_string_buffer(b'qa-only')
    plain = Blob(7, ctypes.addressof(data))
    cipher, out = Blob(), Blob()
    try:
        if not api.CryptProtectData(ctypes.byref(plain), None, None, None, None, 1, ctypes.byref(cipher)):
            return {'roundtrip': False, 'operation': 'CryptProtectData', 'win32Error': ctypes.get_last_error()}
        if not api.CryptUnprotectData(ctypes.byref(cipher), None, None, None, None, 1, ctypes.byref(out)):
            return {'roundtrip': False, 'operation': 'CryptUnprotectData', 'win32Error': ctypes.get_last_error()}
        return {'roundtrip': ctypes.string_at(out.data, out.size) == b'qa-only'}
    finally:
        if out.data:
            local_free(out.data)
        if cipher.data:
            local_free(cipher.data)

if __name__ == '__main__':
    mode, *args = sys.argv[1:]
    print(json.dumps({'inspect': isolated, 'state': state, 'dpapi': dpapi}[mode](*args)))
