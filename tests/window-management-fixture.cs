using System;
using System.Threading;
using System.Windows.Forms;
class ManagedFixture : Form {
  protected override bool ShowWithoutActivation {get{return true;}}
  [STAThread]static void Main(string[] args){
    bool veto=args.Length>1&&args[1]=="veto-once",blocked=args.Length>1&&args[1]=="unresponsive";int closes=0;
    ManagedFixture form=new ManagedFixture{Text=args[0],StartPosition=FormStartPosition.Manual,Left=140,Top=160,Width=400,Height=220,ShowInTaskbar=false};
    form.FormClosing+=delegate(object sender,FormClosingEventArgs e){if(veto&&closes++==0)e.Cancel=true;};
    form.Shown+=delegate{if(blocked)Thread.Sleep(5000);};
    System.Windows.Forms.Timer expiry=new System.Windows.Forms.Timer{Interval=45000};expiry.Tick+=delegate{veto=false;form.Close();};expiry.Start();Application.Run(form);
  }
}
