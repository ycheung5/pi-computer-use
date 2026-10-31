using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;

// Focused Win32 bridge; guarded input lives in pointer.cs.
partial class WindowsBridge {
  static bool physicalInputAnnounced;
  static void NotifyPhysicalInput(bool active) {
    if(physicalInputAnnounced==active)return;
    physicalInputAnnounced=active;
    Console.WriteLine(new JavaScriptSerializer().Serialize(new Dictionary<string,object> {{"event","input_state"},{"active",active},{"operationId",pointerOperation}}));
    Console.Out.Flush();
  }
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
    if(args.ContainsKey("windowRef"))return ObserveReferencePresence(args);
    int maximum = Convert.ToInt32(args["maxWindows"]);
    bool invisible = Convert.ToBoolean(args["includeInvisible"]);
    List<object> windows = new List<object>();
    bool truncated=false,identityChanged=false,metadataOnly=Option(args,"_metadataOnly",false);
    EnumWindows(delegate(IntPtr handle,IntPtr parameter) {
      // Eligibility probes are not retained metadata. Re-read retained fields after binding.
      if(!invisible && (!IsWindowVisible(handle) || IsIconic(handle)))return true;
      uint pid;GetWindowThreadProcessId(handle,out pid);
      if(pid==0 || !IsWindow(handle))return true;
      if(windows.Count==maximum){truncated=true;return false;}
      var bindingMetadata=new Dictionary<string,object>();
      WindowReference binding=metadataOnly?null:ObserveWindowReference(handle,bindingMetadata);
      bool visible=IsWindowVisible(handle),offscreen=!visible || IsIconic(handle);
      if(!invisible && offscreen){if(binding!=null && !WindowMarker.Matches(handle,binding.Owner,binding.Marker))identityChanged=true;return true;}
      Rect bounds;if(!GetWindowRect(handle,out bounds)){if(binding!=null)identityChanged=true;return true;}
      var title=new StringBuilder(2048);var className=new StringBuilder(256);
      GetWindowText(handle,title,title.Capacity);GetClassName(handle,className,className.Capacity);
      UIntPtr ignored;bool answered=SendMessageTimeout(handle,0,UIntPtr.Zero,IntPtr.Zero,3,100,out ignored)!=IntPtr.Zero;
      int responseError=answered?0:Marshal.GetLastWin32Error();
      uint ownerAfter;GetWindowThreadProcessId(handle,out ownerAfter);
      if(!IsWindow(handle) || ownerAfter!=pid || (binding!=null && !WindowMarker.Matches(handle,binding.Owner,binding.Marker))){if(binding!=null)identityChanged=true;return true;}
      Dictionary<string,object> item=new Dictionary<string,object>{
        {"depth",1},{"name",title.ToString()},{"className",className.ToString()},
        {"controlType","Window"},{"processId",pid},{"nativeWindowHandle",handle.ToInt64()},
        {"boundingBox",new Dictionary<string,object>{{"x",bounds.Left},{"y",bounds.Top},{"width",bounds.Right-bounds.Left},{"height",bounds.Bottom-bounds.Top},{"centerX",(bounds.Left+(double)bounds.Right)/2},{"centerY",(bounds.Top+(double)bounds.Bottom)/2}}},
        {"isEnabled",IsWindowEnabled(handle)},{"isOffscreen",offscreen},{"hasKeyboardFocus",handle==GetForegroundWindow()},{"source","win32"},
        {"responsive",responseError==5?(object)null:answered},{"responsiveness",answered?"responsive":responseError==5?"access_denied":"unresponsive_or_unknown"}
      };
      if(binding!=null){item["id"]="uia:hwnd:"+handle.ToInt64()+":pid:"+pid;item["windowRef"]=binding.Id;}
      else if(metadataOnly)item["windowRefUnavailable"]="UNBOUND_METADATA: observe the selected window to obtain a reference";
      else foreach(var pair in bindingMetadata)item[pair.Key]=pair.Value;
      RememberPointerOrigin(handle);
      if(binding!=null && !WindowMarker.Matches(handle,binding.Owner,binding.Marker)){identityChanged=true;return true;}
      windows.Add(item);return true;
    },IntPtr.Zero);
    Dictionary<string, object> result = Result(true, "list_windows");
    result["windows"] = windows;
    result["truncated"] = truncated || identityChanged;
    if(identityChanged){result["conclusive"]=false;result["observationError"]="WINDOW_REFERENCE_LOST: a lifetime changed during enumeration; incomplete observation";}
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
        currentReference=null;windowDispatchAttempted=false;
        pointerInputAction=action=="click" || action=="double_click" || action=="move" || action=="drag" || action=="scroll" || action=="type_text" || action=="keypress";
        pointerOperation=request.ContainsKey("operationId")?Convert.ToString(request["operationId"]):"";
        object result;
        try {
          Dictionary<string, object> args = (Dictionary<string, object>)request["args"];
          if (action == "type_text" || action == "keypress") result = ExecuteText(action,args);
          else if (action == "click" || action == "double_click" || action == "move" || action == "drag" || (action == "scroll" && (!args.ContainsKey("elementId") || (args.ContainsKey("_cancelEvent") && !Option(args,"_quietScroll",false))))) result = ExecutePointer(action,args);
          else if (action == "list_windows") result = ListWindows(args);
          else if (action == "browser_frame") result = MarkBrowserFrame(args);
          else if (action == "focus" || action == "invoke" || action == "set_value" || action == "scroll") result = ExecuteControl(action,args);
          else if (action == "launch_app" || action == "activate_window" || action == "move_window" || action == "close_window") result = ManageNativeWindow(action,args);
          else if (action == "screenshot") result = CaptureScreenshot(args);
          else if (action == "snapshot" || action == "accessibility_tree" || action == "find" || action == "element_info") result = ObserveAccessibility(action, args);
          else throw new InvalidOperationException("UNKNOWN_ACTION");
        } catch (Exception error) {
          Dictionary<string, object> failure = Result(false, action);
          failure["error"] = "WINDOWS_ERROR: " + error.Message;
          ActivationRefusedException refused=error as ActivationRefusedException;
          if(refused!=null)failure["activationDiagnostic"]=refused.Diagnostic;
          result = failure;
        }
        var payload=result as Dictionary<string,object>;
        if(payload!=null)FinishWindowReference(payload);
        Console.WriteLine(json.Serialize(new Dictionary<string, object> { { "id", request["id"] }, { "result", result } }));
        Console.Out.Flush();
      } catch (Exception error) {
        Console.Error.WriteLine("NATIVE_PROTOCOL_ERROR: " + error.Message);
      }
    }
    CleanupWindowReferences();
  }
}
