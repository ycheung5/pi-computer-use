// Hidden owned control only: compare IMM API observations on creator and observer threads.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
class ImeOwnerFixture {
 [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
 [DllImport("imm32.dll",SetLastError=true)] static extern IntPtr ImmGetContext(IntPtr window);
 [DllImport("imm32.dll")] static extern bool ImmReleaseContext(IntPtr window,IntPtr context);
 [DllImport("imm32.dll")] static extern bool ImmGetOpenStatus(IntPtr context);
 static object Sample(IntPtr hwnd) {
  IntPtr context=ImmGetContext(hwnd);
  var result=new Dictionary<string,object>{{"available",context!=IntPtr.Zero},{"rawOpen",null}};
  if(context!=IntPtr.Zero)try {result["rawOpen"]=ImmGetOpenStatus(context);}finally {ImmReleaseContext(hwnd,context);}
  return result;
 }
 static int Main() {
  var ready=new ManualResetEvent(false);var done=new ManualResetEvent(false);
  IntPtr hwnd=IntPtr.Zero;uint ownerThread=0;object owner=null;Exception failure=null;
  var thread=new Thread(delegate(){try {using(var editor=new TextBox()) {hwnd=editor.Handle;ownerThread=GetCurrentThreadId();owner=Sample(hwnd);ready.Set();done.WaitOne();}}catch(Exception e){failure=e;ready.Set();}});
  thread.SetApartmentState(ApartmentState.STA);thread.Start();
  try {
   if(!ready.WaitOne(5000))throw new Exception("Owner thread did not initialize");
   if(failure!=null)throw failure;
   if(hwnd==IntPtr.Zero || ownerThread==0)throw new Exception("Owned hidden control missing");
   uint observerThread=GetCurrentThreadId();
   if(observerThread==ownerThread)throw new Exception("Observer must be a different OS thread");
   object observer=Sample(hwnd);
   Console.WriteLine(new JavaScriptSerializer().Serialize(new Dictionary<string,object>{{"windowHwnd",hwnd.ToInt64()},{"ownerThreadId",ownerThread},{"observerThreadId",observerThread},{"owner",owner},{"observer",observer}}));
   return 0;
  } finally {done.Set();if(!thread.Join(5000))throw new Exception("Owner thread did not exit");ready.Dispose();done.Dispose();}
 }
}
