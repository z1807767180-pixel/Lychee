"""Win32 probe for the one test child on a newly created non-input desktop."""
import ctypes as c
from ctypes import wintypes as w
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid

u=c.WinDLL('user32',use_last_error=True)
k=c.WinDLL('kernel32',use_last_error=True)
def fn(d,name,result,*args):
    proc=getattr(d,name);proc.argtypes=args;proc.restype=result
    return proc
class SI(c.Structure):
    _fields_=[('cb',w.DWORD),('lpReserved',w.LPWSTR),('lpDesktop',w.LPWSTR),('lpTitle',w.LPWSTR),
              *[(f,w.DWORD) for f in ('dwX','dwY','dwXSize','dwYSize','dwXCountChars','dwYCountChars','dwFillAttribute','dwFlags')],
              ('wShowWindow',w.WORD),('cbReserved2',w.WORD),('lpReserved2',c.c_void_p),
              ('hStdInput',w.HANDLE),('hStdOutput',w.HANDLE),('hStdError',w.HANDLE)]
class PI(c.Structure):
    _fields_=[('hProcess',w.HANDLE),('hThread',w.HANDLE),('pid',w.DWORD),('tid',w.DWORD)]
class GUI(c.Structure):
    _fields_=[('cbSize',w.DWORD),('flags',w.DWORD),*[(n,w.HWND) for n in ('active','focus','capture','menu','move','caret')],('caretRc',w.RECT)]
create_desktop=fn(u,'CreateDesktopW',w.HANDLE,w.LPCWSTR,c.c_void_p,c.c_void_p,w.DWORD,w.DWORD,c.c_void_p)
set_desktop=fn(u,'SetThreadDesktop',w.BOOL,w.HANDLE)
get_desktop=fn(u,'GetThreadDesktop',w.HANDLE,w.DWORD)
input_desktop=fn(u,'OpenInputDesktop',w.HANDLE,w.DWORD,w.BOOL,w.DWORD)
desk_name=fn(u,'GetUserObjectInformationW',w.BOOL,w.HANDLE,c.c_int,c.c_void_p,w.DWORD,c.POINTER(w.DWORD))
close_desktop=fn(u,'CloseDesktop',w.BOOL,w.HANDLE)
create=fn(k,'CreateProcessW',w.BOOL,w.LPCWSTR,w.LPWSTR,c.c_void_p,c.c_void_p,w.BOOL,w.DWORD,c.c_void_p,w.LPCWSTR,c.POINTER(SI),c.POINTER(PI))
close=fn(k,'CloseHandle',w.BOOL,w.HANDLE)
terminate=fn(k,'TerminateProcess',w.BOOL,w.HANDLE,w.UINT)
wait=fn(k,'WaitForSingleObject',w.DWORD,w.HANDLE,w.DWORD)
thread=fn(k,'GetCurrentThreadId',w.DWORD)
proc_window=fn(u,'GetWindowThreadProcessId',w.DWORD,w.HWND,c.POINTER(w.DWORD))
enum_callback=c.WINFUNCTYPE(w.BOOL,w.HWND,w.LPARAM)
enum=fn(u,'EnumDesktopWindows',w.BOOL,w.HANDLE,enum_callback,w.LPARAM)
visible=fn(u,'IsWindowVisible',w.BOOL,w.HWND)
classname=fn(u,'GetClassNameW',c.c_int,w.HWND,w.LPWSTR,c.c_int)
rect=fn(u,'GetWindowRect',w.BOOL,w.HWND,c.POINTER(w.RECT))
hit_window=fn(u,'WindowFromPoint',w.HWND,w.POINT)
ancestor=fn(u,'GetAncestor',w.HWND,w.HWND,w.UINT)
post=fn(u,'PostMessageW',w.BOOL,w.HWND,w.UINT,w.WPARAM,w.LPARAM)
message=fn(u,'SendMessageTimeoutW',w.LPARAM,w.HWND,w.UINT,w.WPARAM,w.LPARAM,w.UINT,w.UINT,c.POINTER(c.c_size_t))
position=fn(u,'SetWindowPos',w.BOOL,w.HWND,w.HWND,c.c_int,c.c_int,c.c_int,c.c_int,w.UINT)
gui=fn(u,'GetGUIThreadInfo',w.BOOL,w.DWORD,c.POINTER(GUI))

def check(ok):
    if not ok: raise c.WinError(c.get_last_error())
def object_name(handle):
    size=w.DWORD();buf=c.create_unicode_buffer(256)
    check(desk_name(handle,2,buf,c.sizeof(buf),c.byref(size)))
    return buf.value
def active_desktop_name():
    handle=input_desktop(0,False,1)
    if not handle: return None
    try: return object_name(handle)
    finally: close_desktop(handle)
def class_of(hwnd):
    buf=c.create_unicode_buffer(256);classname(hwnd,buf,256);return buf.value.split(';')[0]
def bounds(hwnd):
    r=w.RECT();check(rect(hwnd,c.byref(r)));return [r.left,r.top,r.right,r.bottom]
def send(hwnd,msg,wp,lp):
    result=c.c_size_t();check(message(hwnd,msg,wp,lp,2,1700,c.byref(result)))
    return c.c_ssize_t(result.value).value
def locate(d,pid):
    result=[]
    @enum_callback
    def inspect(hwnd,_):
        owner=w.DWORD();proc_window(hwnd,c.byref(owner))
        if owner.value==pid and visible(hwnd) and 'HwndWrapper' in class_of(hwnd): result.append(hwnd)
        return True
    enum(d,inspect,0)
    if len(result)!=1:raise RuntimeError('Expected exactly one WPF window: '+str(len(result)))
    return result[0]
def info(tid):
    g=GUI();g.cbSize=c.sizeof(g);check(gui(tid,c.byref(g)));return g
directions=[('left',10,-1,0),('right',11,1,0),('top',12,0,-1),('topLeft',13,-1,-1),
            ('topRight',14,1,-1),('bottom',15,0,1),('bottomLeft',16,-1,1),('bottomRight',17,1,1)]
def probe(d,pid):
    hwnd=locate(d,pid);tid=proc_window(hwnd,None);start=bounds(hwnd);results=[]
    # Leave space above and below to prevent Windows Aero's full-height snap.
    start=[start[0],start[1]+100,start[2],start[3]-100]
    for name,expected,dx,dy in directions:
        left,top,right,bottom=start
        check(position(hwnd,None,left,top,right-left,bottom-top,0x0014));time.sleep(.12)
        before=bounds(hwnd)
        x=left+2 if dx<0 else right-3 if dx>0 else (left+right)//2
        y=top+2 if dy<0 else bottom-3 if dy>0 else (top+bottom)//2
        lp=((y&65535)<<16)|(x&65535)
        target=hit_window(w.POINT(x,y))
        if not target or ancestor(target,2)!=hwnd:raise RuntimeError('Probe point is outside the test window.')
        actual=send(target,0x84,0,lp);top_hit=send(hwnd,0x84,0,lp)
        row={'edge':name,'expectedHit':expected,'point':[x,y],'windowAtPoint':class_of(target),
             'hit':actual,'topLevelHit':top_hit,'before':before,'nativeSizing':False,'changed':False}
        if actual==expected:
            # Start the same native non-client operation selected by this point.
            check(post(target,0x00a1,expected,lp))
            until=time.monotonic()+.65
            while time.monotonic()<until:
                if info(tid).flags&2:break
                time.sleep(.015)
            row['nativeSizing']=bool(info(tid).flags&2)
            if row['nativeSizing']:
                # Aim toward the centre. Only this child HWND receives these messages.
                row['during']=[bounds(hwnd)]
                for key in ([0x27] if dx<0 else [0x25] if dx>0 else [])+([0x28] if dy<0 else [0x26] if dy>0 else []):
                    check(post(hwnd,0x100,key,1));time.sleep(.08);row['during'].append(bounds(hwnd))
                check(post(hwnd,0x100,0x0d,1));time.sleep(.12)
            else: post(hwnd,0x1f,0,0)
        after=bounds(hwnd);row['after']=after
        reference=row.get('during',[before])[0]
        delta=[b-a for a,b in zip(reference,after)]
        row['delta']=delta
        # Sizing a left boundary may grow or shrink the width. Require that the
        # exact selected coordinate(s) change and all opposite coordinates stay fixed.
        row['changed']=(row['nativeSizing'] and
            ((dx<0 and delta[0]!=0 and delta[2]==0)or(dx>0 and delta[2]!=0 and delta[0]==0)or(dx==0 and delta[0]==delta[2]==0)) and
            ((dy<0 and delta[1]!=0 and delta[3]==0)or(dy>0 and delta[3]!=0 and delta[1]==0)or(dy==0 and delta[1]==delta[3]==0)))
        results.append(row)
    return results
def emit(payload):print(json.dumps(payload,ensure_ascii=True),flush=True)
def main(probe_fn=probe, background_flags=True):
    exe,origin,debug=sys.argv[1:]
    official=origin=='isolated-public-update'
    if official:
        profile=Path(os.environ.get('WEBVIEW2_USER_DATA_FOLDER','')).resolve()
        run_root=Path(os.environ['TEMP']).resolve().parent
        if (profile!=run_root/'profile' or Path(exe).resolve().parent!=run_root or
                not run_root.name.startswith('lychee-social-wpf-') or profile.is_symlink()):
            raise ValueError('Expected an isolated executable and WebView2 profile')
    elif not origin.startswith('http://127.0.0.1:') or not origin[17:].isdigit():raise ValueError('Loopback required')
    fn(u,'SetProcessDpiAwarenessContext',w.BOOL,c.c_void_p)(c.c_void_p(-4))
    old=get_desktop(thread());name='LycheeResizeQA_'+uuid.uuid4().hex
    d=create_desktop(name,None,None,0,0x01ff,None);check(d)
    active_name=active_desktop_name()
    if name==active_name:raise RuntimeError('Cannot use input desktop.')
    pi=PI()
    try:
        check(set_desktop(d));si=SI();si.cb=c.sizeof(si);si.lpDesktop=name
        os.environ['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS']=(f'--remote-debugging-port={int(debug)} --no-sandbox --disable-gpu --no-proxy-server --disable-background-networking '
            '--host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"')
        if background_flags:
            os.environ['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS']+=' --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --disable-features=CalculateNativeWinOcclusion'
        argv=c.create_unicode_buffer(subprocess.list2cmdline([exe] if official else [exe,'--test-local',origin]))
        check(create(exe,argv,None,None,False,0,None,str(Path(exe).parent),c.byref(si),c.byref(pi)))
        emit({'started':pi.pid,'privateDesktop':object_name(d),'inputDesktop':active_name})
        if sys.stdin.readline().strip()!='probe':return
        result=probe_fn(d,pi.pid);current=active_desktop_name()
        if current==name:raise RuntimeError('Test desktop became the input desktop.')
        emit({'edges':result,'inputDesktopAfter':current})
    finally:
        if pi.hProcess:
            if wait(pi.hProcess,0)==258:terminate(pi.hProcess,0);wait(pi.hProcess,3000)
            close(pi.hThread);close(pi.hProcess)
        set_desktop(old);close_desktop(d)
if __name__=='__main__':main()
