using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows;
using System.Windows.Automation;

partial class WindowsBridge {
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumWindow callback, IntPtr parameter);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr handle, uint flags);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr handle);
  sealed class ObservedElement {
    public AutomationElement Element;
    public IntPtr Window;
    public uint Owner;
    public DateTime Seen;
  }
  static readonly Dictionary<string, ObservedElement> observed = new Dictionary<string, ObservedElement>();
  static bool Option(Dictionary<string,object> args, string key, bool fallback) { return args.ContainsKey(key) ? Convert.ToBoolean(args[key]) : fallback; }
  static string TextOption(Dictionary<string,object> args, string key, string fallback) { return args.ContainsKey(key) ? Convert.ToString(args[key]) : fallback; }
  static int NumberOption(Dictionary<string,object> args, string key, int fallback) { return args.ContainsKey(key) ? Convert.ToInt32(args[key]) : fallback; }
  static string WindowTitle(IntPtr handle) { StringBuilder value=new StringBuilder(2048); GetWindowText(handle,value,value.Capacity); return value.ToString(); }
  static uint WindowOwner(IntPtr handle) { uint owner; GetWindowThreadProcessId(handle,out owner); return owner; }
  static IntPtr ResolveObservationWindow(Dictionary<string,object> args) {
    long explicitHandle=args.ContainsKey("nativeWindowHandle") ? Convert.ToInt64(args["nativeWindowHandle"]) : 0;
    uint owner=args.ContainsKey("processId") ? Convert.ToUInt32(args["processId"]) : 0;
    string title=TextOption(args,"windowTitle","");
    IntPtr handle=IntPtr.Zero;
    if(explicitHandle!=0) {
      handle=new IntPtr(explicitHandle);
      if(!IsWindow(handle) || (owner!=0 && WindowOwner(handle)!=owner) || (title.Length>0 && WindowTitle(handle).IndexOf(title,StringComparison.OrdinalIgnoreCase)<0)) throw new InvalidOperationException("TARGET_IDENTITY_CHANGED: window no longer matches the requested owner/target; observe again");
    } else if(owner!=0 || title.Length>0) {
      List<IntPtr> candidates=new List<IntPtr>();
      EnumWindows(delegate(IntPtr candidate,IntPtr ignored) {
        if(!IsWindowVisible(candidate)) return true;
        if(owner!=0 && WindowOwner(candidate)!=owner) return true;
        if(title.Length>0 && WindowTitle(candidate).IndexOf(title,StringComparison.OrdinalIgnoreCase)<0) return true;
        candidates.Add(candidate); return true;
      },IntPtr.Zero);
      if(candidates.Count==0) throw new InvalidOperationException("TARGET_NOT_FOUND: no window matches the requested target");
      if(candidates.Count>1) throw new InvalidOperationException("AMBIGUOUS_TARGET: multiple windows match; specify nativeWindowHandle");
      handle=candidates[0];
    } else handle=GetForegroundWindow();
    if(handle==IntPtr.Zero || !IsWindow(handle)) throw new InvalidOperationException("TARGET_NOT_FOUND: no usable foreground window");
    CheckPointerTitle(args,handle);
    UIntPtr ignoredResult;
    bool responsive=SendMessageTimeout(handle,0,UIntPtr.Zero,IntPtr.Zero,3,100,out ignoredResult)!=IntPtr.Zero;
    if(!responsive) throw new InvalidOperationException(Marshal.GetLastWin32Error()==5 ? "TARGET_ACCESS_DENIED: Windows refused access" : "TARGET_UNRESPONSIVE: avoid repeated UIA reads; use native discovery/capture");
    if(Option(args,"activate",false) && GetForegroundWindow()!=handle && !SetForegroundWindow(handle)) throw new InvalidOperationException("TARGET_ACTIVATION_REFUSED: Windows did not grant foreground access");
    return handle;
  }
  static Dictionary<string,object> UiaBox(System.Windows.Rect bounds) {
    return new Dictionary<string,object> { {"x",bounds.X},{"y",bounds.Y},{"width",bounds.Width},{"height",bounds.Height},{"centerX",bounds.X+bounds.Width/2},{"centerY",bounds.Y+bounds.Height/2} };
  }
  static string RuntimeId(AutomationElement element) { return "uia:rt:"+String.Join("-",element.GetRuntimeId()); }
  static void PruneElements() {
    List<string> remove=new List<string>(); DateTime cutoff=DateTime.UtcNow.AddMinutes(-5);
    foreach(KeyValuePair<string,ObservedElement> item in observed) if(item.Value.Seen<cutoff || !IsWindow(item.Value.Window) || WindowOwner(item.Value.Window)!=item.Value.Owner) remove.Add(item.Key);
    foreach(string key in remove) observed.Remove(key);
    if(observed.Count>20000) observed.Clear();
  }
  static Dictionary<string,object> DescribeElement(AutomationElement element, IntPtr window, bool full, int depth) {
    AutomationElement.AutomationElementInformation current=element.Current;
    string id=RuntimeId(element);
    if(window==IntPtr.Zero) {
      IntPtr own=new IntPtr(current.NativeWindowHandle);
      if(own!=IntPtr.Zero) window=GetAncestor(own,2);
      else {
        AutomationElement parent=element;
        for(int level=0;level<128 && parent!=null;level++) { int hwnd=parent.Current.NativeWindowHandle; if(hwnd!=0) { window=GetAncestor(new IntPtr(hwnd),2); break; } parent=TreeWalker.RawViewWalker.GetParent(parent); }
      }
    }
    if(window!=IntPtr.Zero && IsWindow(window)) observed[id]=new ObservedElement { Element=element,Window=window,Owner=WindowOwner(window),Seen=DateTime.UtcNow };
    Dictionary<string,object> info=new Dictionary<string,object> { {"id",id},{"name",current.Name},{"controlType",current.ControlType.ProgrammaticName.Replace("ControlType.","")},{"depth",depth},{"isEnabled",current.IsEnabled},{"isOffscreen",current.IsOffscreen},{"hasKeyboardFocus",current.HasKeyboardFocus},{"isPassword",current.IsPassword} };
    if(!current.BoundingRectangle.IsEmpty) info["boundingBox"]=UiaBox(current.BoundingRectangle);
    if(current.AutomationId.Length>0) info["automationId"]=current.AutomationId;
    if(current.ClassName.Length>0) info["className"]=current.ClassName;
    if(full) {
      info["processId"]=current.ProcessId; info["nativeWindowHandle"]=current.NativeWindowHandle; info["runtimeId"]=element.GetRuntimeId(); info["localizedControlType"]=current.LocalizedControlType;
      List<string> patterns=new List<string>(); foreach(AutomationPattern pattern in element.GetSupportedPatterns()) patterns.Add(pattern.ProgrammaticName.Replace("PatternIdentifiers.Pattern","")); info["patterns"]=patterns;
      object value;
      if(!current.IsPassword && element.TryGetCurrentPattern(ValuePattern.Pattern,out value)) { string text=((ValuePattern)value).Current.Value; if(text.Length>0) info["value"]=text.Length>2000 ? text.Substring(0,2000) : text; }
    }
    return info;
  }
  static AutomationElement ResolveObservedElement(string id, Dictionary<string,object> args, out IntPtr window) {
    ObservedElement entry;
    if(id.StartsWith("uia:hwnd:",StringComparison.Ordinal)) {
      string[] parts=id.Split(':'); long handle; uint pid;
      if(parts.Length!=5 || parts[3]!="pid" || !Int64.TryParse(parts[2],out handle) || !UInt32.TryParse(parts[4],out pid)) throw new InvalidOperationException("INVALID_ELEMENT_ID");
      window=new IntPtr(handle);
      if(!IsWindow(window) || WindowOwner(window)!=pid) throw new InvalidOperationException("STALE_ELEMENT: native window identity changed");
      ValidateElementTarget(window,args); return AutomationElement.FromHandle(window);
    }
    if(!observed.TryGetValue(id,out entry) || entry.Seen<DateTime.UtcNow.AddMinutes(-5)) throw new InvalidOperationException("STALE_ELEMENT: element was not observed or has expired; observe again");
    window=entry.Window;
    if(!IsWindow(window) || WindowOwner(window)!=entry.Owner) { observed.Remove(id); throw new InvalidOperationException("STALE_ELEMENT: owning window identity changed"); }
    ValidateElementTarget(window,args);
    try { if(RuntimeId(entry.Element)!=id) throw new InvalidOperationException("STALE_ELEMENT: runtime identity changed"); AutomationElement.AutomationElementInformation current=entry.Element.Current; if(current.ControlType==null) throw new InvalidOperationException("STALE_ELEMENT"); return entry.Element; }
    catch(ElementNotAvailableException) { observed.Remove(id); throw new InvalidOperationException("STALE_ELEMENT: control no longer exists; observe again"); }
  }
  static void ValidateElementTarget(IntPtr window, Dictionary<string,object> args) {
    if(args.ContainsKey("nativeWindowHandle") || args.ContainsKey("processId") || args.ContainsKey("windowTitle")) if(ResolveObservationWindow(args)!=window) throw new InvalidOperationException("ELEMENT_WRONG_OWNER: element belongs to a different target window");
  }
  sealed class Traversal {
    public Stopwatch Watch=Stopwatch.StartNew(); public int Budget,Maximum,Depth,Count; public string Reason; public string Error; public bool Offscreen,Full,BrowserLayout; public TreeWalker Walker;
    public bool CanRead() { if(Watch.ElapsedMilliseconds>=Budget) { if(Reason==null) Reason="treeTimeoutMs"; return false; } if(Count>=Maximum) { if(Reason==null) Reason="maxNodes"; return false; } return true; }
  }
  static Dictionary<string,object> ReadTree(AutomationElement element,IntPtr window,int depth,int physicalDepth,Traversal state) {
    if(!state.CanRead()) return null;
    if(physicalDepth>128) { state.Reason="providerDepth"; return null; }
    Dictionary<string,object> node;
    try { node=DescribeElement(element,window,state.Full,depth); }
    catch(ElementNotAvailableException) { state.Reason="providerError"; state.Error="An element disappeared during observation"; return null; }
    state.Count++;
    List<object> children=new List<object>();
    AutomationElement child=state.Walker.GetFirstChild(element);
    while(child!=null && state.CanRead()) {
      bool include=state.Offscreen || !child.Current.IsOffscreen;
      if(include) {
        bool transparent=state.BrowserLayout && child.Current.ControlType==ControlType.Pane && child.Current.Name.Length==0;
        int childDepth=depth+(transparent?0:1);
        if(childDepth>state.Depth) { if(state.Reason==null) state.Reason="maxDepth"; }
        else { Dictionary<string,object> item=ReadTree(child,window,childDepth,physicalDepth+1,state); if(item!=null) children.Add(item); }
      }
      if(state.Reason=="maxNodes" || state.Reason=="treeTimeoutMs") break;
      child=state.Walker.GetNextSibling(child);
    }
    if(children.Count>0) node["children"]=children;
    return node;
  }
  static TreeWalker ObservationWalker(string view) { return view=="raw" ? TreeWalker.RawViewWalker : view=="content" ? TreeWalker.ContentViewWalker : TreeWalker.ControlViewWalker; }
  static Dictionary<string,object> WarmBrowser(IntPtr window,Traversal state) {
    List<IntPtr> renderers=new List<IntPtr>();
    EnumChildWindows(window,delegate(IntPtr child,IntPtr ignored) { StringBuilder name=new StringBuilder(256); GetClassName(child,name,name.Capacity); if(name.ToString()=="Chrome_RenderWidgetHostHWND") renderers.Add(child); return true; },IntPtr.Zero);
    if(renderers.Count==0) return null;
    int ready=0; long start=state.Watch.ElapsedMilliseconds; long budget=Math.Min(1500,state.Budget/2);
    do {
      ready=0;
      foreach(IntPtr renderer in renderers) {
        if(state.Watch.ElapsedMilliseconds>=state.Budget) break;
        try { AutomationElement root=TreeWalker.RawViewWalker.GetFirstChild(AutomationElement.FromHandle(renderer)); if(root!=null) { ControlType type=root.Current.ControlType; if(TreeWalker.RawViewWalker.GetFirstChild(root)!=null) ready++; } } catch(ElementNotAvailableException) {} catch(InvalidOperationException) {}
      }
      if(ready==renderers.Count || state.Watch.ElapsedMilliseconds-start>=budget) break;
      Thread.Sleep(50);
    } while(true);
    return new Dictionary<string,object>{{"renderers",renderers.Count},{"ready",ready},{"waitedMs",state.Watch.ElapsedMilliseconds-start},{"state",ready==renderers.Count ? "ready" : ready>0 ? "partial" : "starting"}};
  }
  static void FindMatches(Dictionary<string,object> node,string query,string control,List<object> matches,int maximum) {
    if(node==null || matches.Count>=maximum) return;
    string text=""; foreach(string field in new string[]{"name","automationId","className","value","controlType"}) if(node.ContainsKey(field)) text+=" "+Convert.ToString(node[field]);
    if(text.IndexOf(query,StringComparison.OrdinalIgnoreCase)>=0 && (control.Length==0 || String.Equals(Convert.ToString(node["controlType"]),control,StringComparison.OrdinalIgnoreCase))) { Dictionary<string,object> match=new Dictionary<string,object>(node); match.Remove("children"); matches.Add(match); }
    if(node.ContainsKey("children")) foreach(object child in (List<object>)node["children"]) { FindMatches((Dictionary<string,object>)child,query,control,matches,maximum); if(matches.Count>=maximum) break; }
  }
  static object ObserveAccessibility(string action, Dictionary<string,object> args) {
    PruneElements(); bool full=TextOption(args,"detailLevel","compact")=="full" || action=="find";
    if(action=="element_info") {
      IntPtr owner; AutomationElement element;
      if(args.ContainsKey("elementId")) element=ResolveObservedElement(Convert.ToString(args["elementId"]),args,out owner);
      else { element=AutomationElement.FromPoint(new System.Windows.Point(Convert.ToInt32(args["x"]),Convert.ToInt32(args["y"]))); owner=IntPtr.Zero; if(args.ContainsKey("nativeWindowHandle") || args.ContainsKey("processId") || args.ContainsKey("windowTitle")) { IntPtr target=ResolveObservationWindow(args); Dictionary<string,object> info=DescribeElement(element,IntPtr.Zero,full,0); ObservedElement entry; if(!observed.TryGetValue(Convert.ToString(info["id"]),out entry) || entry.Window!=target) throw new InvalidOperationException("ELEMENT_WRONG_OWNER: point is outside target"); owner=target; } }
      Dictionary<string,object> result=Result(true,action); result["element"]=DescribeElement(element,owner,full,0); return result;
    }
    bool desktop=TextOption(args,"scope","active_window")=="desktop";
    IntPtr window=desktop ? IntPtr.Zero : ResolveObservationWindow(args);
    if(window!=IntPtr.Zero){RememberPointerOrigin(window);RememberPointerTitle(args,window);}
    Traversal state=new Traversal { Budget=NumberOption(args,"treeTimeoutMs",5000),Maximum=NumberOption(args,"maxNodes",500),Depth=NumberOption(args,"maxDepth",6),Offscreen=Option(args,"includeOffscreen",false),Full=full,Walker=ObservationWalker(TextOption(args,"viewMode","control")) };
    if(window!=IntPtr.Zero) { StringBuilder name=new StringBuilder(256); GetClassName(window,name,name.Capacity); state.BrowserLayout=name.ToString().StartsWith("Chrome_",StringComparison.Ordinal) || name.ToString().StartsWith("Mozilla",StringComparison.Ordinal); }
    Dictionary<string,object> web=window==IntPtr.Zero ? null : WarmBrowser(window,state);
    Dictionary<string,object> root=null;
    try { AutomationElement element=desktop ? AutomationElement.RootElement : AutomationElement.FromHandle(window); root=ReadTree(element,window,0,0,state); }
    catch(Exception error) { state.Reason="providerError"; state.Error=error.Message; }
    Dictionary<string,object> output=Result(root!=null,action); output["scope"]=desktop?"desktop":"active_window"; output["tree"]=root; output["nodeCount"]=state.Count; output["truncated"]=state.Reason!=null; output["durationMs"]=state.Watch.ElapsedMilliseconds; output["treeTimeoutMs"]=state.Budget; output["viewMode"]=TextOption(args,"viewMode","control"); output["includeOffscreen"]=state.Offscreen; output["detailLevel"]=TextOption(args,"detailLevel","compact");
    if(window!=IntPtr.Zero) { output["nativeWindowHandle"]=window.ToInt64(); output["processId"]=WindowOwner(window); }
    if(web!=null) output["webContent"]=web;
    if(state.Reason!=null) { output["truncationReason"]=state.Reason; output["conclusive"]=false; }
    if(state.Error!=null) { output["providerError"]=state.Error; if(root==null) output["error"]="UIA_PROVIDER_ERROR: "+state.Error; }
    if(action=="find") { List<object> matches=new List<object>(); FindMatches(root,TextOption(args,"query",""),TextOption(args,"controlType",""),matches,NumberOption(args,"maxResults",25)); output.Remove("tree"); output["matches"]=matches; output["query"]=TextOption(args,"query",""); if(matches.Count==0 && Option(args,"ocrFallback",true) && TextOption(args,"controlType","").Length==0 && (state.Count<=20 || state.Reason!=null)) output["ocrFallbackPending"]=true; }
    return output;
  }
}
