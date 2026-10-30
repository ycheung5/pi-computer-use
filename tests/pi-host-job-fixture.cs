// Passive-only prerequisite: a real Pi host and its descendants run inside a Windows job.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

static class PiHostJobFixture {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct STARTUPINFO { public int cb; public string reserved,desktop,title; public int x,y,xSize,ySize,xCount,yCount,fill,flags; public short show,reserved2; public IntPtr reservedPtr,stdin,stdout,stderr; }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr process,thread; public int pid,tid; }
  [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMIT { public long processTime,jobTime; public uint flags; public UIntPtr minimum,maximum; public uint active; public UIntPtr affinity; public uint priority,scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong readOps,writeOps,otherOps,readBytes,writeBytes,otherBytes; }
  [StructLayout(LayoutKind.Sequential)] struct EXTENDED_LIMIT { public BASIC_LIMIT basic; public IO_COUNTERS io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob; }
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr security,string name);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref EXTENDED_LIMIT info,uint size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int kind,IntPtr buffer,uint length,out uint returned);
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern bool CreateProcess(string app,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr environment,string dir,ref STARTUPINFO startup,out PROCESS_INFORMATION info);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint ms);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static void Need(bool ok,string reason) { if(!ok) throw new InvalidOperationException(reason+": "+Marshal.GetLastWin32Error()); }
  static string Quote(string value) {
    var b=new StringBuilder("\""); int slashes=0;
    foreach(char c in value) { if(c=='\\') {slashes++;continue;} if(c=='\"'){b.Append('\\',slashes*2+1);b.Append(c);}else{b.Append('\\',slashes);b.Append(c);}slashes=0; }
    b.Append('\\',slashes*2);return b.Append('"').ToString();
  }
  static string Decode(string s) { return Encoding.UTF8.GetString(Convert.FromBase64String(s)); }
  static string[] Input(string path) { string[] encoded=File.ReadAllLines(path); for(int i=0;i<encoded.Length;i++)encoded[i]=Decode(encoded[i]);return encoded; }
  static int RunHost(string folder) {
    string[] a=Input(Path.Combine(folder,"args")); Need(a.Length>2,"arguments");
    var command=new StringBuilder();for(int i=2;i<a.Length;i++){if(i>2)command.Append(' ');command.Append(Quote(a[i]));}
    var info=new ProcessStartInfo(a[0],command.ToString()){WorkingDirectory=a[1],UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true};
    using(var child=Process.Start(info)) {
      File.WriteAllText(Path.Combine(folder,"host-pid"),child.Id.ToString());
      child.StandardInput.Close();
      var output=child.StandardOutput.ReadToEndAsync();var error=child.StandardError.ReadToEndAsync();
      if(!child.WaitForExit(30000)) throw new InvalidOperationException("Pi passive host timeout");
      File.WriteAllText(Path.Combine(folder,"stdout"),output.Result);File.WriteAllText(Path.Combine(folder,"stderr"),error.Result);
      File.WriteAllText(Path.Combine(folder,"exit"),child.ExitCode.ToString());return child.ExitCode;
    }
  }
  static List<int> Members(IntPtr job) {
    int size=8+8*1024;IntPtr buffer=Marshal.AllocHGlobal(size);
    try {uint got;Need(QueryInformationJobObject(job,3,buffer,(uint)size,out got),"Query job members");int total=Marshal.ReadInt32(buffer),count=Marshal.ReadInt32(buffer,4);Need(total==count && count<=1024,"all job members");var result=new List<int>();for(int i=0;i<count;i++)result.Add((int)Marshal.ReadIntPtr(buffer,8+i*IntPtr.Size).ToInt64());return result;} finally {Marshal.FreeHGlobal(buffer);}
  }
  static int Main(string[] args) {
    if(args.Length==2 && args[0]=="--host")return RunHost(args[1]);
    if(args.Length!=1)return 2;
    IntPtr job=IntPtr.Zero;PROCESS_INFORMATION child=new PROCESS_INFORMATION();bool assigned=false;
    try {
      string exe=Process.GetCurrentProcess().MainModule.FileName, folder=args[0];job=CreateJobObject(IntPtr.Zero,null);Need(job!=IntPtr.Zero,"CreateJobObject");
      EXTENDED_LIMIT limits=new EXTENDED_LIMIT();limits.basic.flags=0x2000;Need(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(EXTENDED_LIMIT))),"Set job limits");
      STARTUPINFO si=new STARTUPINFO();si.cb=Marshal.SizeOf(typeof(STARTUPINFO));
      Need(CreateProcess(exe,new StringBuilder(Quote(exe)+" --host "+Quote(folder)),IntPtr.Zero,IntPtr.Zero,false,0x08000004,IntPtr.Zero,folder,ref si,out child),"Create suspended supervisor");
      Need(AssignProcessToJobObject(job,child.process),"Assign supervisor");assigned=true;Need(ResumeThread(child.thread)!=0xffffffff,"Resume supervisor");
      var seen=new Dictionary<int,string>();var clock=Stopwatch.StartNew();
      while(clock.ElapsedMilliseconds<35000) {
        foreach(int pid in Members(job))if(!seen.ContainsKey(pid))try{using(var p=Process.GetProcessById(pid))seen[pid]=p.ProcessName;}catch(ArgumentException){}catch(InvalidOperationException){}
        if(WaitForSingleObject(child.process,0)==0 && Members(job).Count==0)break;
        Thread.Sleep(20);
      }
      Need(WaitForSingleObject(child.process,0)==0 && Members(job).Count==0,"job not empty");
      var outJson=new StringBuilder("{\"jobEmpty\":true,\"members\":[");bool first=true;
      foreach(var pair in seen){if(!first)outJson.Append(',');first=false;outJson.Append("{\"pid\":").Append(pair.Key).Append(",\"name\":\"").Append(pair.Value.Replace("\\","\\\\").Replace("\"","\\\"")).Append("\"}");}
      Console.WriteLine(outJson.Append("]}"));return 0;
    }catch(Exception ex){Console.Error.WriteLine(ex.Message);return 1;}
    finally { if(job!=IntPtr.Zero&&assigned)TerminateJobObject(job,1);else if(child.process!=IntPtr.Zero)TerminateProcess(child.process,1);if(child.process!=IntPtr.Zero)WaitForSingleObject(child.process,5000);if(child.thread!=IntPtr.Zero)CloseHandle(child.thread);if(child.process!=IntPtr.Zero)CloseHandle(child.process);if(job!=IntPtr.Zero)CloseHandle(job); }
  }
}
