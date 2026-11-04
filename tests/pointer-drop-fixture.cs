using System;
using System.Drawing;
using System.Threading;
using System.Windows.Forms;
class PointerDropFixture {
  [System.Runtime.InteropServices.DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [System.Runtime.InteropServices.DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  static int drops,heldActivation,heldAtEntry;
  [STAThread] static void Main(string[] args) {
    Console.OutputEncoding=new System.Text.UTF8Encoding(false);
    bool receiver=Array.IndexOf(args,"--receiver")>=0;
    bool cross=receiver || Array.IndexOf(args,"--source")>=0;
    Form form=new Form {Text=args[0],Width=520,Height=300};
    if(cross) {
      Rectangle area=Screen.PrimaryScreen.WorkingArea;
      if(area.Width<1100 || area.Height<400) throw new InvalidOperationException("cross-app fixture requires a 1100x400 work area");
      form.StartPosition=FormStartPosition.Manual;form.Left=area.Left+(receiver?540:20);form.Top=area.Top+60;form.TopMost=true;
    }
    Button source=new Button {Text="Drop source",AccessibleName="Drop source",Left=40,Top=70,Width=140,Height=120,BackColor=Color.LightBlue};
    Button destination=new Button {Text="Drop target",AccessibleName="Drop target",Left=300,Top=70,Width=140,Height=120,BackColor=Color.LightGreen,AllowDrop=true};
    source.MouseMove+=delegate(object sender,MouseEventArgs e) {if(e.Button==MouseButtons.Left) source.DoDragDrop("pi-drop-fixture",DragDropEffects.Copy);};
    destination.DragEnter+=delegate(object sender,DragEventArgs e) {if(e.Data.GetDataPresent(DataFormats.Text)) {e.Effect=DragDropEffects.Copy;if(receiver){if((GetAsyncKeyState(1)&0x8000)!=0)Interlocked.Increment(ref heldAtEntry);form.Activate();if(GetForegroundWindow()==form.Handle && (GetAsyncKeyState(1)&0x8000)!=0)Interlocked.Increment(ref heldActivation);}}};
    destination.DragOver+=delegate(object sender,DragEventArgs e) {if(receiver && GetForegroundWindow()==form.Handle && (GetAsyncKeyState(1)&0x8000)!=0)Interlocked.Increment(ref heldActivation);};
    destination.DragDrop+=delegate(object sender,DragEventArgs e) {if((string)e.Data.GetData(DataFormats.Text)=="pi-drop-fixture") Interlocked.Increment(ref drops);};
    form.Controls.Add(source);form.Controls.Add(destination);
    form.Shown+=delegate {Console.WriteLine(form.Handle.ToInt64());Console.Out.Flush();};
    ThreadPool.QueueUserWorkItem(delegate {string command;while((command=Console.ReadLine())!=null) {if(command=="geometry") form.BeginInvoke((Action)delegate {Point s=source.PointToScreen(Point.Empty),d=destination.PointToScreen(Point.Empty);Console.WriteLine("geometry:"+form.Handle.ToInt64()+":"+System.Diagnostics.Process.GetCurrentProcess().Id+":"+(form.Visible&&source.Visible&&destination.Visible?1:0)+":"+(IsWindowVisible(form.Handle)&&IsWindowVisible(source.Handle)&&IsWindowVisible(destination.Handle)?1:0)+":"+s.X+":"+s.Y+":"+source.Width+":"+source.Height+":"+d.X+":"+d.Y+":"+destination.Width+":"+destination.Height);Console.Out.Flush();});else if(command=="observe") {Console.WriteLine("state:"+Interlocked.CompareExchange(ref drops,0,0)+":"+((GetAsyncKeyState(1)&0x8000)!=0?1:0)+":"+GetForegroundWindow().ToInt64()+":"+Interlocked.CompareExchange(ref heldActivation,0,0)+":"+Interlocked.CompareExchange(ref heldAtEntry,0,0));Console.Out.Flush();} else if(command=="stop") {form.BeginInvoke((Action)delegate{form.Close();});break;}}});
    Application.Run(form);
  }
}
