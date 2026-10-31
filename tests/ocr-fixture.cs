using System;
using System.Drawing;
using System.Threading;
using System.Windows.Forms;
class PaintedOcrButton : Button {
  readonly string paintedLabel;
  public PaintedOcrButton(string label) {
    paintedLabel=label;Text="";AccessibleName="";AccessibleDescription="";Name="";
    SetStyle(ControlStyles.UserPaint|ControlStyles.AllPaintingInWmPaint|ControlStyles.OptimizedDoubleBuffer,true);
  }
  protected override void OnPaint(PaintEventArgs e) {
    e.Graphics.Clear(Color.White);e.Graphics.DrawRectangle(Pens.Black,0,0,Width-1,Height-1);
    using(var font=new Font("Arial",28,FontStyle.Bold)) using(var format=new StringFormat { Alignment=StringAlignment.Center,LineAlignment=StringAlignment.Center })
      e.Graphics.DrawString(paintedLabel,font,Brushes.Black,ClientRectangle,format);
  }
}
class OcrFixture : Form {
  [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  protected override bool ShowWithoutActivation { get { return true; } }
  Form cover;
  readonly bool visualAssociation;
  PaintedOcrButton approve,ignore;
  string approveCode,ignoreCode;
  int approveCount,ignoreCount;
  OcrFixture(string title,bool visual) {
    Text=title; StartPosition=FormStartPosition.Manual; Location=new Point(160,180); ClientSize=new Size(600,360); BackColor=Color.White; ShowInTaskbar=false;
    visualAssociation=visual;
    if(visual) {
      var random=new Random(Guid.NewGuid().GetHashCode());approveCode=random.Next(1000,10000).ToString();
      do { ignoreCode=random.Next(1000,10000).ToString(); } while(ignoreCode==approveCode);
      bool approveFirst=random.Next(2)==0,approveTop=random.Next(2)==0;
      approve=new PaintedOcrButton("APPROVE "+approveCode);ignore=new PaintedOcrButton("IGNORE "+ignoreCode);
      approve.SetBounds(random.Next(30,70),approveTop?random.Next(25,45):random.Next(205,225),500,100);
      ignore.SetBounds(random.Next(30,70),approveTop?random.Next(205,225):random.Next(25,45),500,100);
      approve.Click+=delegate { approveCount++; };ignore.Click+=delegate { ignoreCount++; };
      if(approveFirst) { Controls.Add(approve);Controls.Add(ignore); } else { Controls.Add(ignore);Controls.Add(approve); }
    }
  }
  protected override void OnPaint(PaintEventArgs e) { base.OnPaint(e); if(!visualAssociation) using(Font font=new Font("Arial",28)) { for(int index=0;index<4;index++) e.Graphics.DrawString("HELLO 123",font,Brushes.Black,30,35+index*72); } }
  static string BoundsJson(Rectangle r) { return "{\"x\":"+r.X+",\"y\":"+r.Y+",\"width\":"+r.Width+",\"height\":"+r.Height+"}"; }
  static string Oracle(OcrFixture form) {
    if(form.visualAssociation) return "{\"visualAssociation\":true,\"target\":{\"nativeWindowHandle\":"+form.Handle.ToInt64()+",\"processId\":"+System.Diagnostics.Process.GetCurrentProcess().Id+",\"windowBounds\":"+BoundsJson(form.Bounds)+",\"clientBounds\":"+BoundsJson(form.RectangleToScreen(form.ClientRectangle))+"},\"approve\":{\"code\":\""+form.approveCode+"\",\"count\":"+form.approveCount+",\"bounds\":"+BoundsJson(form.RectangleToScreen(form.approve.Bounds))+"},\"ignore\":{\"code\":\""+form.ignoreCode+"\",\"count\":"+form.ignoreCount+",\"bounds\":"+BoundsJson(form.RectangleToScreen(form.ignore.Bounds))+"}}";
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
    SetProcessDPIAware(); Application.EnableVisualStyles(); var form=new OcrFixture(args[0],args.Length>1&&args[1]=="visual-association");
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
