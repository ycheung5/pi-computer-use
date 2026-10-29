using System;
using System.Threading;
using System.Windows.Forms;
class BackgroundForm : Form { protected override bool ShowWithoutActivation { get { return true; } } }
class ControlsFixture {
  [STAThread] static void Main(string[] args) {
    Console.OutputEncoding=new System.Text.UTF8Encoding(false);
    BackgroundForm form=new BackgroundForm { Text=args[0],Width=520,Height=400 };
    TextBox edit=new TextBox { AccessibleName="Background editor",Text="original",Left=10,Top=10,Width=240 };
    TextBox readOnly=new TextBox { AccessibleName="Read only editor",Text="fixed",ReadOnly=true,Left=260,Top=10,Width=200 };
    Label status=new Label { AccessibleName="Clicked 0",Text="Clicked 0",Left=10,Top=45,Width=200 };
    Button button=new Button { AccessibleName="Background action",Text="Run",Left=10,Top=70,Width=100 };
    int clicks=0;button.Click+=delegate { clicks++;status.Text=status.AccessibleName="Clicked "+clicks; };
    Label unsupported=new Label { AccessibleName="Unsupported label",Text="No action",Left=160,Top=70,Width=100 };
    Label scrollStatus=new Label { AccessibleName="Scrolled 0",Text="Scrolled 0",Left=10,Top=110,Width=200 };
    Panel panel=new Panel { AccessibleName="Background scroller",AutoScroll=true,Left=10,Top=140,Width=250,Height=160 };
    for(int index=0;index<30;index++)panel.Controls.Add(new Label {Text="Row "+index,Left=0,Top=index*25,Width=160});
    panel.Scroll+=delegate { scrollStatus.Text=scrollStatus.AccessibleName="Scrolled "+(-panel.AutoScrollPosition.Y); };
    form.Controls.Add(edit);form.Controls.Add(readOnly);form.Controls.Add(status);form.Controls.Add(button);form.Controls.Add(unsupported);form.Controls.Add(scrollStatus);form.Controls.Add(panel);
    form.Shown+=delegate {Console.WriteLine(form.Handle.ToInt64());Console.Out.Flush();};
    ThreadPool.QueueUserWorkItem(delegate {string command;while((command=Console.ReadLine())!=null){if(command=="stop")break;if(command=="remove")form.BeginInvoke((Action)delegate {form.Controls.Remove(button);button.Dispose();Console.WriteLine("removed");Console.Out.Flush();});}form.BeginInvoke((Action)delegate{form.Close();});});
    System.Windows.Forms.Timer timeout=new System.Windows.Forms.Timer {Interval=60000};timeout.Tick+=delegate{form.Close();};timeout.Start();Application.Run(form);
  }
}
