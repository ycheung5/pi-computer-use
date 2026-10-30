using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

class StopBusyFixture {
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  static void Reply(string value) { Console.WriteLine(value); Console.Out.Flush(); }
  [STAThread] static void Main(string[] args) {
    var form = new Form { Text=args[0], Width=520, Height=240, KeyPreview=true };
    var edit = new TextBox { AccessibleName="Pi stop test editor", Multiline=true, Dock=DockStyle.Fill };
    form.Controls.Add(edit);
    form.KeyDown += delegate(object sender, KeyEventArgs e) {
      if(e.KeyCode==Keys.Escape) Reply("stop-key:esc");
      if(e.KeyCode==Keys.F9 && e.Control && e.Alt && !e.Shift) Reply("stop-key:shortcut");
    };
    int count=0;
    edit.TextChanged += delegate { count=edit.TextLength; if(count==1) Reply("started"); };
    form.Shown += delegate { edit.Focus(); Reply("ready:"+form.Handle.ToInt64()); };
    ThreadPool.QueueUserWorkItem(delegate {
      string command;
      while((command=Console.ReadLine())!=null) {
        if(command=="observe") form.BeginInvoke((Action)delegate {
          bool released=true;
          foreach(int key in new int[]{1,2,4,16,17,18,27,91,92,120}) if(GetAsyncKeyState(key)<0) released=false;
          Reply("state:"+count+":"+(released?"released":"held"));
        });
        if(command=="stop") { form.BeginInvoke((Action)delegate { form.Close(); }); return; }
      }
    });
    Application.Run(form);
  }
}
