using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

partial class WindowsBridge {
  [DllImport("dwmapi.dll",EntryPoint="DwmGetWindowAttribute")] static extern int GetBrowserBorder(IntPtr window,int attribute,out uint value,int bytes);
  [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr window,int attribute,ref uint value,int bytes);
  class BrowserBorder { public IntPtr Window;public uint Process,Original; }
  static readonly Dictionary<long,BrowserBorder> browserBorders=new Dictionary<long,BrowserBorder>();
  static object MarkBrowserFrame(Dictionary<string,object> args) {
    uint owner=Convert.ToUInt32(args["processId"]);bool clear=Option(args,"clear",false);int applied=0,refused=0;
    using(Process process=Process.GetProcessById((int)owner)) {
      IntPtr identity=process.Handle;
      if(process.HasExited)throw new InvalidOperationException("BROWSER_PROCESS_EXITED");
      if(clear) {
        foreach(BrowserBorder entry in new List<BrowserBorder>(browserBorders.Values))if(entry.Process==owner) {
          if(IsWindow(entry.Window) && WindowOwner(entry.Window)==owner) {uint original=entry.Original;if(DwmSetWindowAttribute(entry.Window,34,ref original,4)==0)applied++;else refused++;}
          browserBorders.Remove(entry.Window.ToInt64());
        }
      } else EnumWindows(delegate(IntPtr window,IntPtr unused) {
        if(!IsWindowVisible(window) || WindowOwner(window)!=owner)return true;
        uint original;BrowserBorder entry;
        if(!browserBorders.TryGetValue(window.ToInt64(),out entry)) {
          if(GetBrowserBorder(window,34,out original,4)!=0)original=0xFFFFFFFF;
          entry=new BrowserBorder {Window=window,Process=owner,Original=original};
        }
        uint blue=0x00EB841C;
        if(!process.HasExited && WindowOwner(window)==owner && DwmSetWindowAttribute(window,34,ref blue,4)==0) {browserBorders[window.ToInt64()]=entry;applied++;}else refused++;
        return true;
      },IntPtr.Zero);
    }
    Dictionary<string,object> result=Result(true,"browser_frame");result["applied"]=applied;result["refused"]=refused;
    if(applied==0)result["warning"]="No owned visible browser frame accepted DWM border color; verify visual presentation manually";
    return result;
  }
}
