using System;
using System.Collections.Generic;

partial class WindowsBridge {
  sealed class WindowReference {
    internal string Id,Marker;internal IntPtr Window;internal uint Owner;internal DateTime Seen;
  }
  static readonly string referenceEpoch=Convert.ToBase64String(Guid.NewGuid().ToByteArray()).TrimEnd('=').Replace('+','-').Replace('/','_');
  static long referenceSequence,elementSequence;
  static readonly Dictionary<string,WindowReference> windowReferences=new Dictionary<string,WindowReference>();
  static WindowReference currentReference;
  static bool CurrentReferenceIntact() {return currentReference==null || WindowMarker.Matches(currentReference.Window,currentReference.Owner,currentReference.Marker);}
  static void CheckReferenceBeforeDispatch() {if(currentReference!=null)CheckWindowReference(currentReference.Window);}
  static void CheckWindowReference(IntPtr window) {
    if(currentReference!=null && currentReference.Window==window && !WindowMarker.Matches(window,currentReference.Owner,currentReference.Marker))throw new InvalidOperationException("WINDOW_REFERENCE_LOST: lifetime proof is unavailable; observe again; never replay uncertain effects");
  }
  static WindowReference ResolveWindowReference(Dictionary<string,object> args) {
    if(!args.ContainsKey("windowRef"))return null;
    string id=Convert.ToString(args["windowRef"]);WindowReference entry;
    if(!windowReferences.TryGetValue(id,out entry) || entry.Seen<DateTime.UtcNow.AddMinutes(-5))throw new InvalidOperationException("STALE_WINDOW_REFERENCE: unknown or expired reference; observe again");
    if(!WindowMarker.Matches(entry.Window,entry.Owner,entry.Marker))throw new InvalidOperationException("WINDOW_REFERENCE_LOST: lifetime proof is unavailable; observe again");
    if((args.ContainsKey("nativeWindowHandle") && Convert.ToInt64(args["nativeWindowHandle"])!=entry.Window.ToInt64()) || (args.ContainsKey("processId") && Convert.ToUInt32(args["processId"])!=entry.Owner) || (args.ContainsKey("windowTitle") && WindowTitle(entry.Window).IndexOf(Convert.ToString(args["windowTitle"]),StringComparison.OrdinalIgnoreCase)<0))throw new InvalidOperationException("WINDOW_REFERENCE_CONFLICT: selectors disagree with the observed lifetime");
    if(TextOption(args,"scope","")=="desktop" || args.ContainsKey("browserTab"))throw new InvalidOperationException("WINDOW_REFERENCE_CONFLICT: window reference cannot target desktop or browser channel");
    entry.Seen=DateTime.UtcNow;currentReference=entry;return entry;
  }
  static object ObserveReferencePresence(Dictionary<string,object> args) {
    WindowReference entry;string id=Convert.ToString(args["windowRef"]);
    if(windowReferences.TryGetValue(id,out entry) && entry.Seen>=DateTime.UtcNow.AddMinutes(-5) && !IsWindow(entry.Window))return new Dictionary<string,object>{{"ok",true},{"action","list_windows"},{"referencePresent",false},{"windows",new List<object>()}};
    entry=ResolveWindowReference(args);
    return new Dictionary<string,object>{{"ok",true},{"action","list_windows"},{"referencePresent",true},{"windows",new List<object>()}};
  }
  static void PruneWindowReferences() {
    var remove=new List<string>();
    foreach(var pair in windowReferences)if(pair.Value.Seen<DateTime.UtcNow.AddMinutes(-5) || !WindowMarker.Matches(pair.Value.Window,pair.Value.Owner,pair.Value.Marker))remove.Add(pair.Key);
    foreach(string id in remove){WindowReference entry=windowReferences[id];WindowMarker.Remove(entry.Window,entry.Owner,entry.Marker);windowReferences.Remove(id);}
  }
  static WindowReference ObserveWindowReference(IntPtr window,Dictionary<string,object> metadata) {
    if(window==IntPtr.Zero)return null;
    CheckWindowReference(window);uint owner=WindowOwner(window);
    foreach(var pair in windowReferences)if(pair.Value.Window==window && pair.Value.Owner==owner && pair.Value.Seen>=DateTime.UtcNow.AddMinutes(-5) && WindowMarker.Matches(window,owner,pair.Value.Marker)){pair.Value.Seen=DateTime.UtcNow;return pair.Value;}
    PruneWindowReferences();
    if(windowReferences.Count>=4096){metadata["windowRefUnavailable"]="REFERENCE_CAPACITY: observe again after expiry";return null;}
    string serial=(++referenceSequence).ToString("x"),marker="PiComputerUse.Window."+referenceEpoch+"."+serial;int error;
    if(!WindowMarker.Bind(window,owner,marker,out error)){metadata["windowRefUnavailable"]="WINDOW_REFERENCE_UNAVAILABLE: marker acquisition failed (native error "+error+")";return null;}
    var entry=new WindowReference {Id="w:"+referenceEpoch+":"+serial,Marker=marker,Window=window,Owner=owner,Seen=DateTime.UtcNow};windowReferences.Add(entry.Id,entry);return entry;
  }
  static void AddWindowReference(Dictionary<string,object> metadata,IntPtr window) {
    WindowReference entry=ObserveWindowReference(window,metadata);if(entry!=null)metadata["windowRef"]=entry.Id;
  }
  static Dictionary<string,object> WindowReferenceDescriptor(IntPtr window) {
    WindowReference entry=currentReference!=null && currentReference.Window==window?currentReference:ObserveWindowReference(window,new Dictionary<string,object>());
    return entry==null?null:new Dictionary<string,object>{{"name",entry.Marker},{"windowRef",entry.Id}};
  }
  static void CleanupWindowReferences() {
    foreach(var pair in windowReferences)WindowMarker.Remove(pair.Value.Window,pair.Value.Owner,pair.Value.Marker);
    windowReferences.Clear();observed.Clear();elementKeys.Clear();
  }
}
