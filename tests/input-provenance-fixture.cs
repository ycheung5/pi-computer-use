using System;
using System.Runtime.InteropServices;
using System.Threading;
class InputProvenanceFixture {
  delegate IntPtr Hook(int code,IntPtr message,IntPtr data);
  [StructLayout(LayoutKind.Sequential)] struct Point {public int X,Y;}
  [StructLayout(LayoutKind.Sequential)] struct Mouse {public Point Point;public uint Data,Flags,Time;public UIntPtr Extra;}
  [StructLayout(LayoutKind.Sequential)] struct Key {public uint Code,Scan,Flags,Time;public UIntPtr Extra;}
  [StructLayout(LayoutKind.Sequential)] struct Message {public IntPtr Window;public uint Id;public UIntPtr W;public IntPtr L;public uint Time;public Point Point;public uint Private;}
  [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SetWindowsHookEx(int kind,Hook callback,IntPtr module,uint thread);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook,int code,IntPtr message,IntPtr data);
  [DllImport("user32.dll")] static extern int GetMessage(out Message message,IntPtr window,uint first,uint last);
  [DllImport("user32.dll")] static extern bool TranslateMessage(ref Message message);
  [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref Message message);
  [DllImport("user32.dll")] static extern bool PostThreadMessage(uint thread,uint message,UIntPtr w,IntPtr l);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
  static long unmarkedMouse,injectedMouse,taggedMouse,unmarkedKey,injectedKey,taggedKey;
  static readonly UIntPtr tag=new UIntPtr(0x50494355);
  static readonly Hook mouse=OnMouse,key=OnKey;
  static IntPtr OnMouse(int code,IntPtr message,IntPtr data){if(code>=0){Mouse x=(Mouse)Marshal.PtrToStructure(data,typeof(Mouse));if((x.Flags&1)==0)Interlocked.Increment(ref unmarkedMouse);else if(x.Extra==tag)Interlocked.Increment(ref taggedMouse);else Interlocked.Increment(ref injectedMouse);}return CallNextHookEx(IntPtr.Zero,code,message,data);}
  static IntPtr OnKey(int code,IntPtr message,IntPtr data){if(code>=0){Key x=(Key)Marshal.PtrToStructure(data,typeof(Key));if((x.Flags&0x10)==0)Interlocked.Increment(ref unmarkedKey);else if(x.Extra==tag)Interlocked.Increment(ref taggedKey);else Interlocked.Increment(ref injectedKey);}return CallNextHookEx(IntPtr.Zero,code,message,data);}
  static void Main(){
    IntPtr m=SetWindowsHookEx(14,mouse,GetModuleHandle(null),0),k=SetWindowsHookEx(13,key,GetModuleHandle(null),0);
    if(m==IntPtr.Zero||k==IntPtr.Zero){if(m!=IntPtr.Zero)UnhookWindowsHookEx(m);if(k!=IntPtr.Zero)UnhookWindowsHookEx(k);Console.Error.WriteLine("INPUT_OBSERVER_UNAVAILABLE");Environment.ExitCode=1;return;}
    uint thread=GetCurrentThreadId();Console.WriteLine("ready");Console.Out.Flush();
    ThreadPool.QueueUserWorkItem(delegate {string command;while((command=Console.ReadLine())!=null){if(command=="snapshot"){Console.WriteLine("counts:"+Interlocked.Read(ref unmarkedMouse)+":"+Interlocked.Read(ref injectedMouse)+":"+Interlocked.Read(ref taggedMouse)+":"+Interlocked.Read(ref unmarkedKey)+":"+Interlocked.Read(ref injectedKey)+":"+Interlocked.Read(ref taggedKey));Console.Out.Flush();}else break;}PostThreadMessage(thread,0x12,UIntPtr.Zero,IntPtr.Zero);});
    try {Message x;while(GetMessage(out x,IntPtr.Zero,0,0)>0){TranslateMessage(ref x);DispatchMessage(ref x);}} finally {UnhookWindowsHookEx(m);UnhookWindowsHookEx(k);}
  }
}
