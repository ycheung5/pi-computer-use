using System;
using System.Threading;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Forms;
class PassiveAccessibilityForm : Form { public void ReplaceLifetimeHandle(){RecreateHandle();} protected override bool ShowWithoutActivation { get { return true; } } }
class AccessibilityFixture {
  delegate int PropertyVisitor(IntPtr window,IntPtr name,IntPtr data,IntPtr ignored);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int EnumPropsEx(IntPtr window,PropertyVisitor visitor,IntPtr ignored);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr RemoveProp(IntPtr window,string name);
  static void LifetimeReceipt(Form form,int lifetime) { Console.WriteLine("{\"hwnd\":"+form.Handle.ToInt64()+",\"pid\":"+Process.GetCurrentProcess().Id+",\"lifetime\":"+lifetime+"}");Console.Out.Flush(); }

  [STAThread] static void Main(string[] args) {
    Console.OutputEncoding = new System.Text.UTF8Encoding(false);
    string title = args[0];bool lifetimeMode=args.Length>1 && args[1]=="--lifetime";int lifetime=1;int clicks=0;
    PassiveAccessibilityForm form = new PassiveAccessibilityForm { Text = title, Width = 420, Height = 260 };
    TextBox editor = new TextBox { Name = "fixtureEditor", AccessibleName = "Fixture editor", Text = "hello accessible world", Left = 10, Top = 10, Width = 250 };
    TextBox password = new TextBox { Name = "fixturePassword", AccessibleName = "Secret field", Text = "must-not-leak", UseSystemPasswordChar = true, Left = 10, Top = 45, Width = 250 };
    Button button = new Button { Name = "fixtureButton", AccessibleName = "Fixture action", Text = "Fixture action", Left = 10, Top = 80, Width = 130 };
    button.Click+=delegate {clicks++;};
    form.Controls.Add(editor); form.Controls.Add(password); form.Controls.Add(button);
    for (int index=0; index<12; index++) form.Controls.Add(new Label { Text="Fixture label "+index, Left=10, Top=120+index*20, AccessibleName="Fixture label "+index });
    form.Shown += delegate { if(lifetimeMode)LifetimeReceipt(form,lifetime);else {Console.WriteLine("ready"); Console.Out.Flush();} };
    ThreadPool.QueueUserWorkItem(delegate { string command; while((command=Console.ReadLine())!=null) { if(command=="stop") break; if(command=="counter")form.BeginInvoke((Action)delegate {Console.WriteLine("{\"clicks\":"+clicks+"}");Console.Out.Flush();});
      if(command=="identity") form.BeginInvoke((Action)delegate {LifetimeReceipt(form,lifetime);});
      if(command=="replace")form.BeginInvoke((Action)delegate {form.ReplaceLifetimeHandle();lifetime++;LifetimeReceipt(form,lifetime);});
      if(command=="strip-markers" || command=="marker-count")form.BeginInvoke((Action)delegate {var names=new System.Collections.Generic.List<string>();EnumPropsEx(form.Handle,delegate(IntPtr hwnd,IntPtr name,IntPtr data,IntPtr ignored){if(name.ToInt64()>65535){string value=Marshal.PtrToStringUni(name);if(value.StartsWith("PiComputerUse.Window."))names.Add(value);}return 1;},IntPtr.Zero);if(command=="strip-markers")foreach(string name in names)RemoveProp(form.Handle,name);Console.WriteLine("{\"removed\":"+names.Count+"}");Console.Out.Flush();});
      if(command=="remove") form.BeginInvoke((Action)delegate { form.Controls.Remove(button); button.Dispose(); Console.WriteLine("removed"); Console.Out.Flush(); }); } form.BeginInvoke((Action)delegate { form.Close(); }); });
    System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer { Interval=60000 }; timer.Tick += delegate { form.Close(); }; timer.Start();
    Application.Run(form);
  }
}
