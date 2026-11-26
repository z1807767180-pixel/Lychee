"""Send only window-local input messages on a dedicated non-input desktop."""
from importlib import import_module
import sys
import time

qa = import_module('resize-hwnd')
c,w = qa.c,qa.w
is_iconic = qa.fn(qa.u,'IsIconic',w.BOOL,w.HWND)
show = qa.fn(qa.u,'ShowWindowAsync',w.BOOL,w.HWND,c.c_int)
get_title = qa.fn(qa.u,'GetWindowTextW',c.c_int,w.HWND,w.LPWSTR,c.c_int)


def find_popup(desktop, pid):
    result = []
    @qa.enum_callback
    def visit(hwnd, _):
        owner = w.DWORD()
        qa.proc_window(hwnd,c.byref(owner))
        if owner.value == pid and qa.visible(hwnd):
            name = c.create_unicode_buffer(64)
            get_title(hwnd,name,len(name))
            if name.value == '荔枝 · 消息提醒':
                result.append(hwnd)
        return True
    qa.enum(desktop,visit,0)
    return result[0] if result else None


def native_key(hwnd, shift):
    attach = qa.fn(qa.u,'AttachThreadInput',w.BOOL,w.DWORD,w.DWORD,w.BOOL)
    focus = qa.fn(qa.u,'SetFocus',w.HWND,w.HWND)
    active = qa.fn(qa.u,'SetActiveWindow',w.HWND,w.HWND)
    state = qa.fn(qa.u,'GetKeyboardState',w.BOOL,c.c_void_p)
    set_state = qa.fn(qa.u,'SetKeyboardState',w.BOOL,c.c_void_p)
    target_thread = qa.proc_window(hwnd,None)
    qa.check(attach(qa.thread(),target_thread,True))
    original = (c.c_ubyte * 256)()
    try:
        qa.check(state(original))
        active(hwnd)
        focus(hwnd)
        if qa.info(target_thread).focus != hwnd:
            raise RuntimeError('Native test HWND did not receive focus')
        keys = (c.c_ubyte * 256)()
        keys[0xA2] = keys[0x11] = 0x80
        if shift:
            keys[0xA0] = keys[0x10] = 0x80
        qa.check(set_state(keys))
        qa.check(qa.post(hwnd,0x100,0x51,0x00100001))
        time.sleep(.20)
        qa.post(hwnd,0x101,0x51,0xC0100001)
        time.sleep(.06)
    finally:
        set_state(original)
        qa.check(attach(qa.thread(),target_thread,False))


def point(x,y):
    return ((y & 65535) << 16) | (x & 65535)


def pointer_drags(hwnd):
    tid = qa.proc_window(hwnd,None)
    rows = []
    for name,expected,dx,dy in qa.directions:
        qa.check(qa.position(hwnd,None,160,140,720,500,0x0014))
        time.sleep(.12)
        left,top,right,bottom = qa.bounds(hwnd)
        x = left+2 if dx<0 else right-3 if dx>0 else (left+right)//2
        y = top+2 if dy<0 else bottom-3 if dy>0 else (top+bottom)//2
        target = qa.hit_window(w.POINT(x,y))
        if not target or qa.ancestor(target,2) != hwnd:
            raise RuntimeError('Drag is outside this test window')
        hit = qa.send(target,0x84,0,point(x,y))
        row = dict(edge=name,hit=hit,expected=expected)
        if hit != expected:
            rows.append(row)
            continue
        qa.check(qa.post(target,0x00a1,expected,point(x,y)))  # native WM_NCLBUTTONDOWN
        end = time.monotonic()+.75
        while time.monotonic()<end and not qa.info(tid).flags & 2:
            time.sleep(.015)
        inside = qa.info(tid)
        row['nativeSizing'] = bool(inside.flags & 2)
        capture = inside.capture or hwnd
        before = qa.bounds(hwnd)
        if row['nativeSizing']:
            for offset in (8,16,24):
                pos = w.POINT(x - dx*offset, y - dy*offset)
                qa.check(qa.post(capture,0x0200,1,point(pos.x,pos.y)))
                time.sleep(.05)
            qa.post(capture,0x0202,0,point(pos.x,pos.y))
            time.sleep(.12)
            if qa.info(tid).flags & 2:
                qa.post(hwnd,0x0100,0x0d,1)
                time.sleep(.08)
        after = qa.bounds(hwnd)
        row['delta'] = [b-a for a,b in zip(before,after)]
        delta = row['delta']
        # Windows can snap a top-edge drag to the work area's height. Require a
        # change on every edge selected by the pointer and no orthogonal drift.
        row['selectedEdgesMoved'] = (
            (delta[0] != 0 if dx<0 else delta[2] != 0 if dx>0 else delta[0] == delta[2] == 0) and
            (delta[1] != 0 if dy<0 else delta[3] != 0 if dy>0 else delta[1] == delta[3] == 0))
        rows.append(row)
    return rows


def probe(desktop,pid):
    hwnd = qa.locate(desktop,pid)
    for line in sys.stdin:
        cmd = line.strip()
        if cmd == 'end':
            break
        if cmd == 'restore':
            show(hwnd,9)
            time.sleep(.15)
        elif cmd.startswith('key-'):
            target = find_popup(desktop,pid) if 'popup' in cmd else hwnd
            if not target:
                raise RuntimeError('Expected a native popup')
            native_key(target, 'shift' in cmd)
        elif cmd == 'small':
            dpi = qa.fn(qa.u,'GetDpiForWindow',w.UINT,w.HWND)(hwnd)
            # WM_GETMINMAXINFO returns the actual tracking limits, in screen pixels.
            limits = (w.POINT * 5)()
            qa.send(hwnd,0x24,0,c.addressof(limits))
            width,height = limits[3].x,limits[3].y
            qa.check(qa.position(hwnd,None,160,140,width,height,0x0014))
            time.sleep(.2)
            qa.emit({'dpi':dpi,'minTrack':[width,height],'rect':qa.bounds(hwnd)})
            continue
        elif cmd == 'drag':
            qa.emit({'drag':pointer_drags(hwnd)})
            continue
        elif cmd != 'state':
            raise ValueError(cmd)
        qa.emit({'iconic':bool(is_iconic(hwnd)), 'popup':bool(find_popup(desktop,pid))})
    return []


if __name__ == '__main__':
    qa.main(probe_fn=probe,background_flags=False)
