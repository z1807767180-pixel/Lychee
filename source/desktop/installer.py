"""Make a per-user x64 Windows Installer from the same verified portable EXE."""
from pathlib import Path
import argparse, json, uuid
import msilib as m
from msilib import schema,sequence
from build_identity import guid
from installer_ui import add_dialogs, chinese_database
from installer_location import add_policy, policy_sequence

def build(exe,msi,product,instance=None,icon=None):
    suffix=' QA '+str(uuid.UUID(instance)) if instance else ''
    identify=lambda name:guid(name,instance)
    db=chinese_database(m.init_database(str(msi),schema,'Lychee Desktop'+suffix,identify('product/'+product),product,'Lychee'),msi)
    def rows(table,values):m.add_data(db,table,values)
    rows('Property',[('UpgradeCode',identify('upgrade')),
                      ('SecureCustomProperties','OLDERPRODUCTS;NEWERPRODUCTS;LY_PREVIOUS_DIR;INSTALLDIR')])
    rows('Upgrade',[(identify('upgrade'),None,product,None,1,None,'OLDERPRODUCTS'),(identify('upgrade'),product,None,None,2,None,'NEWERPRODUCTS')])
    rows('LaunchCondition',[('Installed OR NOT NEWERPRODUCTS','已经安装了更新的荔枝版本。'),
                           ('Installed OR NOT OLDERPRODUCTS OR LY_PREVIOUS_DIR',
                            '旧版安装位置无法安全更新。请在 Windows 设置的“已安装的应用”中卸载荔枝，然后重新打开此安装包并采用推荐目录。账号和使用记录会保留。')])
    # The previous MSI registered the EXE as its component key path. Looking for
    # that file component without a Signature row returns its containing directory.
    rows('CompLocator',[('LycheeRegisteredClient',identify('component/main'),1)])
    rows('AppSearch',[('LY_PREVIOUS_DIR','LycheeRegisteredClient')])
    add_policy(db,suffix)
    rows('CustomAction',[('UseExistingDir',51,'INSTALLDIR','[LY_PREVIOUS_DIR]'),
                         ('LaunchLychee',210,'LycheeExe',None)])
    rows('Directory',[('TARGETDIR',None,'SourceDir'),('LocalAppDataFolder','TARGETDIR','.'),
                      ('INSTALLDIR','LocalAppDataFolder','LycheeGardenApp'+suffix),('ProgramMenuFolder','TARGETDIR','.'),
                      ('DesktopFolder','TARGETDIR','.')])
    rows('Component',[('DesktopClient',identify('component/main'),'INSTALLDIR',256,None,'LycheeExe'),
                      ('StartMenuItem',identify('component/startmenu'),'ProgramMenuFolder',260,None,'StartMenuReg'),
                      ('DesktopItem',identify('component/desktop'),'DesktopFolder',260,None,'DesktopReg')])
    key='Software\\LycheeGardenDesktop'+suffix+'\\Installer'
    rows('Registry',[('StartMenuReg',1,key,'StartMenu','#1','StartMenuItem'),('DesktopReg',1,key,'Desktop','#1','DesktopItem')])
    rows('Feature',[('Main',None,'Lychee Desktop',None,1,1,'INSTALLDIR',0)])
    rows('FeatureComponents',[('Main','DesktopClient'),('Main','StartMenuItem'),('Main','DesktopItem')])
    cab=m.CAB('lychee.cab');index,logical=cab.append(str(exe),'Lychee.exe','LycheeExe')
    rows('File',[(logical,'DesktopClient','Lychee.exe',exe.stat().st_size,product+'.0',None,512,index)])
    icon_key=None
    if icon is not None:
        icon_key='Lychee_'+product.replace('.','_')+'.ico'
        rows('Icon',[(icon_key,m.Binary(str(Path(icon).resolve())))])
    icon_index=0 if icon_key else None
    shortcut=(('Q'+uuid.UUID(instance).hex[:7]).upper() if instance else 'LYCHEE~1')+'|Lychee Desktop'+suffix
    rows('Shortcut',[('StartLychee','ProgramMenuFolder',shortcut,'StartMenuItem','[#LycheeExe]',None,
                      '荔枝',None,icon_key,icon_index,1,'INSTALLDIR'),
                     ('DesktopLychee','DesktopFolder',shortcut if instance else 'LYCHEE~1|荔枝','DesktopItem','[#LycheeExe]',None,
                      '荔枝',None,icon_key,icon_index,1,'INSTALLDIR')])
    # Run file/registry installation before removing the old product, all before commit.
    execute=[row for row in sequence.InstallExecuteSequence if row[0] not in ('RemoveExistingProducts','LaunchConditions')]
    rows('InstallExecuteSequence',execute+policy_sequence(False)+[('UseExistingDir','LY_PREVIOUS_DIR AND (NOT INSTALLDIR OR UILevel = 5)',450),
                                          ('LaunchConditions',None,480),('InstallExecute',None,6500),('RemoveExistingProducts',None,6550)])
    for table in ('AdminExecuteSequence','AdvtExecuteSequence'):
        rows(table,getattr(sequence,table))
    rows('AdminUISequence',[item for item in sequence.AdminUISequence if item[0] not in ('FatalError','UserExit','ExitDialog')])
    add_dialogs(db)
    cab.commit(db);db.Commit()
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('exe',type=Path);p.add_argument('msi',type=Path)
    from build_identity import WINDOWS_VERSION
    p.add_argument('--version',default=WINDOWS_VERSION)
    p.add_argument('--qa-instance');p.add_argument('--icon',type=Path)
    a=p.parse_args();build(a.exe.resolve(),a.msi.resolve(),a.version,a.qa_instance,a.icon)
