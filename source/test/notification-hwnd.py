"""Check for unexpected notification HWNDs on the existing isolated desktop test harness."""
from importlib import import_module
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
        if command == "restore":
            qa.fn(qa.u, "ShowWindow", qa.w.BOOL, qa.w.HWND, qa.c.c_int)(main, 9)
            qa.fn(qa.u, "SetForegroundWindow", qa.w.BOOL, qa.w.HWND)(main)
            qa.emit({"restored": not is_minimized(main)})
            continue
        if command != "popup":
            raise ValueError(command)
        deadline = time.monotonic() + 1.5
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
    return []


if __name__ == "__main__":
    qa.main(probe_fn=probe, background_flags=False)
