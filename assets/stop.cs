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
  static readonly object gate = new object();
  static readonly JavaScriptSerializer json = new JavaScriptSerializer();
  static readonly KeyboardHook callback = OnKey;
  static IntPtr installed;
  static string operation;
  static EventWaitHandle cancelled;
  static bool armed, stopped;
  static string shortcut = "";
  static int shortcutKey, shortcutModifiers;
  static Presentation presentation;

  static void Send(object value) { lock(gate) { Console.WriteLine(json.Serialize(value)); Console.Out.Flush(); } }
  static void Stop() {
    if (!armed || stopped) return;
    stopped = true; cancelled.Set(); presentation.Stop();
    Send(new Dictionary<string,object> {{"event","stopped"},{"operationId",operation}});
  }
  static int Modifiers() {
    return (GetAsyncKeyState(0x11)<0 ? 1 : 0) | (GetAsyncKeyState(0x12)<0 ? 2 : 0) |
      (GetAsyncKeyState(0x10)<0 ? 4 : 0) | ((GetAsyncKeyState(0x5B)<0 || GetAsyncKeyState(0x5C)<0) ? 8 : 0);
  }
  static IntPtr OnKey(int code, IntPtr wParam, IntPtr lParam) {
    if (code >= 0 && (wParam.ToInt64()==0x100 || wParam.ToInt64()==0x104)) {
      int flags=Marshal.ReadInt32(lParam,8), key=Marshal.ReadInt32(lParam);
      // Agent-injected Escape dismisses UI; it must not stop its own operation.
      if ((flags & 0x12)==0 && (key==0x1B || (shortcutKey!=0 && key==shortcutKey && Modifiers()==shortcutModifiers))) Stop();
    }
    return CallNextHookEx(installed,code,wParam,lParam);
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
        if(cancelled!=null)cancelled.Dispose();
        presentation.Stop(); operation=wanted; armed=true; stopped=false;
        cancelled=new EventWaitHandle(false,EventResetMode.ManualReset,Convert.ToString(args["cancelEvent"]));
      } else if(action=="stop") { if(wanted==operation)Stop(); }
      else if(action=="disarm") { if(wanted==operation) { armed=false; presentation.End(); } }
      else if(action=="begin") { if(wanted!=operation || !armed || stopped)throw new InvalidOperationException("STOP_OPERATION_NOT_ARMED"); presentation.Begin(); }
      else if(action=="touch") { if(wanted==operation && armed && !stopped)presentation.Touch(); }
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
    Control dispatcher=new Control();IntPtr dispatcherHandle=dispatcher.Handle;
    presentation=new Presentation();
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
    finally { UnhookWindowsHookEx(installed);presentation.Dispose();if(cancelled!=null)cancelled.Dispose();dispatcher.Dispose(); }
  }
}
