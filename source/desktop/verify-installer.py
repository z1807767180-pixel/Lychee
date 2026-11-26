"""Read the embedded cabinet through Windows Installer and byte-check the EXE inside."""
import argparse, ctypes as C, hashlib, subprocess, tempfile
from pathlib import Path
from ctypes import wintypes as W
dll=C.WinDLL('msi')
def invoke(name,types,*args):
    fn=getattr(dll,name);fn.argtypes=types;fn.restype=W.UINT
    code=fn(*args)
    if code: raise OSError(code,name)
def embedded_exe(msi):
    db=W.UINT();view=W.UINT();record=W.UINT()
    try:
        invoke('MsiOpenDatabaseW',[W.LPCWSTR,W.LPCWSTR,C.POINTER(W.UINT)],str(msi),None,C.byref(db))
        invoke('MsiDatabaseOpenViewW',[W.UINT,W.LPCWSTR,C.POINTER(W.UINT)],db,"SELECT `Data` FROM `_Streams` WHERE `Name` = 'lychee.cab'",C.byref(view))
        invoke('MsiViewExecute',[W.UINT,W.UINT],view,0)
        invoke('MsiViewFetch',[W.UINT,C.POINTER(W.UINT)],view,C.byref(record))
        with tempfile.TemporaryDirectory() as td:
            dest=Path(td);cab=dest/'payload.cab';buf=C.create_string_buffer(65536)
            with cab.open('wb') as output:
                while True:
                    n=W.DWORD(len(buf))
                    invoke('MsiRecordReadStream',[W.UINT,W.UINT,C.c_void_p,C.POINTER(W.DWORD)],record,1,buf,C.byref(n))
                    if not n.value: break
                    output.write(buf.raw[:n.value])
            folder=dest/'unpacked';folder.mkdir();subprocess.run(['tar.exe','-xf',str(cab),'-C',str(folder)],check=True)
            return (folder/'LycheeExe').read_bytes()
    finally:
        for h in (record,view,db):
            if h.value:dll.MsiCloseHandle(h)

def check(msi,exe):
    received=embedded_exe(msi)
    if received != exe.read_bytes():
        raise ValueError('MSI payload differs from the standalone EXE')
    print('Verified MSI payload',hashlib.sha256(received).hexdigest())
def query(package, sql):
    import msilib
    db=msilib.OpenDatabase(str(package),msilib.MSIDBOPEN_READONLY)
    view=db.OpenView(sql)
    view.Execute(None)
    rows=[]
    while record:=view.Fetch():
        rows.append(tuple(record.GetString(i) for i in range(1,record.GetFieldCount()+1)))
    return rows


def check_wizard(package):
    def table(sql):
        return query(package,sql)
    props=dict(table('SELECT `Property`,`Value` FROM `Property`'))
    assert props['ProductLanguage']=='2052'
    shortcuts=table('SELECT `Directory_`,`Target`,`WkDir` FROM `Shortcut`')
    assert sorted(shortcuts)==[(folder,'[#LycheeExe]','INSTALLDIR') for folder in ('DesktopFolder','ProgramMenuFolder')]
    controls=set(table('SELECT `Dialog_`,`Type`,`Property` FROM `Control`'))
    assert ('BrowseDlg','PathEdit','INSTALLDIR') in controls
    captions=set(table("SELECT `Dialog_`,`Text` FROM `Control` WHERE `Type`='PushButton'"))
    assert {('InstallDlg','安装'),('ExitDialog','打开荔枝'),('MaintenanceDlg','修复安装')}<=captions
    actions=dict(table('SELECT `Action`,`Sequence` FROM `InstallUISequence`'))
    for dialog in ('InstallDlg','UpgradeDlg','MaintenanceDlg'):
        assert int(actions['CostFinalize'])<int(actions[dialog])<int(actions['ExecuteAction'])
    assert actions['ExitDialog']=='-1'
    execute=dict(table('SELECT `Action`,`Sequence` FROM `InstallExecuteSequence`'))
    assert 'LaunchLychee' not in execute
    print('Verified Chinese installer dialogs, both shortcut targets and silent installation sequence')


def check_upgrade(previous, current):
    def properties(package):
        return dict(query(package,'SELECT `Property`,`Value` FROM `Property`'))
    old,new=properties(previous),properties(current)
    version=lambda value:tuple(map(int,value.split('.')))
    assert version(old['ProductVersion'])<version(new['ProductVersion'])
    assert old['UpgradeCode']==new['UpgradeCode'] and old['ProductCode']!=new['ProductCode']
    rules=query(current,'SELECT `UpgradeCode`,`VersionMin`,`VersionMax`,`Attributes`,`ActionProperty` FROM `Upgrade`')
    assert (old['UpgradeCode'],'',new['ProductVersion'],'1','OLDERPRODUCTS') in rules
    actions=dict(query(current,'SELECT `Action`,`Sequence` FROM `InstallExecuteSequence`'))
    assert (0<int(actions['FindRelatedProducts'])<int(actions['InstallInitialize'])
            <int(actions['InstallExecute'])<int(actions['RemoveExistingProducts'])<int(actions['InstallFinalize']))
    for sql in ['SELECT `Component`,`ComponentId`,`Directory_`,`KeyPath` FROM `Component`',
                'SELECT `Directory`,`Directory_Parent`,`DefaultDir` FROM `Directory`']:
        assert set(query(previous,sql))<=set(query(current,sql)), 'An existing component or directory changed identity'
    print('Verified MSI major upgrade',old['ProductVersion'],'->',new['ProductVersion'])

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('msi',type=Path);p.add_argument('exe',type=Path)
    p.add_argument('--upgrade-from',type=Path);p.add_argument('--wizard',action='store_true')
    a=p.parse_args();check(a.msi.resolve(),a.exe.resolve())
    if a.wizard: check_wizard(a.msi.resolve())
    if a.upgrade_from: check_upgrade(a.upgrade_from.resolve(),a.msi.resolve())
