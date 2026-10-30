using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32;

partial class WindowsBridge {
  [DllImport("user32.dll",EntryPoint="ShowWindowAsync")] static extern bool ManagementShow(IntPtr window,int command);
  [DllImport("user32.dll",EntryPoint="SetWindowPos",SetLastError=true)] static extern bool ManagementMove(IntPtr window,IntPtr after,int x,int y,int width,int height,uint flags);
  [DllImport("user32.dll",EntryPoint="PostMessageW",SetLastError=true)] static extern bool ManagementPost(IntPtr window,uint message,IntPtr wParam,IntPtr lParam);
  [DllImport("user32.dll",EntryPoint="AttachThreadInput")] static extern bool ManagementAttach(uint from,uint to,bool attach);
  [DllImport("kernel32.dll",EntryPoint="GetCurrentThreadId")] static extern uint ManagementThread();
  static uint ManagementOwner(IntPtr window) {uint owner;GetWindowThreadProcessId(window,out owner);return owner;}
  static void ManagementAssert(IntPtr window,uint owner) {if(!IsWindow(window)||ManagementOwner(window)!=owner)throw new InvalidOperationException("WINDOW_IDENTITY_CHANGED: refresh window observations before acting");}
  static bool? ManagementResponsive(IntPtr window) {UIntPtr ignored;bool answered=SendMessageTimeout(window,0,UIntPtr.Zero,IntPtr.Zero,3,100,out ignored)!=IntPtr.Zero;int error=Marshal.GetLastWin32Error();return !answered&&error==5?(bool?)null:answered;}
  static Dictionary<string,object> ManagementWindow(IntPtr window,uint owner) {
    Rect bounds;if(!GetWindowRect(window,out bounds))throw new InvalidOperationException("WINDOW_BOUNDS_UNAVAILABLE");
    StringBuilder title=new StringBuilder(2048);GetWindowText(window,title,title.Capacity);
    return new Dictionary<string,object>{{"nativeWindowHandle",window.ToInt64()},{"processId",owner},{"name",title.ToString()},{"boundingBox",new Dictionary<string,object>{{"x",bounds.Left},{"y",bounds.Top},{"width",bounds.Right-bounds.Left},{"height",bounds.Bottom-bounds.Top}}}};
  }
  // Read only the documented, 8-byte-aligned WTSINFOEX level-1 prefix;
  // account-name fields are never copied or reported.
  [StructLayout(LayoutKind.Explicit,Size=20)]struct ManagementSessionHeader {
    [FieldOffset(0)]public uint Level;[FieldOffset(8)]public uint Session;
    [FieldOffset(12)]public uint Connection;[FieldOffset(16)]public int Flags;
  }
  [DllImport("kernel32.dll",EntryPoint="GetCurrentProcessId")]static extern uint ManagementProcessId();
  [DllImport("kernel32.dll",EntryPoint="ProcessIdToSessionId")]static extern bool ManagementSessionId(uint process,out uint session);
  [DllImport("wtsapi32.dll",EntryPoint="WTSQuerySessionInformationW")]static extern bool ManagementQuerySession(IntPtr server,uint session,int kind,out IntPtr buffer,out uint bytes);
  [DllImport("wtsapi32.dll",EntryPoint="WTSFreeMemory")]static extern void ManagementFreeSession(IntPtr buffer);
  static void ManagementEnsureUnlockedSession() {
    uint session;if(!ManagementSessionId(ManagementProcessId(),out session))return;
    IntPtr buffer=IntPtr.Zero;uint bytes;
    try {
      if(!ManagementQuerySession(IntPtr.Zero,session,25,out buffer,out bytes) || buffer==IntPtr.Zero || bytes<20)return;
      ManagementSessionHeader state=(ManagementSessionHeader)Marshal.PtrToStructure(buffer,typeof(ManagementSessionHeader));
      if(state.Level==1 && state.Session==session && state.Flags==0)throw new InvalidOperationException("DESKTOP_SESSION_LOCKED: unlock Windows before requesting foreground input");
    }finally {if(buffer!=IntPtr.Zero)ManagementFreeSession(buffer);}
    // Unknown/unavailable session state does not invent a lock diagnosis;
    // the existing identity, foreground and input guards still apply.
  }
  [DllImport("user32.dll",EntryPoint="BringWindowToTop")]static extern bool ManagementBringToTop(IntPtr window);
  static bool ManagementActivate(IntPtr window,uint owner) {
    ManagementAssert(window,owner);ManagementEnsureUnlockedSession();
    if(IsIconic(window))ManagementShow(window,9);
    if(GetForegroundWindow()==window)return true;
    SetForegroundWindow(window);
    if(GetForegroundWindow()==window)return true;
    IntPtr front=GetForegroundWindow();uint ignored;uint frontThread=GetWindowThreadProcessId(front,out ignored),own=ManagementThread();bool attached=false;
    try {if(frontThread!=0&&frontThread!=own)attached=ManagementAttach(own,frontThread,true);ManagementAssert(window,owner);ManagementBringToTop(window);ManagementAssert(window,owner);SetForegroundWindow(window);}
    finally {if(attached)ManagementAttach(own,frontThread,false);}
    for(int index=0;index<8&&GetForegroundWindow()!=window;index++)Thread.Sleep(10);
    return GetForegroundWindow()==window;
  }
  static object ManageNativeWindow(string action,Dictionary<string,object> args) {
    if(action=="launch_app")return LaunchFromDesktop(args);
    // Shared Win32 capture resolver performs HWND/PID/title matching without resolving UIA.
    IntPtr window=ResolveCaptureWindow(args);uint owner=ManagementOwner(window);ManagementAssert(window,owner);
    Dictionary<string,object> result=Result(true,action);result["nativeWindowHandle"]=window.ToInt64();result["processId"]=owner;result["window"]=ManagementWindow(window,owner);
    bool? responsive=ManagementResponsive(window);result["targetResponsive"]=responsive;
    ManagementAssert(window,owner);
    if(action=="close_window") {
      bool posted=ManagementPost(window,0x0010,IntPtr.Zero,IntPtr.Zero);result["posted"]=posted;result["verification"]=posted?"sent":"unconfirmed";result["note"]=posted?"WM_CLOSE was dispatched; the application may veto closure or show a save dialog. Observe windows to verify.":"Windows refused posting WM_CLOSE; no closure was confirmed.";if(!posted)result["nativeError"]=Marshal.GetLastWin32Error();return result;
    }
    if(action=="move_window") {
      int x=Convert.ToInt32(args["x"]),y=Convert.ToInt32(args["y"]);
      bool moved=ManagementMove(window,IntPtr.Zero,x,y,0,0,0x0001|0x0004|0x0010|0x4000);
      result["moved"]=moved;result["x"]=x;result["y"]=y;result["verification"]=moved?"sent":"unconfirmed";
      if(!moved)result["warning"]="SetWindowPos refused the move; the window may be unavailable or maximized.";
      if(!args.ContainsKey("activate")||!Convert.ToBoolean(args["activate"]))return result;
    }
    bool activated=responsive==true&&ManagementActivate(window,owner);result["activated"]=activated;
    if(!activated){result["verification"]="unconfirmed";result["warning"]=responsive==true?"Windows foreground rules refused activation; no keyboard or mouse workaround was sent.":"The target is unresponsive or inaccessible; activation was not attempted.";}
    else if(action=="activate_window")result["verification"]="sent";
    return result;
  }

  static readonly HashSet<string> ManagementCommandHosts=new HashSet<string>(StringComparer.OrdinalIgnoreCase){"cmd","powershell","pwsh","wt","wsl","bash","conhost","wscript","cscript","mshta","rundll32","regsvr32","msiexec","forfiles","schtasks"};
  static void ReleaseLaunchCom(object value) {try{if(value!=null&&Marshal.IsComObject(value))Marshal.ReleaseComObject(value);}catch(InvalidComObjectException){}}
  static bool FullyQualifiedLaunchPath(string value) {return value.Length>=3&&Char.IsLetter(value[0])&&value[1]==':'&&(value[2]=='\\'||value[2]=='/')||value.StartsWith("\\\\",StringComparison.Ordinal)&&value.TrimStart('\\').Split('\\').Length>=2;}
  static string ResolveLaunchFile(string target) {
    if(Path.IsPathRooted(target)) {
      if(!FullyQualifiedLaunchPath(target))throw new InvalidOperationException("LAUNCH_INVALID_TARGET: use a fully qualified absolute path");
      if(!File.Exists(target))throw new InvalidOperationException("LAUNCH_NOT_FOUND: target file does not exist");
      return Path.GetFullPath(target);
    }
    if(target.IndexOfAny(new char[]{'\\','/',':'})>=0)return null;
    string[] extensions=Path.GetExtension(target).Length>0?new string[]{""}:new string[]{".exe",".com",".lnk"};
    foreach(string directory in (Environment.GetEnvironmentVariable("PATH")??"").Split(';'))foreach(string extension in extensions) {
      string candidate;try{candidate=Path.Combine(directory.Trim('"'),target+extension);}catch(ArgumentException){continue;}
      if(File.Exists(candidate))return Path.GetFullPath(candidate);
    }
    string name=target.EndsWith(".exe",StringComparison.OrdinalIgnoreCase)?target:target+".exe";
    foreach(RegistryHive hive in new RegistryHive[]{RegistryHive.CurrentUser,RegistryHive.LocalMachine})foreach(RegistryView view in new RegistryView[]{RegistryView.Registry64,RegistryView.Registry32}) {
      try{using(RegistryKey root=RegistryKey.OpenBaseKey(hive,view))using(RegistryKey key=root.OpenSubKey("SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\"+name)){
        string candidate=key==null?null:Convert.ToString(key.GetValue(""));if(String.IsNullOrEmpty(candidate))continue;candidate=Environment.ExpandEnvironmentVariables(candidate.Trim('"'));if(File.Exists(candidate))return Path.GetFullPath(candidate);
      }}catch(System.Security.SecurityException){}
    }
    return null;
  }
  static string ResolveInstalledLaunch(string target) {
    object application=null,folder=null,items=null;List<string> matches=new List<string>();
    try{
      application=Activator.CreateInstance(Type.GetTypeFromProgID("Shell.Application"));folder=((dynamic)application).NameSpace("shell:AppsFolder");if(folder==null)throw new InvalidOperationException("Installed app enumeration is unavailable");items=((dynamic)folder).Items();int count=((dynamic)items).Count;
      for(int index=0;index<count;index++) {
        object item=null;try{item=((dynamic)items).Item(index);string name=Convert.ToString(((dynamic)item).Name),id=Convert.ToString(((dynamic)item).ExtendedProperty("System.AppUserModel.ID"));
          if(String.Equals(target,name,StringComparison.OrdinalIgnoreCase)||String.Equals(target,id,StringComparison.OrdinalIgnoreCase)){if(String.IsNullOrEmpty(id))id=Convert.ToString(((dynamic)item).Path);if(!String.IsNullOrEmpty(id))matches.Add(id);}
        }finally{ReleaseLaunchCom(item);}
      }
    }finally{ReleaseLaunchCom(items);ReleaseLaunchCom(folder);ReleaseLaunchCom(application);}
    if(matches.Count==0)throw new InvalidOperationException("LAUNCH_NOT_FOUND: use an executable path or exact installed app name/AppUserModelID");
    if(matches.Count!=1)throw new InvalidOperationException("LAUNCH_AMBIGUOUS: use a full executable path or AppUserModelID");
    return "shell:AppsFolder\\"+matches[0];
  }
  static void CheckLaunchProgram(string file,string arguments) {
    string program=file,embedded="";HashSet<string> seen=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    while(String.Equals(Path.GetExtension(program),".lnk",StringComparison.OrdinalIgnoreCase)){
      if(!seen.Add(program)||seen.Count>8)throw new InvalidOperationException("LAUNCH_INVALID_TARGET: shortcut chain is cyclic or too deep");
      object shell=null,link=null;try{shell=Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));link=((dynamic)shell).CreateShortcut(program);embedded+=" "+Convert.ToString(((dynamic)link).Arguments);program=Environment.ExpandEnvironmentVariables(Convert.ToString(((dynamic)link).TargetPath));if(String.IsNullOrWhiteSpace(program))throw new InvalidOperationException("LAUNCH_INVALID_TARGET: shortcut has no executable target");}finally{ReleaseLaunchCom(link);ReleaseLaunchCom(shell);}
    }
    if((arguments.Trim().Length>0||embedded.Trim().Length>0)&&ManagementCommandHosts.Contains(Path.GetFileNameWithoutExtension(program)))throw new InvalidOperationException("LAUNCH_COMMAND_REFUSED: command/script hosts accept no arguments through launch_app; use Pi's shell tool");
  }
  static object LaunchFromDesktop(Dictionary<string,object> args) {
    Dictionary<string,object> result=null;Exception failure=null;
    Thread thread=new Thread(delegate(){
      try{
        string target=Environment.ExpandEnvironmentVariables(Convert.ToString(args["target"]).Trim()),arguments=Convert.ToString(args["arguments"]),directory=Convert.ToString(args["workingDirectory"]);
        string file=ResolveLaunchFile(target),kind=file==null?"installed-app":"file";
        if(file!=null){string extension=Path.GetExtension(file);if(!String.Equals(extension,".exe",StringComparison.OrdinalIgnoreCase)&&!String.Equals(extension,".com",StringComparison.OrdinalIgnoreCase)&&!String.Equals(extension,".lnk",StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("LAUNCH_INVALID_TARGET: only exe/com/lnk files are supported");CheckLaunchProgram(file,arguments);target=file;}
        else target=ResolveInstalledLaunch(target);
        if(directory.Length>0){directory=Environment.ExpandEnvironmentVariables(directory);if(!FullyQualifiedLaunchPath(directory)||!Directory.Exists(directory))throw new InvalidOperationException("LAUNCH_INVALID_DIRECTORY: use an existing fully qualified directory");directory=Path.GetFullPath(directory);}
        if(kind=="installed-app"&&(arguments.Length>0||directory.Length>0))throw new InvalidOperationException("LAUNCH_INVALID_ARGUMENTS: installed AppUserModelID launches do not accept arguments or workingDirectory");
        object windows=null,desktop=null,document=null,application=null;
        try{
          windows=Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("9BA05972-F6A8-11CF-A442-00A0C90A8F39")));
          object location=0,root=null;int handle=0;desktop=((dynamic)windows).FindWindowSW(ref location,ref root,8,out handle,1);
          if(desktop==null)throw new InvalidOperationException("interactive Explorer desktop is unavailable");
          document=((dynamic)desktop).Document;application=((dynamic)document).Application;
          ((dynamic)application).ShellExecute(target,arguments,directory,"open",Convert.ToBoolean(args["activate"])?1:4);
        }catch(Exception error){throw new InvalidOperationException("LAUNCH_SHELL_FAILED: "+error.Message+"; no child-process fallback or replay was attempted",error);}
        finally{ReleaseLaunchCom(application);ReleaseLaunchCom(document);ReleaseLaunchCom(desktop);ReleaseLaunchCom(windows);}
        result=Result(true,"launch_app");result["target"]=target;result["targetKind"]=kind;result["launchMethod"]="explorer-shell";result["verification"]="dispatched";result["note"]="Explorer accepted the launch. New windows are observations, not confirmed matches. The app can reuse a window or activate itself; use list_windows/wait_for to verify. No elevation was requested.";
      }catch(Exception error){failure=error;}
    });
    thread.IsBackground=true;thread.SetApartmentState(ApartmentState.STA);thread.Start();
    if(!thread.Join(15000))throw new InvalidOperationException("LAUNCH_PENDING_TIMEOUT: Explorer outcome is unknown; do not replay the launch");
    if(failure!=null)throw failure;
    return result;
  }
}
