"""Windows Installer directory checks shared by full UI and silent execution."""
import msilib as m


# A directory property resolved by MSI ends in backslash. The second search reads
# Explorer's expanded REG_SZ even when the registered folder is currently missing.
FOLDERS = [
    ('UserDesktop', 1, 'Desktop', True),
    ('PublicDesktop', 2, 'Common Desktop', True),
    ('Documents', 1, 'Personal', False),
    ('Pictures', 1, 'My Pictures', False),
    ('Music', 1, 'My Music', False),
    ('Videos', 1, 'My Video', False),
    ('Downloads', 1, '{374DE290-123F-4565-9164-39C4925E467B}', False),
    ('PublicDocs', 2, 'Common Documents', False),
    ('PublicPics', 2, 'CommonPictures', False),
    ('PublicMusic', 2, 'CommonMusic', False),
    ('PublicVideos', 2, 'CommonVideo', False),
    ('PublicDownloads', 2, '{3D644C9B-1FB8-4F30-9B45-F670235F79C0}', False),
]


def rules():
    checks = [('Desktop', 'NOT DesktopFolder OR INSTALLDIR ~<< DesktopFolder'),
              ('NoUserFolders', 'DesktopFolder ~= LocalAppDataFolder AND DesktopFolder ~= ROOTDRIVE'),
              ('Volume', 'INSTALLDIR ~= PrimaryVolumePath OR INSTALLDIR ~= ROOTDRIVE'),
              ('UserRoot', 'INSTALLDIR ~= LyProfile OR INSTALLDIR ~= LyPublic'),
              ('System', 'INSTALLDIR ~= PersonalFolder OR INSTALLDIR ~= MyPicturesFolder OR INSTALLDIR ~= AppDataFolder OR INSTALLDIR ~= LocalAppDataFolder OR INSTALLDIR ~= CommonAppDataFolder'),
              ('Previous', 'OLDERPRODUCTS AND NOT (INSTALLDIR ~= LY_PREVIOUS_DIR OR INSTALLDIR ~= LyPreviousSlash)')]
    # A user can switch drives in a live dialog before Windows recalculates PrimaryVolumePath.
    for offset in range(0, 26, 6):
        letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[offset:offset+6]
        checks.append(('Roots'+letters[0], ' OR '.join(f'INSTALLDIR ~= "{letter}:\\"' for letter in letters)))
    for key, _, _, subtree in FOLDERS:
        op = '~<<' if subtree else '~='
        folder = 'LY_F_'+key.upper()
        raw = 'LY_RAW_'+key.upper()
        condition = f'({folder} AND INSTALLDIR {op} {folder}) OR ({raw} AND INSTALLDIR {op} LySlash{key}) OR ({raw} AND INSTALLDIR ~= {raw})'
        checks.append((key,condition))
        if subtree:
            checks.append((key+'Trailing', f'{raw} ~>> "\\" AND INSTALLDIR ~<< {raw}'))
    assert all(len(condition) < 210 for _, condition in checks)
    return checks


def add_policy(db, suffix):
    def add(table, values):
        m.add_data(db, table, values)
    add('Property', [('PRIMARYFOLDER', 'INSTALLDIR')])
    extra = ('PersonalFolder','MyPicturesFolder','AppDataFolder','CommonAppDataFolder')
    add('Directory', [(name,'TARGETDIR','.') for name in extra])
    key = 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\'
    for name, hive, value, _ in FOLDERS:
        # Directory locator expands environment variables and returns a resolved
        # path. Shell Folders supplies the already-expanded compatibility value.
        add('RegLocator', [('Live'+name,hive,key+'User Shell Folders',value,16),
                           ('Raw'+name,hive,key+'Shell Folders',value,18)])
        add('AppSearch', [('LY_F_'+name.upper(),'Live'+name),('LY_RAW_'+name.upper(),'Raw'+name)])
    add('CustomAction', [('LySetProfile',51,'LyProfile','[%USERPROFILE]\\'),
                         ('LySetPublic',51,'LyPublic','[%PUBLIC]\\'),
                         ('LySetPrevious',51,'LyPreviousSlash','[LY_PREVIOUS_DIR]\\'),
                         ('RecommendedLocation',51,'LyRecommendedDir','[LocalAppDataFolder]LycheeGardenApp'+suffix+'\\'),
                         ('PrepareLocationCheck',51,'LyLocationAllowed','Y'),
                         ('RejectLocation',19,None,'请选择独立的程序文件夹。桌面及其子目录、磁盘根目录和个人资料目录的根位置不能用于安装。'),
                         ('RejectPrevious',19,None,'旧版安装位置无法安全更新。请先在 Windows 设置的“已安装的应用”中卸载荔枝，然后重新打开本安装包。账号和使用记录会保留。')])
    add('CustomAction', [('LySet'+name,51,'LySlash'+name,'[LY_RAW_'+name.upper()+']\\') for name, *_ in FOLDERS])
    add('CustomAction', [('LyBlock'+name,51,'LyLocationAllowed','N') for name, _ in rules()])


def policy_sequence(full_ui):
    # Registered upgrades are checked before their dialog. New installations can
    # correct the path interactively; ExecuteSequence always checks its own inputs.
    applies = 'NOT Installed AND OLDERPRODUCTS' if full_ui else 'NOT Installed'
    result = [('LySetProfile',None,1021),('LySetPublic',None,1022),('LySetPrevious','LY_PREVIOUS_DIR',1023),
              ('RecommendedLocation',None,1024)]
    result.extend(('LySet'+name,'LY_RAW_'+name.upper(),1030+i) for i,(name,*_) in enumerate(FOLDERS))
    result.append(('PrepareLocationCheck',applies,1060))
    result.extend(('LyBlock'+name,applies+' AND ('+condition+')',1061+i) for i,(name,condition) in enumerate(rules()))
    result.append(('RejectPrevious','NOT Installed AND OLDERPRODUCTS AND LyLocationAllowed = "N"',1090))
    if not full_ui:
        result.append(('RejectLocation','NOT Installed AND LyLocationAllowed = "N"',1091))
    return result


def check_before_navigation(control, event, target, start):
    control.event('[LyLocationAllowed]', 'Y', ordering=start)
    for index, (_,condition) in enumerate(rules(),start+1):
        control.event('[LyLocationAllowed]', 'N', condition, ordering=index)
    control.event('SpawnDialog','LocationNotice','LyLocationAllowed = "N"',ordering=index+1)
    control.event(event,target,'LyLocationAllowed = "Y"',ordering=index+2)
