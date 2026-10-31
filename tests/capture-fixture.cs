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
      return "{\"frame\":"+frameJson+",\"frameHresult\":"+frameResult+",\"nativeWindowHandle\":"+form.Handle.ToInt64()+",\"processId\":"+System.Diagnostics.Process.GetCurrentProcess().Id+",\"window\":"+Box(window)+",\"client\":"+Box(client)+",\"minimized\":"+(form.WindowState==FormWindowState.Minimized?"true":"false")+",\"foregroundHandle\":"+GetForegroundWindow().ToInt64()+",\"lastInputTick\":"+input.Tick+"}";
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
    SetProcessDPIAware();
    Console.OutputEncoding = new System.Text.UTF8Encoding(false);
    CaptureForm target = new CaptureForm { Text = args[0], BackColor = Color.FromArgb(20,150,80), StartPosition = FormStartPosition.Manual, Left = 30, Top = 40, Width = 320, Height = 200 };
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
          if (captured.StartsWith("place:",StringComparison.Ordinal)) {
            string[] parts=captured.Split(':');IntPtr previous=SetThreadDpiAwarenessContext(new IntPtr(-4));
            try {if(previous==IntPtr.Zero || !SetWindowPos(target.Handle,IntPtr.Zero,Int32.Parse(parts[1]),Int32.Parse(parts[2]),0,0,0x15))throw new InvalidOperationException("Owned placement failed");}
            finally {if(previous!=IntPtr.Zero)SetThreadDpiAwarenessContext(previous);}
            Console.WriteLine(Oracle(target));Console.Out.Flush();return;
          }
          if (captured == "cover") cover.Show();
          else if (captured == "minimize") target.WindowState = FormWindowState.Minimized;
          else if (captured == "hide") target.Hide();
          else if (captured == "stop") { cover.Dispose(); target.Close(); return; }
          Console.WriteLine("ok"); Console.Out.Flush();
        });
        if (captured == "stop") break;
      }
    });
    System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer { Interval = 60000 };
    timer.Tick += delegate { cover.Dispose(); target.Close(); };
    timer.Start(); Application.Run(target);
  }
}
