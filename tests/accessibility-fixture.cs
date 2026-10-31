using System;
using System.Threading;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Forms;
class PassiveAccessibilityForm : Form { public bool StripOnNull;
  public void ReplaceLifetimeHandle(){RecreateHandle();}
  protected override void WndProc(ref Message message){if(message.Msg==0 && StripOnNull){StripOnNull=false;int removed=AccessibilityFixture.RemoveLifetimeMarkers(Handle);Console.WriteLine("{\"nullProbeRemoved\":"+removed+"}");Console.Out.Flush();}base.WndProc(ref message);} protected override bool ShowWithoutActivation { get { return true; } } }
// Optional owned-window empirical probe; no HWND layout assumptions or visibility/input.
class ReuseRoot : NativeWindow {
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint owner);
  internal int Ordinal,CloseCount;
  protected override void WndProc(ref Message message) { if(message.Msg==0x10){CloseCount++;message.Result=IntPtr.Zero;return;}base.WndProc(ref message); }
  internal void DestroyCurrent() { IntPtr old=Handle;if(old==IntPtr.Zero)return;DestroyHandle();if(IsWindow(old))throw new InvalidOperationException("owned reuse root destruction unconfirmed"); }
  string Receipt(string status,int attempts,long elapsed,int first) {
    uint owner=0;bool live=Handle!=IntPtr.Zero && IsWindow(Handle);if(live)GetWindowThreadProcessId(Handle,out owner);
    return "{\"status\":\""+status+"\",\"hwnd\":"+Handle.ToInt64()+",\"pid\":"+Process.GetCurrentProcess().Id+",\"owner\":"+owner+",\"ordinal\":"+Ordinal+",\"firstOrdinal\":"+first+",\"attempts\":"+attempts+",\"elapsedMs\":"+elapsed+",\"live\":"+(live?"true":"false")+",\"closeCount\":"+CloseCount+"}";
  }
  internal string Oracle() {string receipt=Receipt("oracle",0,0,0);return receipt.Substring(0,receipt.Length-1)+",\"markerCount\":"+(Handle==IntPtr.Zero?0:AccessibilityFixture.CountLifetimeMarkers(Handle))+"}";}
  internal string Cycle(long target) {
    DestroyCurrent();var seen=new System.Collections.Generic.Dictionary<long,int>();var clock=Stopwatch.StartNew();int attempts=0;
    while(clock.ElapsedMilliseconds<30000 && attempts<1000000 && seen.Count<131072) {
      CreateHandle(new CreateParams {Caption="Owned hidden reuse root",Width=40,Height=40,Style=0});Ordinal++;attempts++;
      uint owner;GetWindowThreadProcessId(Handle,out owner);if(owner!=(uint)Process.GetCurrentProcess().Id)throw new InvalidOperationException("owned reuse root owner mismatch");
      long value=Handle.ToInt64();int first=0;
      if((target!=0 && value==target) || (target==0 && seen.TryGetValue(value,out first)))return Receipt("collision",attempts,clock.ElapsedMilliseconds,first);
      if(target==0)seen.Add(value,Ordinal);
      DestroyCurrent();
    }
    return Receipt("unavailable",attempts,clock.ElapsedMilliseconds,0);
  }
}
class AccessibilityFixture {
  delegate int PropertyVisitor(IntPtr window,IntPtr name,IntPtr data,IntPtr ignored);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int EnumPropsEx(IntPtr window,PropertyVisitor visitor,IntPtr ignored);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr RemoveProp(IntPtr window,string name);
  internal static int CountLifetimeMarkers(IntPtr window){int count=0;EnumPropsEx(window,delegate(IntPtr hwnd,IntPtr name,IntPtr data,IntPtr ignored){if(name.ToInt64()>65535 && Marshal.PtrToStringUni(name).StartsWith("PiComputerUse.Window."))count++;return 1;},IntPtr.Zero);return count;}
  internal static int RemoveLifetimeMarkers(IntPtr window){var names=new System.Collections.Generic.List<string>();EnumPropsEx(window,delegate(IntPtr hwnd,IntPtr name,IntPtr data,IntPtr ignored){if(name.ToInt64()>65535){string value=Marshal.PtrToStringUni(name);if(value.StartsWith("PiComputerUse.Window."))names.Add(value);}return 1;},IntPtr.Zero);foreach(string name in names)RemoveProp(window,name);return names.Count;}
  static void LifetimeReceipt(Form form,int lifetime) { Console.WriteLine("{\"hwnd\":"+form.Handle.ToInt64()+",\"pid\":"+Process.GetCurrentProcess().Id+",\"lifetime\":"+lifetime+"}");Console.Out.Flush(); }

  [STAThread] static void Main(string[] args) {
    Console.OutputEncoding = new System.Text.UTF8Encoding(false);
    string title = args[0];bool lifetimeMode=args.Length>1 && args[1]=="--lifetime";int lifetime=1;int clicks=0;ReuseRoot reuse=null;bool reuseMode=Array.IndexOf(args,"--reuse")>=0;if(reuseMode)reuse=new ReuseRoot();
    PassiveAccessibilityForm form = new PassiveAccessibilityForm { Text = title, Width = 420, Height = 260 };
    TextBox editor = new TextBox { Name = "fixtureEditor", AccessibleName = "Fixture editor", Text = "hello accessible world", Left = 10, Top = 10, Width = 250 };
    TextBox password = new TextBox { Name = "fixturePassword", AccessibleName = "Secret field", Text = "must-not-leak", UseSystemPasswordChar = true, Left = 10, Top = 45, Width = 250 };
    Button button = new Button { Name = "fixtureButton", AccessibleName = "Fixture action", Text = "Fixture action", Left = 10, Top = 80, Width = 130 };
    button.Click+=delegate {clicks++;};
    form.Controls.Add(editor); form.Controls.Add(password); form.Controls.Add(button);
    for (int index=0; index<12; index++) form.Controls.Add(new Label { Text="Fixture label "+index, Left=10, Top=120+index*20, AccessibleName="Fixture label "+index });
    form.Shown += delegate { if(lifetimeMode)LifetimeReceipt(form,lifetime);else {Console.WriteLine("ready"); Console.Out.Flush();} };
    ThreadPool.QueueUserWorkItem(delegate { string command; while((command=Console.ReadLine())!=null) { if(command=="stop") break; if(command=="counter")form.BeginInvoke((Action)delegate {Console.WriteLine("{\"clicks\":"+clicks+"}");Console.Out.Flush();});
      if(command=="strip-on-null")form.BeginInvoke((Action)delegate {form.StripOnNull=true;Console.WriteLine("{\"nullArmed\":true}");Console.Out.Flush();});
      if(reuseMode && (command=="reuse-prepare" || command=="reuse-oracle" || command.StartsWith("reuse-next:")))form.BeginInvoke((Action)delegate {try {string result=command=="reuse-oracle"?reuse.Oracle():reuse.Cycle(command=="reuse-prepare"?0:long.Parse(command.Substring(11)));Console.WriteLine(result);Console.Out.Flush();}catch(Exception error){Console.WriteLine("{\"status\":\"setup-error\",\"error\":\""+error.GetType().Name+"\"}");Console.Out.Flush();}});
      if(command=="identity") form.BeginInvoke((Action)delegate {LifetimeReceipt(form,lifetime);});
      if(command=="replace")form.BeginInvoke((Action)delegate {form.ReplaceLifetimeHandle();lifetime++;LifetimeReceipt(form,lifetime);});
      if(command=="strip-markers" || command=="marker-count" || command=="marker-names")form.BeginInvoke((Action)delegate {var names=new System.Collections.Generic.List<string>();EnumPropsEx(form.Handle,delegate(IntPtr hwnd,IntPtr name,IntPtr data,IntPtr ignored){if(name.ToInt64()>65535){string value=Marshal.PtrToStringUni(name);if(value.StartsWith("PiComputerUse.Window."))names.Add(value);}return 1;},IntPtr.Zero);if(command=="strip-markers")foreach(string name in names)RemoveProp(form.Handle,name);Console.WriteLine(command=="marker-names"?"{\"names\":[\""+String.Join("\",\"",names.ToArray())+"\"]}":"{\"removed\":"+names.Count+"}");Console.Out.Flush();});
      if(command=="remove") form.BeginInvoke((Action)delegate { form.Controls.Remove(button); button.Dispose(); Console.WriteLine("removed"); Console.Out.Flush(); }); } form.BeginInvoke((Action)delegate { form.Close(); }); });
    System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer { Interval=Array.IndexOf(args,"--expiry")>=0?360000:reuseMode?120000:60000 }; timer.Tick += delegate { form.Close(); }; timer.Start();
    try {Application.Run(form);}finally {if(reuse!=null)reuse.DestroyCurrent();}
  }
}
