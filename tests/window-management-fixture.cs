using System;
using System.Threading;
using System.IO;
using System.Windows.Forms;
class ManagedFixture : Form {
  protected override bool ShowWithoutActivation {get{return true;}}
  [STAThread]static void Main(string[] args){
    bool veto=args.Length>1&&args[1]=="veto-once",blocked=args.Length>1&&args[1]=="unresponsive";int closes=0;
    ManagedFixture form=new ManagedFixture{Text=args[0],StartPosition=FormStartPosition.Manual,Left=140,Top=160,Width=400,Height=220,ShowInTaskbar=false};
    form.FormClosing+=delegate(object sender,FormClosingEventArgs e){bool refused=veto&&closes++==0;if(args.Length>2)File.AppendAllText(args[2],refused?"veto\n":"close\n");if(refused)e.Cancel=true;};
    form.Shown+=delegate{if(blocked)Thread.Sleep(5000);};
    System.Windows.Forms.Timer expiry=new System.Windows.Forms.Timer{Interval=args.Length>2?120000:45000};expiry.Tick+=delegate{veto=false;form.Close();};expiry.Start();Application.Run(form);
  }
}
