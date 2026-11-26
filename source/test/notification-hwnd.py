"""Observe the actual popup HWND on the existing isolated desktop test harness."""
from importlib import import_module
from pathlib import Path
import base64
import os
import sys
import time

qa = import_module("resize-hwnd")
get_text = qa.fn(qa.u, "GetWindowTextW", qa.c.c_int, qa.w.HWND, qa.w.LPWSTR, qa.c.c_int)
is_minimized = qa.fn(qa.u, "IsIconic", qa.w.BOOL, qa.w.HWND)


def probe(desktop, pid):
    main = qa.locate(desktop, pid)
    for command in sys.stdin:
        command = command.strip()
        if command == "end":
            return []
        if command == "minimized":
            qa.emit({"minimized": bool(is_minimized(main))})
            continue
        if command != "popup":
            raise ValueError(command)
        deadline = time.monotonic() + 22
        found = []
        @qa.enum_callback
        def inspect(hwnd, _):
            owner = qa.w.DWORD()
            qa.proc_window(hwnd, qa.c.byref(owner))
            if owner.value == pid and qa.visible(hwnd):
                title = qa.c.create_unicode_buffer(80)
                get_text(hwnd, title, len(title))
                if title.value == "荔枝 · 消息提醒":
                    found.append(hwnd)
            return True
        while not found and time.monotonic() < deadline:
            qa.enum(desktop, inspect, 0)
            time.sleep(.04)
        qa.emit({"popup": bool(found), "minimized": bool(is_minimized(main))})
        if found:
            # Native UI Automation Invoke on the popup's actual button. The
            # launcher places the PowerShell probe on this same private desktop.
            script = """
Add-Type -AssemblyName UIAutomationClient
$ErrorActionPreference='Stop'
$window=[Windows.Automation.AutomationElement]::FromHandle([IntPtr]HANDLE)
$type=[Windows.Automation.ControlType]::Button
$filter=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty,$type)
$button=$window.FindFirst([Windows.Automation.TreeScope]::Descendants,$filter)
$button.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
""".replace("HANDLE", str(found[0]))
            # Avoid launching a visible console on the input desktop.
            shell=str(Path(os.environ['WINDIR'])/'System32/WindowsPowerShell/v1.0/powershell.exe')
            encoded=base64.b64encode(script.encode('utf-16-le')).decode('ascii')
            argv=qa.c.create_unicode_buffer(qa.subprocess.list2cmdline([shell,'-NoProfile','-NonInteractive','-EncodedCommand',encoded]))
            si=qa.SI();si.cb=qa.c.sizeof(si);si.lpDesktop=qa.object_name(desktop)
            pi=qa.PI()
            qa.check(qa.create(shell,argv,None,None,False,qa.subprocess.CREATE_NO_WINDOW,None,None,qa.c.byref(si),qa.c.byref(pi)))
            try:
                complete=qa.wait(pi.hProcess,7000)==0
                if not complete:
                    qa.terminate(pi.hProcess,1)
                exit_code=qa.w.DWORD()
                get_exit=qa.fn(qa.k,'GetExitCodeProcess',qa.w.BOOL,qa.w.HANDLE,qa.c.POINTER(qa.w.DWORD))
                qa.check(get_exit(pi.hProcess,qa.c.byref(exit_code)))
                qa.emit({"clicked":complete and exit_code.value==0,"exitCode":exit_code.value})
            finally:
                qa.close(pi.hThread);qa.close(pi.hProcess)
    return []


if __name__ == "__main__":
    qa.main(probe_fn=probe, background_flags=False)
