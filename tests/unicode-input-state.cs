// Read-only test probe: target-thread focus/layout/legacy IME availability, never input.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
class UnicodeInputState {
 [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left,Top,Right,Bottom; }
 [StructLayout(LayoutKind.Sequential)] struct GuiInfo { public uint Size,Flags;public IntPtr Active,Focus,Capture,MenuOwner,MoveSize,Caret;public Rect CaretRect; }
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint process);
 [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread,ref GuiInfo info);
 [DllImport("user32.dll")] static extern IntPtr GetKeyboardLayout(uint thread);
 [DllImport("imm32.dll")] static extern IntPtr ImmGetContext(IntPtr window);
 [DllImport("imm32.dll")] static extern bool ImmReleaseContext(IntPtr window,IntPtr context);
 [DllImport("imm32.dll")] static extern bool ImmGetOpenStatus(IntPtr context);
 [DllImport("imm32.dll")] static extern bool ImmGetConversionStatus(IntPtr context,out uint conversion,out uint sentence);
 static void Main(string[] args) {
  IntPtr window=new IntPtr(Int64.Parse(args[0]));int requestedProcess=Int32.Parse(args[1]);uint process,foregroundProcess,focusProcess=0;
  uint thread=GetWindowThreadProcessId(window,out process);IntPtr foreground=GetForegroundWindow();GetWindowThreadProcessId(foreground,out foregroundProcess);
  GuiInfo gui=new GuiInfo{Size=(uint)Marshal.SizeOf(typeof(GuiInfo))};bool focusAvailable=GetGUIThreadInfo(thread,ref gui);
  if(focusAvailable && gui.Focus!=IntPtr.Zero)GetWindowThreadProcessId(gui.Focus,out focusProcess);
  IntPtr layout=GetKeyboardLayout(thread),context=focusAvailable?ImmGetContext(gui.Focus):IntPtr.Zero;
  var ime=new Dictionary<string,object>{{"available",context!=IntPtr.Zero},{"scope","legacy IMM context; absence does not establish TSF/IME disabled"}};
  if(context!=IntPtr.Zero)try{uint conversion,sentence;ime["open"]=ImmGetOpenStatus(context);bool modes=ImmGetConversionStatus(context,out conversion,out sentence);ime["conversionStatusAvailable"]=modes;if(modes){ime["conversionMode"]=conversion;ime["sentenceMode"]=sentence;}}finally{ImmReleaseContext(gui.Focus,context);}
  string version=null;try{version=Process.GetProcessById(requestedProcess).MainModule.FileVersionInfo.FileVersion;}catch(Exception){}
  var value=new Dictionary<string,object>{{"targetHwnd",window.ToInt64()},{"targetProcessId",process},{"targetThreadId",thread},{"foregroundHwnd",foreground.ToInt64()},{"foregroundProcessId",foregroundProcess},{"focusAvailable",focusAvailable},{"focusHwnd",gui.Focus.ToInt64()},{"focusProcessId",focusProcess},{"keyboardLayoutHex","0x"+layout.ToInt64().ToString("X")},{"keyboardLanguageId",layout.ToInt64() & 0xFFFF},{"ime",ime},{"processFileVersion",version},{"osVersion",Environment.OSVersion.VersionString}};
  Console.WriteLine(new JavaScriptSerializer().Serialize(value));
 }
}
