using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Automation;
using System.Windows.Automation.Provider;
using System.Windows.Forms;

class UnknownTypeControl : Control, IRawElementProviderSimple, IScrollProvider, IInvokeProvider {
  public static int Mode;
  public static readonly ManualResetEvent Release = new ManualResetEvent(false);
  public static int Entries;
  public static int Active;
  public ProviderOptions ProviderOptions { get { return ProviderOptions.ServerSideProvider; } }
  public IRawElementProviderSimple HostRawElementProvider { get { return AutomationInteropProvider.HostProviderFromHandle(Handle); } }
  public static int ScrollCalls,ScrollEffects,HoldScroll;
  public static readonly ManualResetEvent ScrollRelease=new ManualResetEvent(false);
  public static int HoldEnabled,InvokeCalls,StripAfterInvoke;public static Action StripMarkers;
  public static readonly ManualResetEvent EnabledRelease=new ManualResetEvent(false);
  public void Invoke(){Interlocked.Increment(ref InvokeCalls);if(Interlocked.Exchange(ref StripAfterInvoke,0)==1)StripMarkers();}
  public object GetPatternProvider(int id) { return id==ScrollPatternIdentifiers.Pattern.Id || id==InvokePatternIdentifiers.Pattern.Id?this:null; }
  public bool HorizontallyScrollable {get{return true;}}
  public bool VerticallyScrollable {get{return true;}}
  public double HorizontalScrollPercent {get{return 0;}}
  public double VerticalScrollPercent {get{return ScrollEffects;}}
  public double HorizontalViewSize {get{return 10;}}
  public double VerticalViewSize {get{return 10;}}
  public void SetScrollPercent(double x,double y) {throw new NotSupportedException();}
  public void Scroll(ScrollAmount x,ScrollAmount y) {
    Interlocked.Increment(ref ScrollCalls);
    Console.WriteLine("scroll:entered:"+x+":"+y);Console.Out.Flush();
    if(Interlocked.Exchange(ref HoldScroll,0)==1)ScrollRelease.WaitOne(20000);
    Interlocked.Increment(ref ScrollEffects);
    Console.WriteLine("scroll:settled");Console.Out.Flush();
  }
  public object GetPropertyValue(int id) {
    if(id==AutomationElementIdentifiers.IsEnabledProperty.Id){if(Interlocked.Exchange(ref HoldEnabled,0)==1){Console.WriteLine("enabled:entered");Console.Out.Flush();EnabledRelease.WaitOne(10000);Console.WriteLine("enabled:settled");Console.Out.Flush();}return true;}
    if (id == AutomationElementIdentifiers.ControlTypeProperty.Id) return 50040;
    if (id == AutomationElementIdentifiers.NameProperty.Id) {
      int mode = Interlocked.Exchange(ref Mode, 0);
      if (mode != 0) {
        Interlocked.Increment(ref Entries);
        Console.WriteLine("provider:entered:" + (mode == 1 ? "fault" : mode == 3 ? "unavailable" : "hang")); Console.Out.Flush();
        if (mode == 1) throw new COMException("Owned provider intentional failure", unchecked((int)0x80004005));
        if (mode == 3) throw new COMException("Owned provider reports element unavailable", unchecked((int)0x80040201));
        Interlocked.Exchange(ref Active, 1);
        Release.WaitOne(12000);
        Interlocked.Exchange(ref Active, 0);
        Console.WriteLine("provider:released"); Console.Out.Flush();
      }
      return "Newer UIA control";
    }
    if (id == AutomationElementIdentifiers.IsControlElementProperty.Id || id == AutomationElementIdentifiers.IsContentElementProperty.Id) return true;
    return null;
  }
  protected override void WndProc(ref Message message) {
    if (message.Msg == 0x3D && message.LParam.ToInt64() == AutomationInteropProvider.RootObjectId) {
      message.Result = AutomationInteropProvider.ReturnRawElementProvider(Handle, message.WParam, message.LParam, this);
      return;
    }
    base.WndProc(ref message);
  }
}
class PassiveNullForm : Form { protected override bool ShowWithoutActivation { get { return true; } } }
class OffscreenParentControl : Control, IRawElementProviderSimple {
  public ProviderOptions ProviderOptions { get { return ProviderOptions.ServerSideProvider; } }
  public IRawElementProviderSimple HostRawElementProvider { get { return AutomationInteropProvider.HostProviderFromHandle(Handle); } }
  public object GetPatternProvider(int id) { return null; }
  public object GetPropertyValue(int id) {
    if(id==AutomationElementIdentifiers.ControlTypeProperty.Id)return ControlType.Pane.Id;
    if(id==AutomationElementIdentifiers.NameProperty.Id)return "Offscreen ancestor";
    if(id==AutomationElementIdentifiers.IsOffscreenProperty.Id)return true;
    if(id==AutomationElementIdentifiers.IsControlElementProperty.Id||id==AutomationElementIdentifiers.IsContentElementProperty.Id)return true;
    return null;
  }
  protected override void WndProc(ref Message message) {
    if(message.Msg==0x3D&&message.LParam.ToInt64()==AutomationInteropProvider.RootObjectId){message.Result=AutomationInteropProvider.ReturnRawElementProvider(Handle,message.WParam,message.LParam,this);return;}
    base.WndProc(ref message);
  }
}
class NullProviderFixture {
  delegate int PropertyVisitor(IntPtr window,IntPtr name,IntPtr data,IntPtr unused);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int EnumPropsEx(IntPtr window,PropertyVisitor visitor,IntPtr unused);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr RemoveProp(IntPtr window,string name);

  [STAThread] static void Main() {
    Console.OutputEncoding = new System.Text.UTF8Encoding(false);
    var form = new PassiveNullForm { Text = "Pi nullable UIA fixture", Width = 360, Height = 230 };
    form.Controls.Add(new Label { Text = "Before custom provider", AccessibleName = "Before custom provider", Top = 10, Width = 250 });
    var custom = new UnknownTypeControl { Top = 45, Width = 250, Height = 25 };
    form.Controls.Add(custom);
    form.Controls.Add(new Button { Text = "After custom provider", AccessibleName = "After custom provider", Top = 85, Width = 250 });
    var offscreenParent=new OffscreenParentControl { Top=125,Width=280,Height=35 };
    offscreenParent.Controls.Add(new Button { Text="Visible descendant",AccessibleName="Visible descendant",Top=0,Width=250,Height=25 });
    form.Controls.Add(offscreenParent);
    IntPtr root=IntPtr.Zero;form.Shown += delegate { root=form.Handle;Console.WriteLine(form.Handle.ToInt64()); Console.Out.Flush(); };
    UnknownTypeControl.StripMarkers=delegate {var names=new System.Collections.Generic.List<string>();EnumPropsEx(root,delegate(IntPtr window,IntPtr name,IntPtr data,IntPtr unused){if(name.ToInt64()>65535){string value=Marshal.PtrToStringUni(name);if(value.StartsWith("PiComputerUse.Window."))names.Add(value);}return 1;},IntPtr.Zero);foreach(string name in names)RemoveProp(root,name);};
    ThreadPool.QueueUserWorkItem(delegate {
      string line;
      while ((line = Console.ReadLine()) != null) {
        if(line=="invoke-strip"){Interlocked.Exchange(ref UnknownTypeControl.StripAfterInvoke,1);Console.WriteLine("invoke:armed");Console.Out.Flush();}
        else if(line=="enabled-hold"){UnknownTypeControl.EnabledRelease.Reset();Interlocked.Exchange(ref UnknownTypeControl.HoldEnabled,1);Console.WriteLine("enabled:armed");Console.Out.Flush();}
        else if(line=="enabled-release"){UnknownTypeControl.EnabledRelease.Set();}
        else if(line=="invoke-state"){Console.WriteLine("invoke-state:"+UnknownTypeControl.InvokeCalls);Console.Out.Flush();}
        else if(line=="strip-markers"){var names=new System.Collections.Generic.List<string>();EnumPropsEx(root,delegate(IntPtr window,IntPtr name,IntPtr data,IntPtr unused){if(name.ToInt64()>65535){string value=Marshal.PtrToStringUni(name);if(value.StartsWith("PiComputerUse.Window."))names.Add(value);}return 1;},IntPtr.Zero);foreach(string name in names)RemoveProp(root,name);Console.WriteLine("markers-removed:"+names.Count);Console.Out.Flush();}
        else if (line == "arm:fault" || line == "arm:hang" || line == "arm:unavailable") {
          UnknownTypeControl.Release.Reset();
          Interlocked.Exchange(ref UnknownTypeControl.Mode, line == "arm:fault" ? 1 : line == "arm:unavailable" ? 3 : 2);
          Console.WriteLine("armed"); Console.Out.Flush();
        } else if(line=="scroll-hold") {
          UnknownTypeControl.ScrollRelease.Reset();Interlocked.Exchange(ref UnknownTypeControl.HoldScroll,1);
          Console.WriteLine("scroll:armed");Console.Out.Flush();
        } else if(line=="scroll-release") {
          UnknownTypeControl.EnabledRelease.Set();
      UnknownTypeControl.ScrollRelease.Set();Console.WriteLine("scroll:release-ack");Console.Out.Flush();
        } else if(line=="scroll-state") {
          Console.WriteLine("scroll-state:"+UnknownTypeControl.ScrollCalls+":"+UnknownTypeControl.ScrollEffects);Console.Out.Flush();
        } else if (line == "child-handle") {
          form.BeginInvoke((Action)delegate { Console.WriteLine("child-handle:" + custom.Handle.ToInt64()); Console.Out.Flush(); });
        } else if (line == "release") {
          UnknownTypeControl.Release.Set();
          Console.WriteLine("release:ack"); Console.Out.Flush();
        } else if (line == "provider-state") {
          Console.WriteLine("provider-state:" + UnknownTypeControl.Active + ":" + UnknownTypeControl.Release.WaitOne(0)); Console.Out.Flush();
        } else if (line == "state") {
          Console.WriteLine("entries:" + UnknownTypeControl.Entries); Console.Out.Flush();
        } else break;
      }
      UnknownTypeControl.ScrollRelease.Set();
      UnknownTypeControl.Release.Set();
      form.BeginInvoke((Action)delegate { form.Close(); });
    });
    Application.Run(form);
  }
}
