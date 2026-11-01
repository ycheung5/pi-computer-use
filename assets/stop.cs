using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// The hook and overlays own an STA message pump and never enter UIA providers.
partial class StopBridge {
  delegate IntPtr KeyboardHook(int code, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SetWindowsHookEx(int hook, KeyboardHook callback, IntPtr module, uint thread);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandle(string module);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern IntPtr OpenInputDesktop(uint flags,bool inherit,uint access);
  [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("user32.dll")] static extern IntPtr GetThreadDesktop(uint thread);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll",EntryPoint="GetUserObjectInformationW",CharSet=CharSet.Unicode)] static extern bool DesktopInfo(IntPtr desktop,int kind,StringBuilder value,uint bytes,out uint needed);
  static readonly object gate = new object();
  static readonly JavaScriptSerializer json = new JavaScriptSerializer();
  static readonly KeyboardHook callback = OnKey;
  static readonly KeyboardHook mouseCallback = OnMouse;
  static IntPtr installed, mouseHook;
  static string operation;
  static EventWaitHandle cancelled;
  static EventWaitHandle exclusive;
  static readonly HashSet<int> physicalDown = new HashSet<int>(), swallowed = new HashSet<int>();
  static readonly HashSet<int> mouseDown = new HashSet<int>(), swallowedButtons = new HashSet<int>();
  static int suppressedKeys, suppressedMouse,suppressedButtons;
  static bool armed, stopped;
  static string shortcut = "";
  static int shortcutKey, shortcutModifiers;
  static Presentation presentation;
  static Control dispatcher;

  static void Send(object value) { lock(gate) { Console.WriteLine(json.Serialize(value)); Console.Out.Flush(); } }
  static void Stop() {
    if (!armed || stopped) return;
    stopped = true; cancelled.Set(); ReleaseControl();
    string stoppedOperation=operation;
    dispatcher.BeginInvoke((Action)delegate {
      if(operation==stoppedOperation && stopped)presentation.Stop();Send(new Dictionary<string,object> {{"event","stopped"},{"operationId",stoppedOperation}});
    });
  }
  static int Modifiers() {
    return (physicalDown.Contains(0x11)||physicalDown.Contains(0xA2)||physicalDown.Contains(0xA3) ? 1 : 0) |
      (physicalDown.Contains(0x12)||physicalDown.Contains(0xA4)||physicalDown.Contains(0xA5) ? 2 : 0) |
      (physicalDown.Contains(0x10)||physicalDown.Contains(0xA0)||physicalDown.Contains(0xA1) ? 4 : 0) |
      (physicalDown.Contains(0x5B)||physicalDown.Contains(0x5C) ? 8 : 0);
  }
  static IntPtr OnKey(int code, IntPtr wParam, IntPtr lParam) {
    if (code >= 0) {
      int flags=Marshal.ReadInt32(lParam,8), key=Marshal.ReadInt32(lParam);
      // Agent-injected Escape dismisses UI; it must not stop its own operation.
      if ((flags & 0x12)==0) {
        bool down=wParam.ToInt64()==0x100 || wParam.ToInt64()==0x104;
        if(down)physicalDown.Add(key);else physicalDown.Remove(key);
        bool consume=(exclusive!=null && exclusive.WaitOne(0)) || swallowed.Contains(key);
        if(down && armed && !stopped && (key==0x1B || (shortcutKey!=0 && key==shortcutKey && Modifiers()==shortcutModifiers))) {consume=true;Stop();}
        if(down && consume)swallowed.Add(key);
        if(!down && swallowed.Remove(key))consume=true;
        if(consume){suppressedKeys++;return new IntPtr(1);}
      }
    }
    return CallNextHookEx(installed,code,wParam,lParam);
  }
  static IntPtr OnMouse(int code,IntPtr message,IntPtr data) {
    if(code>=0 && (Marshal.ReadInt32(data,12)&3)==0) {
      int kind=message.ToInt32(),button=0;
      bool down=kind==0x201 || kind==0x204 || kind==0x207 || kind==0x20B;
      bool up=kind==0x202 || kind==0x205 || kind==0x208 || kind==0x20C;
      if(kind==0x201 || kind==0x202)button=1;
      else if(kind==0x204 || kind==0x205)button=2;
      else if(kind==0x207 || kind==0x208)button=4;
      else if(down || up)button=(Marshal.ReadInt32(data,8)>>16)==1?5:6;
      if(down)mouseDown.Add(button);if(up)mouseDown.Remove(button);
      bool consume=(exclusive!=null && exclusive.WaitOne(0)) || (button!=0 && swallowedButtons.Contains(button));
      if(down && consume)swallowedButtons.Add(button);if(up)swallowedButtons.Remove(button);
      if(consume){suppressedMouse++;if(down)suppressedButtons++;return new IntPtr(1);}
    }
    return CallNextHookEx(mouseHook,code,message,data);
  }
  static void ReleaseControl() {
    if(exclusive!=null)exclusive.Reset();
  }
  static void TakeControl() {
    if(!armed || stopped || exclusive==null)throw new InvalidOperationException("STOP_OPERATION_NOT_ARMED");
    if(exclusive.WaitOne(0))return;
    if(!InteractiveDesktop())throw new InvalidOperationException("DESKTOP_SESSION_UNAVAILABLE: unlock the interactive desktop");
    if(physicalDown.Count>0 || mouseDown.Count>0)throw new InvalidOperationException("USER_INPUT_ACTIVE: release physical input before control begins");
    for(int key=1;key<255;key++)if(GetAsyncKeyState(key)<0)throw new InvalidOperationException("USER_INPUT_ACTIVE: release held input before control begins");
    if(mouseHook==IntPtr.Zero)mouseHook=SetWindowsHookEx(14,mouseCallback,GetModuleHandle(null),0);
    if(mouseHook==IntPtr.Zero)throw new InvalidOperationException("EXCLUSIVE_CONTROL_UNAVAILABLE: mouse hook failed");
    try {
      presentation.Begin();if(stopped || cancelled.WaitOne(0))throw new InvalidOperationException("COMPUTER_USE_STOPPED");exclusive.Set();
    } catch {ReleaseControl();presentation.Stop();throw;}
  }
  static bool InteractiveDesktop() {
    IntPtr input=OpenInputDesktop(0,false,1);if(input==IntPtr.Zero)return false;
    try {
      StringBuilder current=new StringBuilder(256),own=new StringBuilder(256);uint needed;
      return DesktopInfo(input,2,current,512,out needed) && DesktopInfo(GetThreadDesktop(GetCurrentThreadId()),2,own,512,out needed) && current.ToString()==own.ToString();
    }finally {CloseDesktop(input);}
  }
  static void ConfigureShortcut(string value) {
    shortcut=value; shortcutKey=0; shortcutModifiers=0;
    if (String.IsNullOrEmpty(value)) return;
    string[] parts=value.Split('+');
    for(int i=0;i<parts.Length-1;i++) {
      if(parts[i]=="Ctrl")shortcutModifiers|=1;else if(parts[i]=="Alt")shortcutModifiers|=2;
      else if(parts[i]=="Shift")shortcutModifiers|=4;else if(parts[i]=="Win")shortcutModifiers|=8;
      else throw new InvalidOperationException("INVALID_STOP_SHORTCUT");
    }
    string key=parts[parts.Length-1];
    if(key.Length==1 && ((key[0]>='A' && key[0]<='Z') || (key[0]>='0' && key[0]<='9')))shortcutKey=key[0];
    else if(key.StartsWith("F",StringComparison.Ordinal) && key.Length<=3) {
      int number;if(Int32.TryParse(key.Substring(1),out number) && number>=1 && number<=24)shortcutKey=0x6F+number;
    } else {
      Dictionary<string,int> keys=new Dictionary<string,int> {{"Space",32},{"Enter",13},{"Tab",9},{"Backspace",8},{"Delete",46},{"Insert",45},{"Home",36},{"End",35},{"PageUp",33},{"PageDown",34},{"Up",38},{"Down",40},{"Left",37},{"Right",39},{"Pause",19},{"CapsLock",20},{"NumLock",144},{"ScrollLock",145}};
      keys.TryGetValue(key,out shortcutKey);
    }
    if(shortcutKey==0)throw new InvalidOperationException("INVALID_STOP_SHORTCUT");
  }
  static void Configure(Dictionary<string,object> values) {
    object value;
    ConfigureShortcut(values.TryGetValue("stopShortcut",out value) ? Convert.ToString(value) : "");
    presentation.Configure(values);
  }
  static Dictionary<string,object> Status(string action) {
    return new Dictionary<string,object> {
      {"ok",true},{"action",action},{"listenerProcessId",System.Diagnostics.Process.GetCurrentProcess().Id},
      {"hookInstalled",installed!=IntPtr.Zero},{"armed",armed},{"stopped",stopped},{"operationId",operation},
      {"exclusiveControl",exclusive!=null && exclusive.WaitOne(0)},{"suppressedKeys",suppressedKeys},{"suppressedMouse",suppressedMouse},
      {"suppressedButtons",suppressedButtons},
      {"physicalKeysHeld",physicalDown.Count},{"physicalButtonsHeld",mouseDown.Count},
      {"cancelEventSet",cancelled!=null && cancelled.WaitOne(0)}, {"stopShortcut",shortcut},
      {"shortcutVirtualKey",shortcutKey},{"shortcutModifiers",shortcutModifiers},{"escAlwaysEnabled",true},
      {"injectedKeysIgnored",true},{"presentation",presentation.Status()}
    };
  }
  static void Handle(Dictionary<string,object> request) {
    string action=request.ContainsKey("action") ? Convert.ToString(request["action"]) : "invalid_request";
    try {
      Dictionary<string,object> args=(Dictionary<string,object>)request["args"];
      string wanted=args.ContainsKey("operationId") ? Convert.ToString(args["operationId"]) : "";
      if(action=="configure")Configure((Dictionary<string,object>)args["settings"]);
      else if(action=="arm") {
        if(String.IsNullOrWhiteSpace(wanted))throw new InvalidOperationException("INVALID_OPERATION");
        ReleaseControl();if(exclusive!=null)exclusive.Dispose();if(cancelled!=null)cancelled.Dispose();
        presentation.Stop(); operation=wanted; armed=true; stopped=false;
        cancelled=new EventWaitHandle(false,EventResetMode.ManualReset,Convert.ToString(args["cancelEvent"]));
        exclusive=new EventWaitHandle(false,EventResetMode.ManualReset,Convert.ToString(args["cancelEvent"])+"-exclusive");
        suppressedKeys=0;suppressedMouse=0;suppressedButtons=0;
      } else if(action=="stop") { if(wanted==operation)Stop(); }
      else if(action=="take_control") {if(wanted!=operation)throw new InvalidOperationException("STOP_OPERATION_NOT_ARMED");TakeControl();}
      else if(action=="disarm") { if(wanted==operation) { ReleaseControl();armed=false; presentation.Stop(); } }
      else if(action=="capture") presentation.Suspend(Convert.ToBoolean(args["suspended"]));
      else if(action=="preview") presentation.Preview(args.ContainsKey("show") ? Convert.ToBoolean(args["show"]) : true);
      else if(action!="status")throw new InvalidOperationException("UNKNOWN_ACTION");
      Send(new Dictionary<string,object> {{"id",request["id"]},{"result",Status(action)}});
    } catch(Exception error) {
      Send(new Dictionary<string,object> {{"id",request["id"]},{"result",new Dictionary<string,object> {{"ok",false},{"action",action},{"error",error.Message}}}});
    }
  }
  [STAThread]
  static void Main() {
    Console.InputEncoding=new UTF8Encoding(false);Console.OutputEncoding=new UTF8Encoding(false);
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch(EntryPointNotFoundException) { }
    Application.EnableVisualStyles();
    dispatcher=new Control();IntPtr dispatcherHandle=dispatcher.Handle;
    presentation=new Presentation();
    var health=new System.Windows.Forms.Timer {Interval=100};
    health.Tick+=delegate {if(exclusive!=null && exclusive.WaitOne(0) && (!InteractiveDesktop() || !presentation.BorderReady))Stop();};health.Start();
    installed=SetWindowsHookEx(13,callback,GetModuleHandle(null),0);
    if(installed==IntPtr.Zero)throw new InvalidOperationException("STOP_LISTENER_UNAVAILABLE: keyboard hook failed: "+Marshal.GetLastWin32Error());
    Thread reader=new Thread(delegate() {
      JavaScriptSerializer readerJson=new JavaScriptSerializer();
      string line;
      while((line=Console.ReadLine())!=null) {
        try {
          Dictionary<string,object> request=readerJson.Deserialize<Dictionary<string,object>>(line);
          if(request.ContainsKey("cancel"))continue;
          Dictionary<string,object> captured=request;
          dispatcher.BeginInvoke((Action)delegate { Handle(captured); });
        } catch(Exception error) { Console.Error.WriteLine("STOP_PROTOCOL_ERROR: "+error.Message); }
      }
      dispatcher.BeginInvoke((Action)delegate { Application.ExitThread(); });
    });
    reader.IsBackground=true;reader.Start();
    try { Application.Run(); }
    finally { health.Dispose();if(cancelled!=null)cancelled.Set();ReleaseControl();if(mouseHook!=IntPtr.Zero)UnhookWindowsHookEx(mouseHook);UnhookWindowsHookEx(installed);presentation.Dispose();if(exclusive!=null)exclusive.Dispose();if(cancelled!=null)cancelled.Dispose();dispatcher.Dispose(); }
  }
}
