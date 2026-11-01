using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

class StopBusyFixture {
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  static void Reply(string value) { Console.WriteLine(value); Console.Out.Flush(); }
  [STAThread] static void Main(string[] args) {
    var form = new Form { Text=args[0], Width=520, Height=240 };
    var edit = new TextBox { AccessibleName="Pi stop test editor", Multiline=true, Dock=DockStyle.Fill };
    form.Controls.Add(edit);
    int count=0;
    edit.TextChanged += delegate { count=edit.TextLength; if(count==1) Reply("started"); };
    form.Shown += delegate { edit.Focus(); Reply("ready:"+form.Handle.ToInt64()); };
    ThreadPool.QueueUserWorkItem(delegate {
      string command;
      while((command=Console.ReadLine())!=null) {
        if(command=="observe") form.BeginInvoke((Action)delegate {
          bool released=true;
          foreach(int key in new int[]{1,2,4,16,17,18,27,91,92,120}) if(GetAsyncKeyState(key)<0) released=false;
          int unexpected=0;foreach(char character in edit.Text)if(character!='x')unexpected++;
          Reply("state:"+count+":"+(released?"released":"held")+":"+unexpected);
        });
        if(command=="stop") { form.BeginInvoke((Action)delegate { form.Close(); }); return; }
      }
    });
    Application.Run(form);
  }
}
