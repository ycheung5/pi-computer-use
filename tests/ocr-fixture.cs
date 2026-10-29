using System;
using System.Drawing;
using System.Threading;
using System.Windows.Forms;
class OcrFixture : Form {
  Form cover;
  OcrFixture(string title) { Text=title; StartPosition=FormStartPosition.Manual; Location=new Point(160,180); ClientSize=new Size(600,360); BackColor=Color.White; ShowInTaskbar=false; }
  protected override void OnPaint(PaintEventArgs e) { base.OnPaint(e); using(Font font=new Font("Arial",28)) { for(int index=0;index<4;index++) e.Graphics.DrawString("HELLO 123",font,Brushes.Black,30,35+index*72); } }
  [STAThread] static void Main(string[] args) {
    Application.EnableVisualStyles(); var form=new OcrFixture(args[0]);
    form.Shown+=delegate { Console.WriteLine(form.Handle.ToInt64()); Console.Out.Flush(); };
    var input=new Thread(delegate() { string line; while((line=Console.ReadLine())!=null) {
      string command=line; form.BeginInvoke((Action)delegate {
        if(command=="stop") form.Close();
        else if(command=="minimize") form.WindowState=FormWindowState.Minimized;
        else if(command=="cover") { form.cover=new Form { StartPosition=FormStartPosition.Manual, Location=form.Location, Size=form.Size, BackColor=Color.Magenta, ShowInTaskbar=false }; form.cover.Show(); }
        if(command!="stop") { Console.WriteLine("done"); Console.Out.Flush(); }
      });
    } }); input.IsBackground=true; input.Start(); Application.Run(form);
    if(form.cover!=null) form.cover.Close();
  }
}
