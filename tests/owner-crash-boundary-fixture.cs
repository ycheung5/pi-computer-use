// Synthetic processes only: no clipboard, desktop or physical input APIs.
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

static class OwnerCrashBoundary {
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct STARTUPINFO { public int cb; public string reserved,desktop,title; public int x,y,xSize,ySize,xCount,yCount,fill,flags; public short show,reserved2; public IntPtr reservedPtr,stdin,stdout,stderr; }
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
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,int pid);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint ms);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static void Require(bool ok,string name){if(!ok)throw new InvalidOperationException(name+": "+Marshal.GetLastWin32Error());}
  static string Quote(string s){return "\""+s+"\"";}
  static string Exe {get{return Process.GetCurrentProcess().MainModule.FileName;}}
  static void Publish(string path,string value){File.WriteAllText(path+".tmp",value);File.Move(path+".tmp",path);}
  static string ReadReady(string path){var watch=Stopwatch.StartNew();while(!File.Exists(path)&&watch.ElapsedMilliseconds<6000)Thread.Sleep(20);Require(File.Exists(path),"fixture readiness");return File.ReadAllText(path);}
  static Process Start(string mode,string folder){return Process.Start(new ProcessStartInfo(Exe,mode+" "+Quote(folder)){UseShellExecute=false,CreateNoWindow=true});}
  static IntPtr Open(int pid){IntPtr h=OpenProcess(0x00101001,false,pid);Require(h!=IntPtr.Zero,"OpenProcess "+pid);return h;}
  static void Stop(IntPtr h){if(h!=IntPtr.Zero && WaitForSingleObject(h,0)!=0){Require(TerminateProcess(h,1),"TerminateProcess");Require(WaitForSingleObject(h,5000)==0,"process exit");}}
  static int Main(string[] args){
    if(args.Length==2){
      string mode=args[0],folder=args[1];
      if(mode=="--worker"){Start("--grandchild",folder);Thread.Sleep(9000);File.WriteAllText(Path.Combine(folder,"late-worker"),"late");return 0;}
      if(mode=="--grandchild"){Publish(Path.Combine(folder,"grandchild"),Process.GetCurrentProcess().Id.ToString());Thread.Sleep(9000);File.WriteAllText(Path.Combine(folder,"late-grandchild"),"late");return 0;}
      if(mode=="--broker"){Start("--broker-child",folder);Thread.Sleep(12000);return 0;}
      if(mode=="--broker-child"){Publish(Path.Combine(folder,"broker-child"),Process.GetCurrentProcess().Id.ToString());Thread.Sleep(9000);File.WriteAllText(Path.Combine(folder,"late-broker"),"late");return 0;}
      if(mode=="--supervisor"){
        IntPtr job=IntPtr.Zero,broker=IntPtr.Zero,grandHandle=IntPtr.Zero; PROCESS_INFORMATION ownedWorker=new PROCESS_INFORMATION();bool assigned=false;
        try{
          job=CreateJobObject(IntPtr.Zero,null);Require(job!=IntPtr.Zero,"CreateJobObject");
          EXTENDED_LIMIT limits=new EXTENDED_LIMIT();limits.basic.flags=0x2000;
          Require(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(EXTENDED_LIMIT))),"SetInformationJobObject");
          STARTUPINFO startup=new STARTUPINFO();startup.cb=Marshal.SizeOf(typeof(STARTUPINFO));
          Require(CreateProcess(Exe,new StringBuilder(Quote(Exe)+" --worker "+Quote(folder)),IntPtr.Zero,IntPtr.Zero,false,0x08000004,IntPtr.Zero,folder,ref startup,out ownedWorker),"CreateProcess");
          Require(AssignProcessToJobObject(job,ownedWorker.process),"AssignProcessToJobObject");
          assigned=true;
          Require(ResumeThread(ownedWorker.thread)!=0xffffffff,"ResumeThread");
          int grand=Int32.Parse(ReadReady(Path.Combine(folder,"grandchild")));
          grandHandle=Open(grand);bool jobMember;
          Require(IsProcessInJob(ownedWorker.process,job,out jobMember)&&jobMember,"worker must be inside job");
          Require(IsProcessInJob(grandHandle,job,out jobMember)&&jobMember,"grandchild must be inside job");
          int brokerPid=Int32.Parse(ReadReady(Path.Combine(folder,"broker-child")));broker=Open(brokerPid);
          bool member;Require(IsProcessInJob(broker,job,out member)&&!member,"broker must be outside job");
          Publish(Path.Combine(folder,"supervisor-ready"),ownedWorker.pid+":"+grand+":"+brokerPid);
          for(;;)Thread.Sleep(1000);
        }catch(Exception ex){Console.Error.WriteLine(ex.Message);return 1;}
        finally{if(!assigned&&ownedWorker.process!=IntPtr.Zero)Stop(ownedWorker.process);if(broker!=IntPtr.Zero)CloseHandle(broker);if(grandHandle!=IntPtr.Zero)CloseHandle(grandHandle);if(ownedWorker.thread!=IntPtr.Zero)CloseHandle(ownedWorker.thread);if(ownedWorker.process!=IntPtr.Zero)CloseHandle(ownedWorker.process);if(job!=IntPtr.Zero)CloseHandle(job);}
      }
    }
    if(args.Length!=1)return 2;
    Process brokerProcess=null,supervisor=null;IntPtr worker=IntPtr.Zero,grandchild=IntPtr.Zero,brokerChild=IntPtr.Zero;
    try{
      string folder=args[0];brokerProcess=Start("--broker",folder);
      int brokerPid=Int32.Parse(ReadReady(Path.Combine(folder,"broker-child")));brokerChild=Open(brokerPid);
      supervisor=Start("--supervisor",folder);
      string[] pids=ReadReady(Path.Combine(folder,"supervisor-ready")).Split(':');
      Require(pids.Length==3 && Int32.Parse(pids[2])==brokerPid,"fixture identities");
      worker=Open(Int32.Parse(pids[0]));grandchild=Open(Int32.Parse(pids[1]));
      Require(WaitForSingleObject(worker,0)==258 && WaitForSingleObject(grandchild,0)==258,"job descendants must be alive before supervisor death");
      supervisor.Kill();Require(supervisor.WaitForExit(5000),"supervisor exit");
      Require(WaitForSingleObject(worker,5000)==0 && WaitForSingleObject(grandchild,5000)==0,"job descendant exits");
      Require(WaitForSingleObject(brokerChild,0)==258,"external broker child must survive job closure");
      Stop(brokerChild);brokerProcess.Kill();Require(brokerProcess.WaitForExit(5000),"broker exit");
      Thread.Sleep(9100);
      bool late=File.Exists(Path.Combine(folder,"late-worker"))||File.Exists(Path.Combine(folder,"late-grandchild"))||File.Exists(Path.Combine(folder,"late-broker"));
      Require(!late,"late synthetic writes");
      Console.WriteLine("{\"supervisorCrashed\":true,\"jobDescendantsExited\":true,\"brokerOutsideJob\":true,\"brokerSurvivedJobClosure\":true,\"brokerCleanupConfirmed\":true,\"lateWrites\":false}");return 0;
    }catch(Exception ex){Console.Error.WriteLine(ex.Message);return 1;}
    finally{
      try{
        Require(brokerProcess==null || brokerChild!=IntPtr.Zero,"broker child identity unconfirmed");
        Require(supervisor==null || (worker!=IntPtr.Zero&&grandchild!=IntPtr.Zero),"job descendant identities unconfirmed");
        if(supervisor!=null&&!supervisor.HasExited){supervisor.Kill();Require(supervisor.WaitForExit(5000),"supervisor cleanup");}
        Stop(worker);Stop(grandchild);Stop(brokerChild);
        if(brokerProcess!=null&&!brokerProcess.HasExited){brokerProcess.Kill();Require(brokerProcess.WaitForExit(5000),"broker cleanup");}
      }catch(Exception ex){Console.Error.WriteLine("cleanup unconfirmed: "+ex.Message);for(;;)Thread.Sleep(1000);}
      if(worker!=IntPtr.Zero)CloseHandle(worker);if(grandchild!=IntPtr.Zero)CloseHandle(grandchild);if(brokerChild!=IntPtr.Zero)CloseHandle(brokerChild);
    }
  }
}
