using System;
using System.Drawing;
using System.Threading;
using System.Windows.Forms;
class OcrFixture : Form {
  [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  protected override bool ShowWithoutActivation { get { return true; } }
  Form cover;
  OcrFixture(string title) { Text=title; StartPosition=FormStartPosition.Manual; Location=new Point(160,180); ClientSize=new Size(600,360); BackColor=Color.White; ShowInTaskbar=false; }
  protected override void OnPaint(PaintEventArgs e) { base.OnPaint(e); using(Font font=new Font("Arial",28)) { for(int index=0;index<4;index++) e.Graphics.DrawString("HELLO 123",font,Brushes.Black,30,35+index*72); } }
  static string Oracle(OcrFixture form) {
    var r=form.RectangleToScreen(form.ClientRectangle);
    int left=600,top=90,right=0,bottom=0;
    // Independent painted source, not either engine's capture or OCR coordinates.
    using(var image=new Bitmap(600,90)) {
      using(var screen=form.CreateGraphics()) image.SetResolution(screen.DpiX,screen.DpiY);
      using(var graphics=Graphics.FromImage(image)) using(var font=new Font("Arial",28)) {
        graphics.Clear(Color.White); graphics.DrawString("HELLO 123",font,Brushes.Black,30,35);
      }
      for(int y=35;y<90;y++) for(int x=0;x<600;x++) {
        var color=image.GetPixel(x,y);
        if(color.R<160 && color.G<160 && color.B<160) { left=Math.Min(left,x);top=Math.Min(top,y);right=Math.Max(right,x);bottom=Math.Max(bottom,y); }
      }
    }
    return "{\"client\":{\"x\":"+r.X+",\"y\":"+r.Y+",\"width\":"+r.Width+",\"height\":"+r.Height+"},\"minimized\":"+(form.WindowState==FormWindowState.Minimized ? "true" : "false")+",\"ink\":{\"x\":"+(r.X+left)+",\"y\":"+(r.Y+top)+",\"width\":"+(right-left+1)+",\"height\":"+(bottom-top+1)+"}}";
  }
  [STAThread] static void Main(string[] args) {
    SetProcessDPIAware(); Application.EnableVisualStyles(); var form=new OcrFixture(args[0]);
    form.Shown+=delegate { Console.WriteLine(form.Handle.ToInt64()); Console.Out.Flush(); };
    var input=new Thread(delegate() { string line; while((line=Console.ReadLine())!=null) {
      string command=line; form.BeginInvoke((Action)delegate {
        if(command=="oracle") { Console.WriteLine(Oracle(form)); Console.Out.Flush(); return; }
        if(command=="stop") form.Close();
        else if(command=="clip") form.ClientSize=new Size(600,265);
        else if(command=="minimize") form.WindowState=FormWindowState.Minimized;
        else if(command=="cover") { form.cover=new Form { StartPosition=FormStartPosition.Manual, Location=form.Location, Size=form.Size, BackColor=Color.Magenta, ShowInTaskbar=false }; form.cover.Show(); }
        if(command!="stop") { Console.WriteLine("done"); Console.Out.Flush(); }
      });
    } }); input.IsBackground=true; input.Start(); Application.Run(form);
    if(form.cover!=null) form.cover.Close();
  }
}
