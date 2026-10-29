using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Automation;
using System.Windows.Automation.Provider;
using System.Windows.Forms;

class UnknownTypeControl : Control, IRawElementProviderSimple {
  public ProviderOptions ProviderOptions { get { return ProviderOptions.ServerSideProvider; } }
  public IRawElementProviderSimple HostRawElementProvider { get { return AutomationInteropProvider.HostProviderFromHandle(Handle); } }
  public object GetPatternProvider(int id) { return null; }
  public object GetPropertyValue(int id) {
    if (id == AutomationElementIdentifiers.ControlTypeProperty.Id) return 50040;
    if (id == AutomationElementIdentifiers.NameProperty.Id) return "Newer UIA control";
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
    form.Controls.Add(new UnknownTypeControl { Top = 45, Width = 250, Height = 25 });
    form.Controls.Add(new Button { Text = "After custom provider", AccessibleName = "After custom provider", Top = 85, Width = 250 });
    form.Shown += delegate { Console.WriteLine(form.Handle.ToInt64()); Console.Out.Flush(); };
    ThreadPool.QueueUserWorkItem(delegate { Console.ReadLine(); form.BeginInvoke((Action)delegate { form.Close(); }); });
    Application.Run(form);
  }
}
