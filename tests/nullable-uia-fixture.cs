using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Automation;
using System.Windows.Automation.Provider;
using System.Windows.Forms;

class UnknownTypeControl : Control, IRawElementProviderSimple, IScrollProvider {
  public static int Mode;
  public static readonly ManualResetEvent Release = new ManualResetEvent(false);
  public static int Entries;
  public static int Active;
  public ProviderOptions ProviderOptions { get { return ProviderOptions.ServerSideProvider; } }
  public IRawElementProviderSimple HostRawElementProvider { get { return AutomationInteropProvider.HostProviderFromHandle(Handle); } }
  public static int ScrollCalls,ScrollEffects,HoldScroll;
  public static readonly ManualResetEvent ScrollRelease=new ManualResetEvent(false);
  public object GetPatternProvider(int id) { return id==ScrollPatternIdentifiers.Pattern.Id?this:null; }
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
class NullProviderFixture {
  [STAThread] static void Main() {
    Console.OutputEncoding = new System.Text.UTF8Encoding(false);
    var form = new PassiveNullForm { Text = "Pi nullable UIA fixture", Width = 360, Height = 180 };
    form.Controls.Add(new Label { Text = "Before custom provider", AccessibleName = "Before custom provider", Top = 10, Width = 250 });
    var custom = new UnknownTypeControl { Top = 45, Width = 250, Height = 25 };
    form.Controls.Add(custom);
    form.Controls.Add(new Button { Text = "After custom provider", AccessibleName = "After custom provider", Top = 85, Width = 250 });
    form.Shown += delegate { Console.WriteLine(form.Handle.ToInt64()); Console.Out.Flush(); };
    ThreadPool.QueueUserWorkItem(delegate {
      string line;
      while ((line = Console.ReadLine()) != null) {
        if (line == "arm:fault" || line == "arm:hang" || line == "arm:unavailable") {
          UnknownTypeControl.Release.Reset();
          Interlocked.Exchange(ref UnknownTypeControl.Mode, line == "arm:fault" ? 1 : line == "arm:unavailable" ? 3 : 2);
          Console.WriteLine("armed"); Console.Out.Flush();
        } else if(line=="scroll-hold") {
          UnknownTypeControl.ScrollRelease.Reset();Interlocked.Exchange(ref UnknownTypeControl.HoldScroll,1);
          Console.WriteLine("scroll:armed");Console.Out.Flush();
        } else if(line=="scroll-release") {
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
