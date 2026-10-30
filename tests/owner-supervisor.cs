// TEST ONLY: no clipboard, desktop or physical input. This process contains a
// disposable child tree for a prerequisite probe; it is not an input cleanup API.
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

static class OwnerSupervisor {
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct STARTUPINFO {
    public int cb; public string reserved,desktop,title; public int x,y,xSize,ySize,xCount,yCount,fill,flags; public short show,reserved2; public IntPtr reservedPtr,stdin,stdout,stderr;
  }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr process,thread; public int pid,tid; }
  [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMIT { public long processTime,jobTime; public uint flags; public UIntPtr minimum,maximum; public uint active; public UIntPtr affinity; public uint priority,scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong readOps,writeOps,otherOps,readBytes,writeBytes,otherBytes; }
  [StructLayout(LayoutKind.Sequential)] struct EXTENDED_LIMIT { public BASIC_LIMIT basic; public IO_COUNTERS io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob; }
  [StructLayout(LayoutKind.Sequential)] struct ACCOUNTING { public long user,kernel,periodUser,periodKernel; public uint pageFaults,totalProcesses,activeProcesses,terminatedProcesses; }
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr security,string name);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref EXTENDED_LIMIT info,uint size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int kind,out ACCOUNTING info,uint size,IntPtr returned);
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern bool CreateProcess(string app,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr environment,string dir,ref STARTUPINFO startup,out PROCESS_INFORMATION info);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint ms);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static void Require(bool ok,string name) { if(!ok) throw new InvalidOperationException(name+": "+Marshal.GetLastWin32Error()); }
  // MS C runtime argument quoting, including trailing backslashes and quotes.
  static string Quote(string value) {
    var b=new StringBuilder("\""); int slashes=0;
    foreach(char c in value) {
      if(c=='\\') {slashes++;continue;}
      if(c=='\"') {b.Append('\\',slashes*2+1); b.Append(c);}
      else {b.Append('\\',slashes);b.Append(c);}
      slashes=0;
    }
    b.Append('\\',slashes*2);b.Append('\"');return b.ToString();
  }
  static int Main(string[] args) {
    int timeout; if(args.Length<2 || !Int32.TryParse(args[0],out timeout) || timeout<1 || timeout>30000) return 2;
    IntPtr job=IntPtr.Zero;PROCESS_INFORMATION child=new PROCESS_INFORMATION();bool assigned=false,settled=false;
    try {
      job=CreateJobObject(IntPtr.Zero,null);Require(job!=IntPtr.Zero,"CreateJobObject");
      EXTENDED_LIMIT limits=new EXTENDED_LIMIT();limits.basic.flags=0x2000;
      Require(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(EXTENDED_LIMIT))),"SetInformationJobObject");
      STARTUPINFO startup=new STARTUPINFO();startup.cb=Marshal.SizeOf(typeof(STARTUPINFO));
      var cmd=new StringBuilder();for(int i=1;i<args.Length;i++) {if(i>1)cmd.Append(' ');cmd.Append(Quote(args[i]));}
      Require(CreateProcess(args[1],cmd,IntPtr.Zero,IntPtr.Zero,false,0x08000004,IntPtr.Zero,null,ref startup,out child),"CreateProcess suspended");
      Require(AssignProcessToJobObject(job,child.process),"AssignProcessToJobObject");assigned=true;
      Require(ResumeThread(child.thread)!=0xffffffff,"ResumeThread");
      uint wait=WaitForSingleObject(child.process,(uint)timeout);Require(wait==0 || wait==258,"WaitForSingleObject");
      string reason=wait==258?"timeout":"root-exited";
      Require(TerminateJobObject(job,1),"TerminateJobObject");
      var clock=Stopwatch.StartNew(); ACCOUNTING state;
      do {
        Require(QueryInformationJobObject(job,1,out state,(uint)Marshal.SizeOf(typeof(ACCOUNTING)),IntPtr.Zero),"QueryInformationJobObject");
        if(state.activeProcesses==0) break;
        Thread.Sleep(20);
      } while(clock.ElapsedMilliseconds<5000);
      Require(state.activeProcesses==0,"job remains active");
      settled=true;
      Console.WriteLine("{\"reason\":\""+reason+"\",\"activeProcesses\":0,\"totalProcesses\":"+state.totalProcesses+"}");return 0;
    } catch(Exception ex) {
      Console.Error.WriteLine(ex.Message);
      if(assigned && !settled) {
        // Keep the job handle and possible input owners alive on uncertain cleanup.
        // A controller must not treat this diagnostic as a settled response.
        Console.Error.WriteLine("job cleanup unconfirmed; retaining supervisor");
        for(;;) Thread.Sleep(1000);
      }
      return 1;
    }
    finally {
      if(job!=IntPtr.Zero && assigned) TerminateJobObject(job,1);
      else if(child.process!=IntPtr.Zero) TerminateProcess(child.process,1);
      if(child.process!=IntPtr.Zero) WaitForSingleObject(child.process,5000);
      if(child.thread!=IntPtr.Zero) CloseHandle(child.thread);
      if(child.process!=IntPtr.Zero) CloseHandle(child.process);
      if(job!=IntPtr.Zero) CloseHandle(job);
    }
  }
}
