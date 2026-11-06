using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Drawing;
using System.Threading;
using System.Windows.Forms;

class CaptureForm : Form {
  protected override bool ShowWithoutActivation { get { return true; } }
}

class CaptureFixture {
  [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr window);
  [DllImport("user32.dll")] static extern IntPtr GetWindowDpiAwarenessContext(IntPtr window);
  [DllImport("user32.dll")] static extern int GetAwarenessFromDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
  static string MarkerPoints(CaptureForm form) {
    if(!Object.Equals(form.Tag,"display"))return "[]";
    var points=new List<string>();int[,] xy={{70,70},{210,115}};int[,] colors={{230,30,40},{30,60,230}};
    for(int i=0;i<2;i++){Point p=new Point{X=xy[i,0],Y=xy[i,1]};if(!ClientToScreen(form.Handle,ref p))throw new InvalidOperationException("Marker position unavailable");points.Add("{\"x\":"+p.X+",\"y\":"+p.Y+",\"rgb\":["+colors[i,0]+","+colors[i,1]+","+colors[i,2]+"]}");}
    return "["+String.Join(",",points.ToArray())+"]";
  }
  static string ScreenSamples(CaptureForm form,uint helper) {
    if(GetForegroundWindow()!=form.Handle)throw new InvalidOperationException("OWNED_CAPTURE_NOT_FOREGROUND");
    var rows=new List<string>();foreach(int offset in new int[]{16,20,24}){
      Point p=new Point{X=offset,Y=offset};if(!ClientToScreen(form.Handle,ref p))throw new InvalidOperationException("Owned point unavailable");uint pid;GetWindowThreadProcessId(WindowFromPoint(p),out pid);
      if(pid!=(uint)System.Diagnostics.Process.GetCurrentProcess().Id && pid!=helper)throw new InvalidOperationException("OWNED_POINT_OCCLUDED");
      using(var image=new Bitmap(1,1)){using(var g=Graphics.FromImage(image))g.CopyFromScreen(p.X,p.Y,0,0,new Size(1,1));Color c=image.GetPixel(0,0);rows.Add("{\"x\":"+p.X+",\"y\":"+p.Y+",\"rgb\":["+c.R+","+c.G+","+c.B+"]}");}
    }return "["+String.Join(",",rows.ToArray())+"]";
  }

  [StructLayout(LayoutKind.Sequential)] struct Rect {public int Left,Top,Right,Bottom;}
  [StructLayout(LayoutKind.Sequential)] struct Point {public int X,Y;}
  [StructLayout(LayoutKind.Sequential)] struct Info {public int Size;public Rect Bounds,Work;public uint Flags;}
  [StructLayout(LayoutKind.Sequential)] struct InputInfo {public uint Size,Tick;}
  delegate bool MonitorCallback(IntPtr monitor,IntPtr dc,ref Rect bounds,IntPtr data);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr window,int attribute,out Rect bounds,int bytes);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window,out Rect bounds);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr window,out Rect bounds);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr window,ref Point point);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window,IntPtr after,int x,int y,int width,int height,uint flags);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref InputInfo info);
  [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr dc,IntPtr clip,MonitorCallback callback,IntPtr data);
  [DllImport("user32.dll",EntryPoint="GetMonitorInfoW")] static extern bool GetMonitorInfo(IntPtr monitor,ref Info info);
  [DllImport("shcore.dll")] static extern int GetDpiForMonitor(IntPtr monitor,int kind,out uint x,out uint y);
  static string Box(Rect r) {return "{\"x\":"+r.Left+",\"y\":"+r.Top+",\"width\":"+(r.Right-r.Left)+",\"height\":"+(r.Bottom-r.Top)+"}";}
  static string Oracle(CaptureForm form) {
    IntPtr previous=SetThreadDpiAwarenessContext(new IntPtr(-4));
    if(previous==IntPtr.Zero)throw new InvalidOperationException("Physical oracle DPI context unavailable");
    try {
      Rect window,client,frame;Point origin=new Point();InputInfo input=new InputInfo {Size=(uint)Marshal.SizeOf(typeof(InputInfo))};
      if(!GetWindowRect(form.Handle,out window)||!GetClientRect(form.Handle,out client)||!ClientToScreen(form.Handle,ref origin)||!GetLastInputInfo(ref input))throw new InvalidOperationException("Physical fixture geometry unavailable");
      int frameResult=DwmGetWindowAttribute(form.Handle,9,out frame,Marshal.SizeOf(typeof(Rect)));
      string frameJson=frameResult==0 && frame.Right>frame.Left && frame.Bottom>frame.Top?Box(frame):"null";
      client.Right+=origin.X;client.Bottom+=origin.Y;client.Left=origin.X;client.Top=origin.Y;
      return "{\"windowDpi\":"+GetDpiForWindow(form.Handle)+",\"awareness\":"+GetAwarenessFromDpiAwarenessContext(GetWindowDpiAwarenessContext(form.Handle))+",\"points\":"+MarkerPoints(form)+",\"frame\":"+frameJson+",\"frameHresult\":"+frameResult+",\"nativeWindowHandle\":"+form.Handle.ToInt64()+",\"processId\":"+System.Diagnostics.Process.GetCurrentProcess().Id+",\"window\":"+Box(window)+",\"client\":"+Box(client)+",\"minimized\":"+(form.WindowState==FormWindowState.Minimized?"true":"false")+",\"foregroundHandle\":"+GetForegroundWindow().ToInt64()+",\"lastInputTick\":"+input.Tick+"}";
    } finally {SetThreadDpiAwarenessContext(previous);}
  }
  static string Layout() {
    IntPtr previous=SetThreadDpiAwarenessContext(new IntPtr(-4));
    if(previous==IntPtr.Zero)throw new InvalidOperationException("Physical monitor DPI context unavailable");
    try {
      var result=new List<string>();
      if(!EnumDisplayMonitors(IntPtr.Zero,IntPtr.Zero,delegate(IntPtr monitor,IntPtr dc,ref Rect bounds,IntPtr unused) {
        Info info=new Info {Size=Marshal.SizeOf(typeof(Info))};uint x,y;
        if(!GetMonitorInfo(monitor,ref info)||GetDpiForMonitor(monitor,0,out x,out y)!=0)throw new InvalidOperationException("Monitor metadata unavailable");
        result.Add("{\"primary\":"+((info.Flags&1)!=0?"true":"false")+",\"bounds\":"+Box(info.Bounds)+",\"workArea\":"+Box(info.Work)+",\"dpiX\":"+x+",\"dpiY\":"+y+"}");return true;
      },IntPtr.Zero))throw new InvalidOperationException("Monitor enumeration unavailable");
      return "["+String.Join(",",result.ToArray())+"]";
    } finally {SetThreadDpiAwarenessContext(previous);}
  }

  [STAThread]
  static void Main(string[] args) {
    bool display=Array.IndexOf(args,"--display")>=0;
    if(display){if(!SetProcessDpiAwarenessContext(new IntPtr(-4)))throw new InvalidOperationException("PMV2_UNAVAILABLE");}else SetProcessDPIAware();
    if(display)Application.SetUnhandledExceptionMode(UnhandledExceptionMode.ThrowException);
    Console.OutputEncoding = new System.Text.UTF8Encoding(false);
    CaptureForm target = new CaptureForm { Text = args[0], BackColor = Color.FromArgb(20,150,80), StartPosition = FormStartPosition.Manual, Left = 30, Top = 40, Width = 320, Height = 200 };
    if(display){target.Tag="display";target.Paint+=delegate(object sender,PaintEventArgs e){e.Graphics.ResetTransform();e.Graphics.PageUnit=GraphicsUnit.Pixel;using(var red=new SolidBrush(Color.FromArgb(230,30,40)))e.Graphics.FillRectangle(red,40,50,60,40);using(var blue=new SolidBrush(Color.FromArgb(30,60,230)))e.Graphics.FillRectangle(blue,180,95,60,40);};}
    if (args.Length > 1 && args[1] == "black") { target.FormBorderStyle = FormBorderStyle.None; target.BackColor = Color.Black; }
    CaptureForm cover = new CaptureForm { Text = args[0] + " cover", BackColor = Color.Magenta, StartPosition = FormStartPosition.Manual, Left = 30, Top = 40, Width = 320, Height = 200 };
    target.Shown += delegate { Console.WriteLine(target.Handle.ToInt64()); Console.Out.Flush(); };
    ThreadPool.QueueUserWorkItem(delegate {
      string command;
      while ((command = Console.ReadLine()) != null) {
        string captured = command;
        target.BeginInvoke((Action)delegate {
          if (captured == "oracle") { Console.WriteLine(Oracle(target));Console.Out.Flush();return; }
          if (captured == "layout") { Console.WriteLine(Layout());Console.Out.Flush();return; }
          if(captured.StartsWith("sample-screen:",StringComparison.Ordinal)){Console.WriteLine(ScreenSamples(target,UInt32.Parse(captured.Substring(14))));Console.Out.Flush();return;}
          if(captured.StartsWith("owned-region:",StringComparison.Ordinal)) {
            string[] p=captured.Split(':');target.FormBorderStyle=FormBorderStyle.None;
            if(!SetWindowPos(target.Handle,IntPtr.Zero,Int32.Parse(p[1]),Int32.Parse(p[2]),640,480,0x14))throw new InvalidOperationException("Owned region placement failed");
            target.Refresh();Console.WriteLine(Oracle(target));Console.Out.Flush();return;
          }
          if (captured.StartsWith("place:",StringComparison.Ordinal)) {
            string[] parts=captured.Split(':');IntPtr previous=SetThreadDpiAwarenessContext(new IntPtr(-4));
            try {if(previous==IntPtr.Zero || !SetWindowPos(target.Handle,IntPtr.Zero,Int32.Parse(parts[1]),Int32.Parse(parts[2]),0,0,0x15))throw new InvalidOperationException("Owned placement failed");}
            finally {if(previous!=IntPtr.Zero)SetThreadDpiAwarenessContext(previous);}
            Console.WriteLine(Oracle(target));Console.Out.Flush();return;
          }
          if (captured == "cover") cover.Show();
          else if (captured == "restore") { target.WindowState = FormWindowState.Normal; target.Show(); }
          else if (captured == "state") { Console.WriteLine("{\"visible\":"+(target.Visible?"true":"false")+",\"minimized\":"+(target.WindowState==FormWindowState.Minimized?"true":"false")+"}");Console.Out.Flush();return; }
          else if (captured == "minimize") target.WindowState = FormWindowState.Minimized;
          else if (captured == "hide") target.Hide();
          else if (captured == "stop") { cover.Dispose(); target.Close(); return; }
          Console.WriteLine("ok"); Console.Out.Flush();
        });
        if (captured == "stop") break;
      }
    });
    System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer { Interval = display?180000:60000 };
    timer.Tick += delegate { cover.Dispose(); target.Close(); };
    timer.Start(); Application.Run(target);
  }
}
