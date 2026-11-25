"""Make a per-user x64 Windows Installer from the same verified portable EXE."""
from pathlib import Path
import argparse, uuid
import msilib as m
from msilib import schema,sequence

def guid(name):
    return '{'+str(uuid.uuid5(uuid.NAMESPACE_URL,'lychee-desktop/'+name)).upper()+'}'

def build(exe,msi):
    product='6.4.7'
    db=m.init_database(str(msi),schema,'Lychee Desktop',guid('product/'+product),product,'Lychee')
    def rows(table,values):m.add_data(db,table,values)
    # ASCII database metadata works on every Windows system locale. The client UI uses Chinese.
    rows('Property',[('UpgradeCode',guid('upgrade')),('ARPNOMODIFY','1'),('ARPNOREPAIR','1'),
                      ('SecureCustomProperties','OLDERPRODUCTS;NEWERPRODUCTS')])
    rows('Upgrade',[(guid('upgrade'),None,product,None,1,None,'OLDERPRODUCTS'),(guid('upgrade'),product,None,None,2,None,'NEWERPRODUCTS')])
    rows('LaunchCondition',[('NOT NEWERPRODUCTS','A newer version of Lychee Desktop is already installed.')])
    rows('Directory',[('TARGETDIR',None,'SourceDir'),('LocalAppDataFolder','TARGETDIR','.'),
                      ('INSTALLDIR','LocalAppDataFolder','LycheeGardenApp'),('ProgramMenuFolder','TARGETDIR','.')])
    rows('Component',[('DesktopClient',guid('component/main'),'INSTALLDIR',256,None,'LycheeExe'),
                      ('StartMenuItem',guid('component/startmenu'),'ProgramMenuFolder',260,None,'StartMenuReg')])
    rows('Registry',[('StartMenuReg',1,'Software\\LycheeGardenDesktop\\Installer','StartMenu','#1','StartMenuItem')])
    rows('Feature',[('Main',None,'Lychee Desktop',None,1,1,'INSTALLDIR',0)])
    rows('FeatureComponents',[('Main','DesktopClient'),('Main','StartMenuItem')])
    cab=m.CAB('lychee.cab');index,logical=cab.append(str(exe),'Lychee.exe','LycheeExe')
    rows('File',[(logical,'DesktopClient','Lychee.exe',exe.stat().st_size,product+'.0',None,512,index)])
    rows('Shortcut',[('StartLychee','ProgramMenuFolder','LYCHEE~1|Lychee Desktop','StartMenuItem','[#LycheeExe]',None,
                      'Lychee Desktop',None,None,None,1,'INSTALLDIR')])
    for table in ('InstallExecuteSequence','AdminExecuteSequence','AdvtExecuteSequence'):
        rows(table,getattr(sequence,table))
    for table in ('InstallUISequence','AdminUISequence'):
        rows(table,[item for item in getattr(sequence,table) if item[0] not in ('FatalError','UserExit','ExitDialog')])
    cab.commit(db);db.Commit()
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('exe',type=Path);p.add_argument('msi',type=Path);a=p.parse_args();build(a.exe.resolve(),a.msi.resolve())
