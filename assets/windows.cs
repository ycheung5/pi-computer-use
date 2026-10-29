using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;

// Focused Win32 bridge; owns no UI and never sends physical input.
class WindowsBridge {
  delegate bool EnumWindow(IntPtr handle, IntPtr parameter);
  [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindow callback, IntPtr parameter);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr handle);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr handle);
  [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr handle);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr handle);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr handle, out Rect rect);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr handle, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr handle, StringBuilder text, int count);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr handle, out uint process);
  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SendMessageTimeout(IntPtr handle, uint message, UIntPtr wParam, IntPtr lParam, uint flags, uint timeout, out UIntPtr result);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);

  static Dictionary<string, object> Result(bool ok, string action) {
    return new Dictionary<string, object> { { "ok", ok }, { "action", action } };
  }

  static object ListWindows(Dictionary<string, object> args) {
    int maximum = Convert.ToInt32(args["maxWindows"]);
    bool invisible = Convert.ToBoolean(args["includeInvisible"]);
    List<object> windows = new List<object>();
    IntPtr foreground = GetForegroundWindow();
    bool truncated = false;
    EnumWindows(delegate(IntPtr handle, IntPtr parameter) {
      bool visible = IsWindowVisible(handle);
      bool offscreen = !visible || IsIconic(handle);
      if (!invisible && offscreen) return true;
      Rect bounds;
      if (!GetWindowRect(handle, out bounds)) return true;
      uint pid;
      GetWindowThreadProcessId(handle, out pid);
      if (pid == 0 || !IsWindow(handle)) return true;
      if (windows.Count == maximum) { truncated = true; return false; }
      StringBuilder title = new StringBuilder(2048);
      StringBuilder className = new StringBuilder(256);
      GetWindowText(handle, title, title.Capacity);
      GetClassName(handle, className, className.Capacity);
      UIntPtr ignored;
      bool answered = SendMessageTimeout(handle, 0, UIntPtr.Zero, IntPtr.Zero, 3, 100, out ignored) != IntPtr.Zero;
      int responseError = answered ? 0 : Marshal.GetLastWin32Error();
      // A window can disappear or be reused while native calls are in flight.
      uint ownerAfter;
      GetWindowThreadProcessId(handle, out ownerAfter);
      if (!IsWindow(handle) || ownerAfter != pid) return true;
      Dictionary<string, object> item = new Dictionary<string, object> {
        { "id", "uia:hwnd:" + handle.ToInt64() + ":pid:" + pid },
        { "depth", 1 }, { "name", title.ToString() }, { "className", className.ToString() },
        { "controlType", "Window" }, { "processId", pid }, { "nativeWindowHandle", handle.ToInt64() },
        { "boundingBox", new Dictionary<string, object> {
          { "x", bounds.Left }, { "y", bounds.Top }, { "width", bounds.Right - bounds.Left },
          { "height", bounds.Bottom - bounds.Top }, { "centerX", (bounds.Left + (double)bounds.Right) / 2 },
          { "centerY", (bounds.Top + (double)bounds.Bottom) / 2 }
        } },
        { "isEnabled", IsWindowEnabled(handle) }, { "isOffscreen", offscreen },
        { "hasKeyboardFocus", handle == foreground }, { "source", "win32" },
        { "responsive", responseError == 5 ? (object)null : answered },
        { "responsiveness", answered ? "responsive" : responseError == 5 ? "access_denied" : "unresponsive_or_unknown" }
      };
      windows.Add(item);
      return true;
    }, IntPtr.Zero);
    Dictionary<string, object> result = Result(true, "list_windows");
    result["windows"] = windows;
    result["truncated"] = truncated;
    result["source"] = "win32";
    return result;
  }

  [MTAThread]
  static void Main() {
    Console.InputEncoding = new UTF8Encoding(false);
    Console.OutputEncoding = new UTF8Encoding(false);
    try { if (!SetProcessDpiAwarenessContext(new IntPtr(-4))) SetProcessDPIAware(); }
    catch (EntryPointNotFoundException) { SetProcessDPIAware(); }
    JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 32 * 1024 * 1024 };
    string line;
    while ((line = Console.ReadLine()) != null) {
      Dictionary<string, object> request = null;
      try {
        request = json.Deserialize<Dictionary<string, object>>(line);
        if (request.ContainsKey("cancel")) continue;
        string action = Convert.ToString(request["action"]);
        object result;
        try {
          if (action != "list_windows") throw new InvalidOperationException("UNKNOWN_ACTION");
          result = ListWindows((Dictionary<string, object>)request["args"]);
        } catch (Exception error) {
          Dictionary<string, object> failure = Result(false, action);
          failure["error"] = "WINDOWS_ERROR: " + error.Message;
          result = failure;
        }
        Console.WriteLine(json.Serialize(new Dictionary<string, object> { { "id", request["id"] }, { "result", result } }));
        Console.Out.Flush();
      } catch (Exception error) {
        Console.Error.WriteLine("NATIVE_PROTOCOL_ERROR: " + error.Message);
      }
    }
  }
}
