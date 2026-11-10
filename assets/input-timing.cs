using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;

partial class WindowsBridge {
  // One call's budget and guarded waits; no held-input state or scheduling policy.
  sealed class InputTiming {
    internal readonly long TimeoutMs;
    internal readonly string DeadlinePolicy;
    readonly Stopwatch elapsed=Stopwatch.StartNew();
    internal static long Milliseconds(Dictionary<string,object> args,string name,long fallback) {
      object raw;if(!args.TryGetValue(name,out raw))return fallback;
      if(!(raw is byte || raw is short || raw is int || raw is long || raw is float || raw is double || raw is decimal))throw new InvalidOperationException("INVALID_ARGUMENTS: "+name+" must be non-negative safe whole milliseconds");
      double value=Convert.ToDouble(raw);
      if(Double.IsNaN(value) || Double.IsInfinity(value) || value<0 || value>9007199254740991D || Math.Floor(value)!=value)throw new InvalidOperationException("INVALID_ARGUMENTS: "+name+" must be non-negative safe whole milliseconds");
      return (long)value;
    }
    internal InputTiming(Dictionary<string,object> args,long requestedDuration,bool explicitDuration,long ordinaryTimeoutMs) {
      if(args.ContainsKey("timeoutMs")){TimeoutMs=Milliseconds(args,"timeoutMs",0);DeadlinePolicy=TimeoutMs==0?"disabled":"explicit";}
      else {
        if(requestedDuration>9007199254740991L-ordinaryTimeoutMs)throw new InvalidOperationException("INVALID_ARGUMENTS: derived execution duration is not representable");
        TimeoutMs=ordinaryTimeoutMs+requestedDuration;DeadlinePolicy=explicitDuration?"derived":"default";
      }
    }
    internal void Check() {
      if(TimeoutMs!=0 && elapsed.ElapsedMilliseconds>=TimeoutMs)throw new InvalidOperationException("WORKER_TIMEOUT: input exceeded the execution deadline; input was not replayed");
    }
    internal void Wait(long milliseconds,EventWaitHandle cancel,Action check) {
      Stopwatch wait=Stopwatch.StartNew();
      for(;;) {
        Check();check();
        long remaining=milliseconds-wait.ElapsedMilliseconds;
        if(remaining<=0)return;
        long interval=Math.Min(25L,remaining);
        if(TimeoutMs!=0)interval=Math.Min(interval,Math.Max(1L,TimeoutMs-elapsed.ElapsedMilliseconds));
        if(cancel.WaitOne((int)interval))throw new InvalidOperationException("COMPUTER_USE_STOPPED");
      }
    }
    internal Dictionary<string,object> Describe() {return new Dictionary<string,object>{{"timeoutMs",TimeoutMs},{"deadlinePolicy",DeadlinePolicy}};}
  }
}
