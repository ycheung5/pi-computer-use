using System;
using System.Runtime.InteropServices;

// Stateless witness checks shared by the authoritative bridge and delegated WGC.
static class WindowMarker {
  [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool SetProp(IntPtr window,string name,IntPtr value);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetProp(IntPtr window,string name);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr RemoveProp(IntPtr window,string name);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint owner);
  internal static bool Matches(IntPtr window,uint owner,string name) {
    uint actual;GetWindowThreadProcessId(window,out actual);
    return owner!=0 && actual==owner && IsWindow(window) && GetProp(window,name)==new IntPtr(1);
  }
  internal static bool Bind(IntPtr window,uint owner,string name,out int error) {
    uint actual;GetWindowThreadProcessId(window,out actual);error=0;
    if(actual!=owner || owner==0 || !IsWindow(window))return false;
    if(!SetProp(window,name,new IntPtr(1))){error=Marshal.GetLastWin32Error();return false;}
    if(Matches(window,owner,name))return true;
    Remove(window,owner,name);return false;
  }
  internal static void Remove(IntPtr window,uint owner,string name) {if(Matches(window,owner,name))RemoveProp(window,name);}
}
