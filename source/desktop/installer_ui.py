"""Simplified Chinese dialogs for the native Windows Installer client."""
import ctypes as c
from pathlib import Path
import tempfile

import msilib as m
from msilib import sequence


from installer_location import check_before_navigation, policy_sequence


def chinese_database(db, package):
    db.Close()
    # _ForceCodepage must be imported before inserting any localized table strings.
    api = c.WinDLL('msi')
    handle = c.c_uint()
    def check(code):
        if code:
            raise OSError(code, '设置 MSI 中文代码页失败')
    with tempfile.TemporaryDirectory() as temp:
        Path(temp, 'codepage.idt').write_bytes(b'\r\n\r\n936\t_ForceCodepage\r\n')
        check(api.MsiOpenDatabaseW(str(package), c.c_void_p(1), c.byref(handle)))
        try:
            check(api.MsiDatabaseImportW(handle, temp, 'codepage.idt'))
            check(api.MsiDatabaseCommit(handle))
        finally:
            api.MsiCloseHandle(handle)
    db = m.OpenDatabase(str(package), m.MSIDBOPEN_TRANSACT)
    summary = db.GetSummaryInformation(3)
    summary.SetProperty(m.PID_CODEPAGE, 936)
    summary.SetProperty(m.PID_TEMPLATE, 'x64;2052')
    summary.SetProperty(m.PID_TITLE, '荔枝安装程序')
    summary.Persist()
    db.OpenView("UPDATE `Property` SET `Value`='2052' WHERE `Property`='ProductLanguage'").Execute(None)
    return db


def add_dialogs(db):
    m.add_data(db, 'TextStyle', [('LyFont', 'Microsoft YaHei UI', 9, 0, 0),
                                 ('LyTitle', 'Microsoft YaHei UI', 14, 0, 1)])
    m.add_data(db, 'Property', [('DefaultUIFont', 'LyFont'), ('ErrorDialog', 'ErrorDlg')])

    def page(name, title, first, default, cancel, modal=True):
        dlg = m.Dialog(db, name, 50, 50, 350, 190, 3 if modal else 1,
                       '荔枝安装程序', first, default, cancel)
        dlg.text('Title', 15, 10, 320, 24, 3, '{\\LyTitle}' + title)
        dlg.line('TopLine', 0, 38, 350, 1)
        return dlg

    def button(dlg, name, text, x, next_control, width=64):
        return dlg.pushbutton(name, x, 160, width, 18, 3, text, next_control)

    for name, title, fresh in [('InstallDlg', '安装荔枝', True), ('UpgradeDlg', '更新荔枝', False)]:
        first = 'Browse' if fresh else 'Install'
        dlg = page(name, title, first, 'Install', 'Cancel')
        dlg.text('Info', 15, 51, 320, 28, 3,
                 '安装后，可从桌面或开始菜单打开荔枝。' if fresh else '将在原位置更新，保留现有账号和使用记录。')
        dlg.text('Label', 15, 87, 60, 13, 3, '安装位置')
        dlg.text('Location', 15, 104, 318, 40, 3, '[INSTALLDIR]')
        if fresh:
            browse = button(dlg, 'Browse', '更改位置…', 15, 'Install', 78)
            browse.event('[LyPreviousDir]', '[INSTALLDIR]', ordering=1)
            browse.event('NewDialog', 'BrowseDlg', ordering=2)
        install = button(dlg, 'Install', '安装' if fresh else '更新', 197, 'Cancel')
        check_before_navigation(install,'EndDialog','Return',1)
        button(dlg, 'Cancel', '取消', 270, first).event('SpawnDialog', 'CancelDlg')

    dlg = page('BrowseDlg', '选择安装位置', 'Drive', 'Choose', 'Back')
    dlg.control('Drive', 'DirectoryCombo', 15, 45, 252, 16, 3|131072|262144,
                'INSTALLDIR', None, 'Up', None)
    dlg.pushbutton('Up', 273, 45, 61, 17, 3, '上一级', 'Folders').event('DirectoryListUp', '0')
    dlg.control('Folders', 'DirectoryList', 15, 65, 319, 54, 3, 'INSTALLDIR', None, 'Path', None)
    dlg.text('Label', 15, 124, 50, 14, 3, '完整路径')
    dlg.control('Path', 'PathEdit', 68, 121, 266, 22, 3, 'INSTALLDIR', None, 'Choose', None)
    choose = button(dlg, 'Choose', '使用此位置', 184, 'Back', 77)
    choose.event('SetTargetPath', 'INSTALLDIR', ordering=1)
    check_before_navigation(choose,'NewDialog','InstallDlg',2)
    back = button(dlg, 'Back', '返回', 270, 'Drive')
    back.event('[INSTALLDIR]', '[LyPreviousDir]', ordering=1)
    back.event('SetTargetPath', 'INSTALLDIR', ordering=2)
    back.event('NewDialog', 'InstallDlg', ordering=3)

    dlg = page('LocationNotice', '请更换安装位置', 'Back', 'Back', 'Back')
    dlg.text('Info', 15, 48, 320, 46, 3, '请选择独立的程序文件夹。桌面及其子目录、磁盘根目录和个人资料目录的根位置不能用于安装。')
    dlg.text('Path', 15, 99, 320, 49, 3, '推荐位置：[LyRecommendedDir]')
    button(dlg, 'Back', '重新选择', 263, 'Back', 71).event('EndDialog', 'Return')

    dlg = page('MaintenanceDlg', '荔枝已安装', 'Open', 'Open', 'Cancel')
    dlg.text('Info', 15, 50, 321, 31, 3, '可以直接打开荔枝，也可以修复程序文件和快捷方式。')
    dlg.text('Location', 15, 90, 320, 48, 3, '安装位置：[INSTALLDIR]')
    launch = button(dlg, 'Open', '打开荔枝', 113, 'Repair', 70)
    launch.event('[LY_OPEN_ONLY]', '1', ordering=1)
    launch.event('DoAction', 'LaunchLychee', ordering=2)
    launch.event('EndDialog', 'Return', ordering=3)
    repair = button(dlg, 'Repair', '修复安装', 191, 'Cancel', 70)
    repair.event('ReinstallMode', 'amus', ordering=1)
    repair.event('Reinstall', 'ALL', ordering=2)
    repair.event('EndDialog', 'Return', ordering=3)
    button(dlg, 'Cancel', '关闭', 270, 'Open').event('SpawnDialog', 'CancelDlg')

    dlg = page('RemoveDlg', '卸载荔枝', 'Remove', 'Back', 'Back')
    dlg.text('Info', 15, 59, 320, 48, 3, '要移除这份荔枝程序及其快捷方式吗？')
    button(dlg, 'Remove', '卸载', 197, 'Back').event('EndDialog', 'Return')
    button(dlg, 'Back', '取消', 270, 'Remove').event('EndDialog', 'Exit')

    dlg = page('ProgressDlg', '正在处理', 'Cancel', 'Cancel', 'Cancel', modal=False)
    dlg.text('Status', 15, 62, 320, 40, 3, 'Windows 正在处理程序文件和快捷方式。')
    dlg.control('Progress', 'ProgressBar', 15, 109, 319, 12, 1,
                None, None, None, None).mapping('SetProgress', 'Progress')
    button(dlg, 'Cancel', '取消', 270, 'Cancel').event('SpawnDialog', 'CancelDlg')

    dlg = page('CancelDlg', '取消本次操作？', 'Continue', 'Continue', 'Continue')
    dlg.text('Info', 15, 59, 320, 45, 3, '可以继续当前操作，或退出安装程序。')
    button(dlg, 'Continue', '继续', 187, 'Stop').event('EndDialog', 'Return')
    button(dlg, 'Stop', '退出安装', 259, 'Continue', 75).event('EndDialog', 'Exit')

    dlg = page('ExitDialog', '操作完成', 'Done', 'Done', 'Done')
    location = dlg.text('Location', 15, 57, 320, 67, 3, '荔枝已就绪。安装位置：[INSTALLDIR]')
    location.condition('Hide', 'REMOVE ~= "ALL"')
    removed = dlg.text('Removed', 15, 57, 320, 67, 1, '荔枝程序及其快捷方式已移除。')
    removed.condition('Hide', 'NOT (REMOVE ~= "ALL")')
    launch = button(dlg, 'Open', '打开荔枝', 190, 'Done', 70)
    launch.condition('Hide', 'REMOVE ~= "ALL"')
    launch.event('DoAction', 'LaunchLychee', ordering=1)
    launch.event('EndDialog', 'Return', ordering=2)
    button(dlg, 'Done', '完成', 270, 'Open').event('EndDialog', 'Return')
    for name, title, detail in [('FatalError', '操作未完成', 'Windows 未能完成操作。请检查文件夹权限，关闭正在运行的荔枝后重试。'),
                                ('UserExit', '已取消', '你可以随时重新打开安装包。')]:
        dlg = page(name, title, 'Close', 'Close', 'Close')
        dlg.text('Info', 15, 55, 320, 65, 3, detail)
        button(dlg, 'Close', '关闭', 270, 'Close').event('EndDialog', 'Return')

    # Windows Installer shows the message corresponding to the error record.
    dlg = page('ErrorDlg', 'Windows 安装提示', 'ErrorText', None, None)
    dlg.text('ErrorText', 15, 48, 320, 94, 3, '')
    for control, label in [('Yes','是'),('Abort','终止'),('Cancel','取消'),('Ignore','忽略'),
                           ('No','否'),('Ok','确定'),('Retry','重试')]:
        dlg.pushbutton(control, 149, 160, 52, 18, 3, label, None).event('EndDialog', 'Error'+control)

    # All interaction and launches are client-UI events; /qn has no launch action.
    rows = []
    for action, condition, order in sequence.InstallUISequence:
        if action in ('ExitDialog','UserExit','FatalError'):
            continue
        if action == 'ExecuteAction':
            condition = 'NOT LY_OPEN_ONLY'
        if action == 'LaunchConditions':
            order = 480
        rows.append((action,condition,order))
    rows.extend(policy_sequence(True))
    rows.extend([
        ('UseExistingDir', 'LY_PREVIOUS_DIR AND (NOT INSTALLDIR OR UILevel = 5)', 450),
        ('InstallDlg','UILevel = 5 AND NOT Installed AND NOT OLDERPRODUCTS', 1240),
        ('UpgradeDlg','UILevel = 5 AND NOT Installed AND OLDERPRODUCTS', 1241),
        ('MaintenanceDlg','UILevel = 5 AND Installed AND NOT REMOVE AND NOT REINSTALL', 1242),
        ('RemoveDlg','UILevel = 5 AND Installed AND REMOVE ~= "ALL"', 1243),
        ('ProgressDlg','UILevel = 5 AND NOT LY_OPEN_ONLY', 1260),
        ('ExitDialog','UILevel = 5 AND NOT LY_OPEN_ONLY', -1),
        ('UserExit','UILevel = 5', -2), ('FatalError','UILevel = 5', -3),
    ])
    m.add_data(db, 'InstallUISequence', rows)
