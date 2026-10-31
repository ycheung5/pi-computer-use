using System;
using System.Threading;
using System.IO;
using System.Windows.Forms;
class ManagedFixture : Form {
  protected override bool ShowWithoutActivation {get{return true;}}
  [STAThread]static void Main(string[] args){
    bool veto=args.Length>1&&args[1]=="veto-once",blocked=args.Length>1&&args[1]=="unresponsive",extended=args.Length>3&&args[3]=="extended";int closes=0;
    ManagedFixture form=new ManagedFixture{Text=args[0],StartPosition=FormStartPosition.Manual,Left=140,Top=160,Width=400,Height=220,ShowInTaskbar=false};
    form.FormClosing+=delegate(object sender,FormClosingEventArgs e){bool refused=veto&&closes++==0;if(args.Length>2)File.AppendAllText(args[2],refused?"veto\n":"close\n");if(refused)e.Cancel=true;};
    form.Shown+=delegate{if(blocked)Thread.Sleep(5000);};
    System.Windows.Forms.Timer expiry=new System.Windows.Forms.Timer{Interval=args.Length>2?120000:45000};
    if(!extended){expiry.Tick+=delegate{veto=false;form.Close();};expiry.Start();Application.Run(form);return;}
    TextBox focusProbe=new TextBox{AccessibleName="Pi foreground focus probe",Left=10,Top=10,Width=200};form.Controls.Add(focusProbe);
    focusProbe.GotFocus+=delegate{File.AppendAllText(args[2],"target-focused\n");};
    ApplicationContext context=new ApplicationContext();
    ManagedFixture distractor=new ManagedFixture{Text=args[0]+" distractor",StartPosition=FormStartPosition.Manual,Left=600,Top=160,Width=350,Height=200,ShowInTaskbar=false};
    ManagedFixture replacement=null;
    form.FormClosed+=delegate{
      replacement=new ManagedFixture{Text=args[0],StartPosition=FormStartPosition.Manual,Left=140,Top=160,Width=400,Height=220,ShowInTaskbar=false};
      replacement.FormClosing+=delegate{File.AppendAllText(args[2],"replacement-close\n");};
      replacement.FormClosed+=delegate{distractor.Close();context.ExitThread();};replacement.Show();
    };
    expiry.Tick+=delegate{veto=false;if(replacement==null)form.Close();else replacement.Close();};
    expiry.Start();distractor.Show();form.Show();Application.Run(context);
  }
}
