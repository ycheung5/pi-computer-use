using System;
using System.Threading;
using System.Windows.Forms;
class PassiveAccessibilityForm : Form { protected override bool ShowWithoutActivation { get { return true; } } }
class AccessibilityFixture {
  [STAThread] static void Main(string[] args) {
    Console.OutputEncoding = new System.Text.UTF8Encoding(false);
    string title = args[0];
    PassiveAccessibilityForm form = new PassiveAccessibilityForm { Text = title, Width = 420, Height = 260 };
    TextBox editor = new TextBox { Name = "fixtureEditor", AccessibleName = "Fixture editor", Text = "hello accessible world", Left = 10, Top = 10, Width = 250 };
    TextBox password = new TextBox { Name = "fixturePassword", AccessibleName = "Secret field", Text = "must-not-leak", UseSystemPasswordChar = true, Left = 10, Top = 45, Width = 250 };
    Button button = new Button { Name = "fixtureButton", AccessibleName = "Fixture action", Text = "Fixture action", Left = 10, Top = 80, Width = 130 };
    form.Controls.Add(editor); form.Controls.Add(password); form.Controls.Add(button);
    for (int index=0; index<12; index++) form.Controls.Add(new Label { Text="Fixture label "+index, Left=10, Top=120+index*20, AccessibleName="Fixture label "+index });
    form.Shown += delegate { Console.WriteLine("ready"); Console.Out.Flush(); };
    ThreadPool.QueueUserWorkItem(delegate { string command; while((command=Console.ReadLine())!=null) { if(command=="stop") break; if(command=="remove") form.BeginInvoke((Action)delegate { form.Controls.Remove(button); button.Dispose(); Console.WriteLine("removed"); Console.Out.Flush(); }); } form.BeginInvoke((Action)delegate { form.Close(); }); });
    System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer { Interval=60000 }; timer.Tick += delegate { form.Close(); }; timer.Start();
    Application.Run(form);
  }
}
