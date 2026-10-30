// Test-only Windows job preflight. It controls only copies of this executable.
// It neither accesses the clipboard nor sends desktop input.
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

static class ProcessContainmentFixture {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct STARTUPINFO {
    public int cb; public string reserved, desktop, title; public int x,y,xSize,ySize,xCount,yCount,fill,flags; public short show,reserved2; public IntPtr reservedPtr,stdin,stdout,stderr;
  }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr process,thread; public int pid,tid; }
  [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMIT { public long processTime,jobTime; public uint flags; public UIntPtr minimum,maximum; public uint active; public UIntPtr affinity; public uint priority,scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong readOps,writeOps,otherOps,readBytes,writeBytes,otherBytes; }
  [StructLayout(LayoutKind.Sequential)] struct EXTENDED_LIMIT { public BASIC_LIMIT basic; public IO_COUNTERS io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob; }
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr security,string name);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref EXTENDED_LIMIT info,uint size);
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern bool CreateProcess(string app,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr environment,string dir,ref STARTUPINFO startup,out PROCESS_INFORMATION info);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool result);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,int pid);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint ms);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static void Require(bool ok,string operation) { if(!ok) throw new InvalidOperationException(operation+": "+Marshal.GetLastWin32Error()); }
  static string Quote(string s) { return "\""+s+"\""; }
  static int Main(string[] args) {
    if(args.Length==2 && args[0]=="--child") {
      Process.Start(new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName,"--grandchild "+Quote(args[1])) { UseShellExecute=false,CreateNoWindow=true });
      Thread.Sleep(3000); File.WriteAllText(Path.Combine(args[1],"late-child"),"late"); return 0;
    }
    if(args.Length==2 && args[0]=="--grandchild") {
      string ready=Path.Combine(args[1],"ready");
      File.WriteAllText(ready+".tmp",Process.GetCurrentProcess().Id.ToString()); File.Move(ready+".tmp",ready);
      Thread.Sleep(3000); File.WriteAllText(Path.Combine(args[1],"late-grandchild"),"late"); return 0;
    }
    if(args.Length!=1) return 2;
    IntPtr job=IntPtr.Zero,grandchild=IntPtr.Zero; PROCESS_INFORMATION child=new PROCESS_INFORMATION(); bool assigned=false;
    try {
      string exe=Process.GetCurrentProcess().MainModule.FileName, folder=args[0];
      job=CreateJobObject(IntPtr.Zero,null); Require(job!=IntPtr.Zero,"CreateJobObject");
      EXTENDED_LIMIT limits=new EXTENDED_LIMIT(); limits.basic.flags=0x2000; // kill-on-job-close
      Require(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(EXTENDED_LIMIT))),"SetInformationJobObject");
      STARTUPINFO startup=new STARTUPINFO(); startup.cb=Marshal.SizeOf(typeof(STARTUPINFO));
      Require(CreateProcess(exe,new StringBuilder(Quote(exe)+" --child "+Quote(folder)),IntPtr.Zero,IntPtr.Zero,false,0x08000004,IntPtr.Zero,folder,ref startup,out child),"CreateProcess suspended");
      Require(AssignProcessToJobObject(job,child.process),"AssignProcessToJobObject"); assigned=true;
      Require(ResumeThread(child.thread)!=0xffffffff,"ResumeThread");
      string ready=Path.Combine(folder,"ready"); Stopwatch clock=Stopwatch.StartNew();
      while(!File.Exists(ready) && clock.ElapsedMilliseconds<5000) Thread.Sleep(20);
      Require(File.Exists(ready),"descendant ready");
      int pid; Require(Int32.TryParse(File.ReadAllText(ready),out pid),"descendant pid");
      grandchild=OpenProcess(0x00101000,false,pid); Require(grandchild!=IntPtr.Zero,"OpenProcess descendant");
      bool member; Require(IsProcessInJob(grandchild,job,out member)&&member,"descendant job membership");
      Require(TerminateJobObject(job,1),"TerminateJobObject");
      Require(WaitForSingleObject(child.process,5000)==0,"child exit");
      Require(WaitForSingleObject(grandchild,5000)==0,"descendant exit");
      Thread.Sleep(3100);
      bool late=File.Exists(Path.Combine(folder,"late-child"))||File.Exists(Path.Combine(folder,"late-grandchild"));
      Console.WriteLine("{\"descendantsObserved\":true,\"processesExited\":true,\"lateWrite\":"+(late?"true":"false")+"}");
      return late?1:0;
    } catch(Exception ex) { Console.Error.WriteLine(ex.Message); return 1; }
    finally {
      if(job!=IntPtr.Zero && assigned) TerminateJobObject(job,1);
      else if(child.process!=IntPtr.Zero) TerminateProcess(child.process,1);
      if(child.process!=IntPtr.Zero) WaitForSingleObject(child.process,5000);
      if(grandchild!=IntPtr.Zero) CloseHandle(grandchild);
      if(child.thread!=IntPtr.Zero) CloseHandle(child.thread);
      if(child.process!=IntPtr.Zero) CloseHandle(child.process);
      if(job!=IntPtr.Zero) CloseHandle(job);
    }
  }
}
