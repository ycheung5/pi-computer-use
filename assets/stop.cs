using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

// Independent process: the keyboard hook/message pump never enters UIA providers.
class StopBridge {
  delegate IntPtr KeyboardHook(int code, IntPtr wParam, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] struct Message { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public int x, y; public uint reserved; }
  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SetWindowsHookEx(int hook, KeyboardHook callback, IntPtr module, uint thread);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] static extern int GetMessage(out Message message, IntPtr hwnd, uint min, uint max);
  [DllImport("user32.dll")] static extern bool TranslateMessage(ref Message message);
  [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref Message message);
  [DllImport("user32.dll")] static extern bool PostThreadMessage(uint thread, uint message, UIntPtr wParam, IntPtr lParam);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandle(string module);
  static readonly object gate = new object();
  static readonly JavaScriptSerializer json = new JavaScriptSerializer();
  static readonly KeyboardHook callback = OnKey;
  static IntPtr installed;
  static string operation;
  static EventWaitHandle cancelled;
  static bool armed;
  static bool stopped;

  static void Send(object value) { lock(gate) { Console.WriteLine(json.Serialize(value)); Console.Out.Flush(); } }
  static void Stop() {
    lock(gate) {
      if (!armed || stopped) return;
      stopped = true;
      cancelled.Set();
      Send(new Dictionary<string,object> {{"event","stopped"},{"operationId",operation}});
    }
  }
  static IntPtr OnKey(int code, IntPtr wParam, IntPtr lParam) {
    if (code >= 0 && (wParam.ToInt64() == 0x100 || wParam.ToInt64() == 0x104) && Marshal.ReadInt32(lParam) == 0x1B) Stop();
    return CallNextHookEx(installed, code, wParam, lParam);
  }

  [STAThread]
  static void Main() {
    Console.InputEncoding = new UTF8Encoding(false); Console.OutputEncoding = new UTF8Encoding(false);
    installed = SetWindowsHookEx(13, callback, GetModuleHandle(null), 0);
    if (installed == IntPtr.Zero) throw new InvalidOperationException("STOP_LISTENER_UNAVAILABLE: keyboard hook failed: " + Marshal.GetLastWin32Error());
    uint mainThread = GetCurrentThreadId();
    Thread reader = new Thread(delegate() {
      string line;
      while ((line = Console.ReadLine()) != null) {
        Dictionary<string,object> request = null;
        try {
          request = json.Deserialize<Dictionary<string,object>>(line);
          if (request.ContainsKey("cancel")) continue;
          string action = Convert.ToString(request["action"]);
          Dictionary<string,object> args = (Dictionary<string,object>)request["args"];
          lock(gate) {
            string wanted = args.ContainsKey("operationId") ? Convert.ToString(args["operationId"]) : "";
            if (action == "arm") {
              if (String.IsNullOrWhiteSpace(wanted)) throw new InvalidOperationException("INVALID_OPERATION");
              if (cancelled != null) cancelled.Dispose();
              operation = wanted; armed = true; stopped = false;
              cancelled = new EventWaitHandle(false, EventResetMode.ManualReset, Convert.ToString(args["cancelEvent"]));
            } else if (action == "stop") { if (wanted == operation) Stop(); }
            else if (action == "disarm") { if (wanted == operation) armed = false; }
            else if (action != "status") throw new InvalidOperationException("UNKNOWN_ACTION");
            Send(new Dictionary<string,object> {{"id",request["id"]},{"result",new Dictionary<string,object> {
              {"ok",true},{"action",action},{"listenerProcessId",System.Diagnostics.Process.GetCurrentProcess().Id},{"hookInstalled",true},{"armed",armed},{"stopped",stopped},{"operationId",operation},{"cancelEventSet",cancelled != null && cancelled.WaitOne(0)}
            }}});
          }
        } catch(Exception error) {
          if (request != null && request.ContainsKey("id")) Send(new Dictionary<string,object> {{"id",request["id"]},{"result",new Dictionary<string,object> {{"ok",false},{"action",request.ContainsKey("action") ? request["action"] : "invalid_request"},{"error",error.Message}}}});
          else Console.Error.WriteLine("STOP_PROTOCOL_ERROR: " + error.Message);
        }
      }
      PostThreadMessage(mainThread, 0x12, UIntPtr.Zero, IntPtr.Zero);
    });
    reader.IsBackground = true; reader.Start();
    try { Message message; while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0) { TranslateMessage(ref message); DispatchMessage(ref message); } }
    finally { UnhookWindowsHookEx(installed); lock(gate) { if (cancelled != null) cancelled.Dispose(); } }
  }
}
