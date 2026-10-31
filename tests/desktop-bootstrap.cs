// TEST ONLY: connect this exact thread to an unswitched owned desktop before entry.
using System;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
class DesktopBootstrap {
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern IntPtr CreateDesktop(string name,IntPtr device,IntPtr mode,uint flags,uint access,IntPtr security);
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern IntPtr OpenDesktop(string name,uint flags,bool inherit,uint access);
 [DllImport("user32.dll",SetLastError=true)]static extern bool SetThreadDesktop(IntPtr desktop);
 [DllImport("user32.dll")]static extern IntPtr GetThreadDesktop(uint thread);
 [DllImport("kernel32.dll")]static extern uint GetCurrentThreadId();
 [DllImport("user32.dll")]static extern bool CloseDesktop(IntPtr desktop);
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool GetUserObjectInformation(IntPtr desktop,int index,StringBuilder name,int size,out int needed);
 [MTAThread]
 static int Main(string[] args){IntPtr desktop=IntPtr.Zero;try{
  if(args[0]=="--verify-absent"){desktop=OpenDesktop(args[1],0,false,1);if(desktop!=IntPtr.Zero)throw new InvalidOperationException("Owned desktop still exists");int error=Marshal.GetLastWin32Error();if(error!=2 && error!=6)throw new InvalidOperationException("Desktop absence unavailable:"+error);Console.WriteLine("absent");return 0;}
  desktop=CreateDesktop(args[0],IntPtr.Zero,IntPtr.Zero,0,0x01ff,IntPtr.Zero);if(desktop==IntPtr.Zero || !SetThreadDesktop(desktop))throw new InvalidOperationException("Owned desktop setup failed:"+Marshal.GetLastWin32Error());
  var name=new StringBuilder(256);int needed;uint thread=GetCurrentThreadId();if(!GetUserObjectInformation(GetThreadDesktop(thread),2,name,512,out needed) || name.ToString()!=args[0])throw new InvalidOperationException("Owned thread desktop identity unavailable");
  File.WriteAllText(args[1],"{\"pid\":"+System.Diagnostics.Process.GetCurrentProcess().Id+",\"tid\":"+thread+",\"desktop\":\""+name.ToString()+"\"}");
#if FIXTURE
  string[] forwarded=new string[args.Length-2];Array.Copy(args,2,forwarded,0,forwarded.Length);typeof(AccessibilityFixture).GetMethod("Main",BindingFlags.Static|BindingFlags.NonPublic).Invoke(null,new object[]{forwarded});
#else
  typeof(WindowsBridge).GetMethod("Main",BindingFlags.Static|BindingFlags.NonPublic).Invoke(null,null);
#endif
  return 0;
 }catch(Exception error){Console.Error.WriteLine(error.ToString());return 1;}finally{if(desktop!=IntPtr.Zero)CloseDesktop(desktop);}}
}
