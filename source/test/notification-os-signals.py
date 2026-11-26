"""Run python source/test/notification-os-signals.py --run source/.local/v7-win.

Observe only this candidate's private desktop and the candidate/system sound
session peak meters. No audio samples, input desktop, or mixer settings are used.
"""
import ctypes as c
from ctypes import wintypes as w
from hashlib import file_digest
from importlib import import_module
from pathlib import Path
import subprocess
import sys
import time
import uuid


def guid(value):
    return (c.c_byte * 16).from_buffer_copy(uuid.UUID(value).bytes_le)


def invoke(obj, index, types, *args):
    pointer = c.c_void_p
    method = c.cast(obj, c.POINTER(c.POINTER(pointer))).contents[index]
    return c.WINFUNCTYPE(c.c_long, pointer, *types)(method)(obj, *args)


def release(obj):
    if obj:
        invoke(obj, 2, [])


class Audio:
    enum_iid = 'A95664D2-9614-4F35-A746-DE8DB63617E6'
    enum_class = 'BCDE0395-E52F-467C-8E3D-C4579291692E'
    manager_iid = '77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F'
    session_iid = 'BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D'
    meter_iid = 'C02216F6-8C67-4B5B-9D00-D008E73E0064'

    def __init__(self, pid):
        self.pid = pid
        self.enum, self.device, self.manager = (c.c_void_p() for _ in range(3))
        self.peaks = {}
        self.error = None
        self.initialized = False
        try:
            self.checked(c.windll.ole32.CoInitializeEx(None, 0))
            self.initialized = True
        except OSError as exc:
            # pywin32 may already have initialized the thread with another model.
            if exc.errno != 0x80010106:
                self.error = str(exc)
                return
        try:
            self.checked(c.windll.ole32.CoCreateInstance(c.byref(guid(self.enum_class)),
                         None, 1, c.byref(guid(self.enum_iid)), c.byref(self.enum)))
            self.checked(invoke(self.enum, 4, [c.c_int, c.c_int, c.c_void_p],
                         0, 1, c.byref(self.device)))
            self.checked(invoke(self.device, 3, [c.c_void_p, w.DWORD, c.c_void_p, c.c_void_p],
                         c.byref(guid(self.manager_iid)), 23, None, c.byref(self.manager)))
        except OSError as exc:
            self.error = str(exc)

    @staticmethod
    def checked(hr):
        if hr < 0:
            raise OSError(hr & 0xffffffff, f'HRESULT 0x{hr & 0xffffffff:08x}')

    def sample(self):
        if self.error:
            return
        sessions = c.c_void_p()
        try:
            self.checked(invoke(self.manager, 5, [c.c_void_p], c.byref(sessions)))
            count = c.c_int()
            self.checked(invoke(sessions, 3, [c.c_void_p], c.byref(count)))
            for index in range(count.value):
                session, control, meter = (c.c_void_p() for _ in range(3))
                try:
                    if invoke(sessions, 4, [c.c_int, c.c_void_p], index, c.byref(session)) < 0:
                        continue
                    if invoke(session, 0, [c.c_void_p, c.c_void_p],
                              c.byref(guid(self.session_iid)), c.byref(control)) < 0:
                        continue
                    process = w.DWORD()
                    system = invoke(control, 15, []) == 0
                    if not system and (invoke(control, 14, [c.c_void_p], c.byref(process)) < 0
                                       or process.value != self.pid):
                        continue
                    key = 'systemSounds' if system else 'candidate'
                    if invoke(session, 0, [c.c_void_p, c.c_void_p],
                              c.byref(guid(self.meter_iid)), c.byref(meter)) >= 0:
                        peak = c.c_float()
                        if invoke(meter, 3, [c.c_void_p], c.byref(peak)) >= 0:
                            self.peaks[key] = max(self.peaks.get(key, 0.0), peak.value)
                finally:
                    for obj in (meter, control, session):
                        release(obj)
        except OSError as exc:
            self.error = str(exc)
        finally:
            release(sessions)

    def close(self):
        for obj in (self.manager, self.device, self.enum):
            release(obj)
        if self.initialized:
            c.windll.ole32.CoUninitialize()


def observed(desktop, pid):
    import win32api
    import win32con
    import win32gui
    native = import_module('notification-hwnd')
    qa = native.qa
    target = qa.locate(desktop, pid)
    shell_message = win32gui.RegisterWindowMessage('SHELLHOOK')
    flashed = []
    desktop_taskbars = []

    @qa.enum_callback
    def find_taskbar(hwnd, _):
        if qa.class_of(hwnd) in ('Shell_TrayWnd', 'Shell_SecondaryTrayWnd'):
            desktop_taskbars.append(hwnd)
        return True

    qa.enum(desktop, find_taskbar, 0)
    with Path(sys.argv[1]).open('rb') as executable:
        candidate_hash = file_digest(executable, 'sha256').hexdigest()

    def receive(hwnd, msg, wp, lp):
        if msg == shell_message and wp == 0x8006:  # HSHELL_FLASH
            flashed.append(lp)
        return win32gui.DefWindowProc(hwnd, msg, wp, lp)

    cls = win32gui.WNDCLASS()
    cls.lpszClassName = 'LycheeSignalObserver' + uuid.uuid4().hex
    cls.hInstance = win32api.GetModuleHandle(None)
    cls.lpfnWndProc = receive
    atom = win32gui.RegisterClass(cls)

    def window():
        return win32gui.CreateWindowEx(win32con.WS_EX_APPWINDOW, atom, '', win32con.WS_OVERLAPPEDWINDOW,
                                       0, 0, 100, 100, 0, 0, cls.hInstance, None)

    observer, control = window(), window()
    hook = qa.fn(qa.u, 'RegisterShellHookWindow', w.BOOL, w.HWND)
    unhook = qa.fn(qa.u, 'DeregisterShellHookWindow', w.BOOL, w.HWND)
    shell_registered = bool(hook(observer))
    audio = Audio(pid)

    def sample_for(seconds):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            win32gui.PumpWaitingMessages()
            audio.sample()
            time.sleep(.012)

    class Flash(c.Structure):
        _fields_ = [('size', w.UINT), ('hwnd', w.HWND), ('flags', w.DWORD),
                    ('count', w.UINT), ('timeout', w.DWORD)]

    emit, enum = qa.emit, qa.enum
    baseline = {}
    try:
        win32gui.ShowWindow(control, win32con.SW_SHOWNOACTIVATE)
        flash = Flash(c.sizeof(Flash), control, 2, 1, 100)
        qa.fn(qa.u, 'FlashWindowEx', w.BOOL, c.POINTER(Flash))(c.byref(flash))
        sample_for(.4)

        def inspect(*args):
            win32gui.PumpWaitingMessages()
            audio.sample()
            return enum(*args)

        def report(row):
            if 'minimized' in row and 'popup' not in row and row['minimized']:
                audio.peaks.clear()
                sample_for(.6)
                baseline.update(audio.peaks)
                audio.peaks.clear()
                flashed[:] = [hwnd for hwnd in flashed if hwnd == control]
            if 'popup' in row:
                sample_for(1.5)
                row['osSignals'] = {
                    'exeSha256': candidate_hash,
                    'explorerTaskbarsOnPrivateDesktop': len(desktop_taskbars),
                    'shellHookRegistered': shell_registered,
                    'shellPositiveControl': flashed.count(control),
                    'candidateShellFlashes': flashed.count(target),
                    'audioBaselinePeak': baseline,
                    'audioNotificationPeak': dict(audio.peaks),
                    'audioError': audio.error,
                }
            emit(row)

        qa.enum, qa.emit = inspect, report
        return native.probe(desktop, pid)
    finally:
        qa.enum, qa.emit = enum, emit
        audio.close()
        if shell_registered:
            unhook(observer)
        for hwnd in (control, observer):
            win32gui.DestroyWindow(hwnd)
        win32gui.UnregisterClass(cls.lpszClassName, cls.hInstance)


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--run':
        base = Path(__file__).resolve().parent
        script = (base / 'notification-window.mjs').read_text(encoding='utf-8')
        old = "'./notification-hwnd.py'"
        if script.count(old) != 1:
            raise RuntimeError('Notification harness helper entry changed')
        script = script.replace(old, "'./notification-os-signals.py'")
        sys.exit(subprocess.run(['node', '--input-type=module', '-', str(Path(sys.argv[2]).resolve())],
                                cwd=base, input=script.encode('utf-8')).returncode)
    import_module('resize-hwnd').main(probe_fn=observed, background_flags=False)
