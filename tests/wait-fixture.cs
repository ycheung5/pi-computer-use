using System;
using System.Drawing;
using System.Threading;
using System.Windows.Forms;
class WaitForm:Form {
 public bool TextVisible=false;
 public Button Target;
 protected override bool ShowWithoutActivation {get{return true;}}
 public WaitForm(string title){Text=title;StartPosition=FormStartPosition.Manual;Location=new Point(200,220);ClientSize=new Size(640,360);BackColor=Color.White;ShowInTaskbar=false;}
 protected override void OnPaint(PaintEventArgs e){base.OnPaint(e);if(TextVisible)using(Font f=new Font("Arial",30))e.Graphics.DrawString("READY 456",f,Brushes.Black,25,160);}
}
class WaitFixture {
 [STAThread]static void Main(string[] args){
  WaitForm form=new WaitForm(args[0]);
  for(int i=0;i<25;i++)form.Controls.Add(new Label{Text="Fixture filler "+i,AccessibleName="Fixture filler "+i,Left=10,Top=10+i*4});
  form.Shown+=delegate{Console.WriteLine(form.Handle.ToInt64());Console.Out.Flush();};
  ThreadPool.QueueUserWorkItem(delegate{string line;while((line=Console.ReadLine())!=null){string cmd=line;form.BeginInvoke((Action)delegate{
   if(cmd=="add"){form.Target=new Button{Text="Transition target",AccessibleName="Transition target",Left=280,Top=35,Width=190};form.Controls.Add(form.Target);}
   else if(cmd=="remove"&&form.Target!=null){form.Controls.Remove(form.Target);form.Target.Dispose();form.Target=null;}
   else if(cmd=="text"){form.TextVisible=true;form.Invalidate();}
   else if(cmd=="clear"){form.TextVisible=false;form.Invalidate();}
   else if(cmd=="stop"){form.Close();return;}
   Console.WriteLine("done");Console.Out.Flush();
  });if(cmd=="stop")break;}});
  Application.Run(form);
 }
}
