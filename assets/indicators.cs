using System;
using System.Collections.Generic;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

partial class StopBridge {
  class IndicatorWindow : Form {
    readonly bool frame;
    [StructLayout(LayoutKind.Sequential)] struct LayerPoint { public int X,Y; }
    [StructLayout(LayoutKind.Sequential)] struct LayerSize { public int Width,Height; }
    [StructLayout(LayoutKind.Sequential,Pack=1)] struct BlendFunction { public byte Operation,Flags,Alpha,Format; }
    [DllImport("gdi32.dll",SetLastError=true)] static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll",SetLastError=true)] static extern IntPtr SelectObject(IntPtr dc,IntPtr value);
    [DllImport("gdi32.dll",SetLastError=true)] static extern bool DeleteObject(IntPtr value);
    [DllImport("gdi32.dll",SetLastError=true)] static extern bool DeleteDC(IntPtr dc);
    [DllImport("user32.dll",SetLastError=true)] static extern bool UpdateLayeredWindow(IntPtr window,IntPtr screen,ref LayerPoint destination,ref LayerSize size,IntPtr source,ref LayerPoint origin,uint colorKey,ref BlendFunction blend,uint flags);
    IntPtr frameDc,frameBitmap,framePrevious;
    public bool IsFrame {get{return frame;}}
    public string FrameError="";
    public string Caption="";
    public float DpiScale=1;
    public IndicatorWindow(bool isFrame) {
      frame=isFrame;FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;TopMost=true;
      StartPosition=FormStartPosition.Manual;AutoScaleMode=AutoScaleMode.None;
      BackColor=Color.FromArgb(20,44,70);ForeColor=Color.White;Enabled=false;
      SetStyle(ControlStyles.AllPaintingInWmPaint|ControlStyles.OptimizedDoubleBuffer|ControlStyles.UserPaint,true);
    }
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams { get { CreateParams value=base.CreateParams;value.ExStyle|=0x08000000|0x00000080|0x00000020|0x00080000;return value; } }
    public void LayoutAt(Rectangle bounds,float scale) {
      if(Bounds==bounds && DpiScale==scale)return;
      DpiScale=scale;Bounds=bounds;
      if(frame)BuildFrame();
      Invalidate();
    }
    void ReleaseFrame() {
      if(frameDc!=IntPtr.Zero) {if(framePrevious!=IntPtr.Zero)SelectObject(frameDc,framePrevious);if(frameBitmap!=IntPtr.Zero)DeleteObject(frameBitmap);DeleteDC(frameDc);}
      else if(frameBitmap!=IntPtr.Zero)DeleteObject(frameBitmap);
      frameDc=IntPtr.Zero;frameBitmap=IntPtr.Zero;framePrevious=IntPtr.Zero;
    }
    void BuildFrame() {
      ReleaseFrame();FrameError="";
      if(Width<2 || Height<2){FrameError="Indicator frame has invalid dimensions";return;}
      try {
      using(Bitmap image=new Bitmap(Width,Height,System.Drawing.Imaging.PixelFormat.Format32bppPArgb)) {
        using(Graphics graphics=Graphics.FromImage(image)) {
        graphics.Clear(Color.Transparent);
        graphics.CompositingMode=System.Drawing.Drawing2D.CompositingMode.SourceCopy;
        float scale=Math.Max(1f,Math.Min(2f,Width/1920f));
        int core=(int)Math.Round(3*scale),glow=core+(int)Math.Round(27*scale);
        for(int inset=0;inset<glow && Width-2*inset>1 && Height-2*inset>1;inset++) {
          Color color=inset<core?Color.FromArgb(235,150,184,255):Color.FromArgb((int)(175*Math.Pow(1-(inset-core)/(double)(glow-core),2.2)),77,124,254);
          using(Pen pen=new Pen(color,1))graphics.DrawRectangle(pen,inset,inset,Width-2*inset-1,Height-2*inset-1);
        }
        }
        frameBitmap=image.GetHbitmap(Color.FromArgb(0));
      }
      frameDc=CreateCompatibleDC(IntPtr.Zero);
      if(frameDc==IntPtr.Zero){FrameError="Indicator frame DC creation failed: "+Marshal.GetLastWin32Error();ReleaseFrame();return;}
      framePrevious=SelectObject(frameDc,frameBitmap);
      if(framePrevious==IntPtr.Zero || framePrevious==new IntPtr(-1)){FrameError="Indicator frame bitmap selection failed: "+Marshal.GetLastWin32Error();framePrevious=IntPtr.Zero;ReleaseFrame();}
      } catch(Exception error) {FrameError="Indicator frame preparation failed: "+error.Message;ReleaseFrame();}
    }
    public bool PresentFrame() {
      if(!frame || frameDc==IntPtr.Zero)return false;
      LayerPoint destination=new LayerPoint{X=Left,Y=Top},origin=new LayerPoint();
      LayerSize size=new LayerSize{Width=Width,Height=Height};
      BlendFunction blend=new BlendFunction{Operation=0,Flags=0,Alpha=255,Format=1};
      bool presented=UpdateLayeredWindow(Handle,IntPtr.Zero,ref destination,ref size,frameDc,ref origin,0,ref blend,2);
      if(!presented)FrameError="Indicator frame presentation failed: "+Marshal.GetLastWin32Error();
      else FrameError="";
      return presented;
    }
    protected override void OnPaint(PaintEventArgs e) {
      if(frame)return;
      using(Pen pen=new Pen(Color.FromArgb(62,156,255),Math.Max(1,2*DpiScale)))e.Graphics.DrawRectangle(pen,1,1,Width-3,Height-3);
      using(Font font=new Font("Segoe UI",Math.Max(9,10*DpiScale),FontStyle.Bold,GraphicsUnit.Point))
        TextRenderer.DrawText(e.Graphics,Caption,font,ClientRectangle,ForeColor,TextFormatFlags.HorizontalCenter|TextFormatFlags.VerticalCenter|TextFormatFlags.EndEllipsis|TextFormatFlags.NoPrefix);
    }
    protected override void Dispose(bool disposing) {if(disposing)ReleaseFrame();base.Dispose(disposing);}

  }
  class Presentation : IDisposable {
    [StructLayout(LayoutKind.Sequential)] struct Point { public int X,Y; }
    [StructLayout(LayoutKind.Sequential)] struct CursorInfo { public int Size,Flags;public IntPtr Cursor;public Point Position; }
    [StructLayout(LayoutKind.Sequential)] struct IconInfo { public bool Icon;public uint HotX,HotY;public IntPtr Mask,Color; }
    [StructLayout(LayoutKind.Sequential)] struct BitmapInfo { public int Type,Width,Height,WidthBytes;public ushort Planes,BitsPixel;public IntPtr Bits; }
    [DllImport("user32.dll")] static extern bool EnableWindow(IntPtr window,bool enabled);
    [DllImport("user32.dll")] static extern bool SetLayeredWindowAttributes(IntPtr window,uint key,byte alpha,uint flags);
    [DllImport("user32.dll")] static extern bool SetWindowDisplayAffinity(IntPtr window,uint affinity);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(Point point,uint flags);
    [DllImport("shcore.dll")] static extern int GetDpiForMonitor(IntPtr monitor,int type,out uint x,out uint y);
    [DllImport("user32.dll")] static extern bool GetCursorInfo(ref CursorInfo info);
    [DllImport("user32.dll")] static extern bool GetIconInfo(IntPtr icon,out IconInfo info);
    [DllImport("gdi32.dll",CharSet=CharSet.Unicode)] static extern int GetObject(IntPtr value,int bytes,out BitmapInfo info);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr value);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint process);
    readonly System.Windows.Forms.Timer timer;
    readonly List<IndicatorWindow> frames=new List<IndicatorWindow>();
    readonly List<IndicatorWindow> bars=new List<IndicatorWindow>();
    IndicatorWindow pointer;
    bool screenEnabled=true,pointerEnabled=true,remoteVisible=true,held,suspended,preview,renderChecked;
    int captureSuspensions;
    string previewPath;
    bool? affinityApplied=null;
    string caption="Pi is controlling the computer",position="top",layoutKey="";
    int endDelay=800;
    DateTime previewUntil=DateTime.MinValue,lastLayout=DateTime.MinValue;
    public Presentation() {
      timer=new System.Windows.Forms.Timer { Interval=40 };
      timer.Tick+=delegate { Tick(); };timer.Start();
    }
    static bool Switch(Dictionary<string,object> values,string name,bool fallback) { object value;return values.TryGetValue(name,out value)?Convert.ToBoolean(value):fallback; }
    public void Configure(Dictionary<string,object> values) {
      screenEnabled=Switch(values,"indicatorEnabled",true);pointerEnabled=Switch(values,"cursorIndicatorEnabled",true);remoteVisible=Switch(values,"remoteIndicatorVisible",true);
      object value;caption=values.TryGetValue("indicatorText",out value)?Convert.ToString(value):"Pi is controlling the computer";
      position=values.TryGetValue("indicatorPosition",out value)?Convert.ToString(value):"top";
      endDelay=values.TryGetValue("indicatorIdleMs",out value)?Convert.ToInt32(value):800;
      layoutKey="";Refresh();
    }
    public void Begin() {
      held=true;preview=false;Refresh();
      if(!BorderReady)throw new InvalidOperationException("EXCLUSIVE_CONTROL_UNAVAILABLE: control border failed");
    }
    public bool BorderReady {get {return held && (suspended || (frames.Count>0 && frames.TrueForAll(frame=>frame.Visible && frame.FrameError.Length==0)));}}
    public void Stop() { held=false;preview=false;Hide(); }
    public void Suspend(bool value) { if(value)captureSuspensions++;suspended=value;Refresh(); }
    public void Preview(bool show) {
      if(!show) {
        using(IndicatorWindow sample=new IndicatorWindow(false))
        using(Bitmap pixels=new Bitmap(320,42)) {
          sample.Caption=caption+"  ·  Esc to stop";sample.LayoutAt(new Rectangle(0,0,320,42),1);sample.DrawToBitmap(pixels,new Rectangle(0,0,320,42));
          if(previewPath!=null)try{System.IO.File.Delete(previewPath);}catch(System.IO.IOException){}
          previewPath=System.IO.Path.Combine(System.IO.Path.GetTempPath(),"pi-cu-indicator-preview-"+Guid.NewGuid().ToString("N")+".png");
          pixels.Save(previewPath,System.Drawing.Imaging.ImageFormat.Png);
          renderChecked=true;
        }
        return;
      }
      preview=true;previewUntil=DateTime.UtcNow.AddMilliseconds(2000);Refresh();
    }
    bool Wanted() { return !suspended && (held || preview); }
    static float MonitorScale(Screen screen) {
      uint x,y;
      try {
        IntPtr monitor=MonitorFromPoint(new Point {X=screen.Bounds.Left+screen.Bounds.Width/2,Y=screen.Bounds.Top+screen.Bounds.Height/2},2);
        if(GetDpiForMonitor(monitor,0,out x,out y)==0 && x>=48 && x<=768)return x/96f;
      } catch(EntryPointNotFoundException) { } catch(DllNotFoundException) { }
      return 1;
    }
    List<object> Layout() {
      List<object> result=new List<object>();
      foreach(Screen screen in Screen.AllScreens) {
        float scale=MonitorScale(screen);Rectangle work=screen.WorkingArea;int height=(int)(42*scale),width=Math.Min(work.Width,(int)(600*scale));
        int x=work.Left+(work.Width-width)/2,y=position=="bottom"?work.Bottom-height-8:work.Top+8;
        result.Add(new Dictionary<string,object> {
          {"device",screen.DeviceName},{"x",screen.Bounds.X},{"y",screen.Bounds.Y},{"width",screen.Bounds.Width},{"height",screen.Bounds.Height},
          {"scale",scale},{"bar",new Dictionary<string,object>{{"x",x},{"y",y},{"width",width},{"height",height}}}
        });
      }
      return result;
    }
    void Rebuild() {
      if(layoutKey.Length>0 && (DateTime.UtcNow-lastLayout).TotalMilliseconds<500)return;
      lastLayout=DateTime.UtcNow;
      string key=position+"|"+caption+"|"+remoteVisible;
      foreach(Screen screen in Screen.AllScreens)key+="|"+screen.DeviceName+screen.Bounds+screen.WorkingArea+MonitorScale(screen);
      if(key==layoutKey)return;
      layoutKey=key;
      foreach(IndicatorWindow form in frames)form.Dispose();frames.Clear();
      foreach(IndicatorWindow form in bars)form.Dispose();bars.Clear();
      if(pointer!=null){pointer.Dispose();pointer=null;}
      affinityApplied=null;
      foreach(Screen screen in Screen.AllScreens) {
        float scale=MonitorScale(screen);Rectangle work=screen.WorkingArea;int height=(int)(42*scale),width=Math.Min(work.Width,(int)(600*scale));
        IndicatorWindow frame=new IndicatorWindow(true);frame.LayoutAt(screen.Bounds,scale);frames.Add(frame);
        IndicatorWindow bar=new IndicatorWindow(false);bar.Caption=caption+"  ·  Esc to stop";bar.LayoutAt(new Rectangle(work.Left+(work.Width-width)/2,position=="bottom"?work.Bottom-height-8:work.Top+8,width,height),scale);bars.Add(bar);
      }
      pointer=new IndicatorWindow(false);pointer.Caption="Pi";
    }
    void Apply(IndicatorWindow form,bool visible) {
      if(!visible) { form.Hide();return; }
      // A failed frame stays hidden until layout/configuration rebuilds it.
      // Do not repeatedly show and hide a failing layered window on each tick.
      if(form.IsFrame && form.FrameError.Length>0)return;
      if(!form.Visible) {
        form.Show();EnableWindow(form.Handle,false);
        if(form.IsFrame) {if(!form.PresentFrame()){form.Hide();return;}}
        else SetLayeredWindowAttributes(form.Handle,0,255,2);
        if(!SetWindowDisplayAffinity(form.Handle,remoteVisible?0U:0x11U))affinityApplied=false;
        else if(!affinityApplied.HasValue)affinityApplied=true;
      }
    }
    static Size CursorExtent() {
      CursorInfo cursor=new CursorInfo {Size=Marshal.SizeOf(typeof(CursorInfo))};IconInfo icon;
      if(!GetCursorInfo(ref cursor) || !GetIconInfo(cursor.Cursor,out icon))return new Size(32,32);
      try {
        BitmapInfo bitmap;IntPtr source=icon.Color!=IntPtr.Zero?icon.Color:icon.Mask;
        if(source!=IntPtr.Zero && GetObject(source,Marshal.SizeOf(typeof(BitmapInfo)),out bitmap)>0)
          return new Size(Math.Max(16,bitmap.Width),Math.Max(16,icon.Color!=IntPtr.Zero?bitmap.Height:bitmap.Height/2));
      } finally { if(icon.Color!=IntPtr.Zero)DeleteObject(icon.Color);if(icon.Mask!=IntPtr.Zero)DeleteObject(icon.Mask); }
      return new Size(32,32);
    }
    void Refresh() {
      if(!Wanted()) { Hide();return; }
      Rebuild();
      foreach(IndicatorWindow form in frames)Apply(form,screenEnabled || held);
      foreach(IndicatorWindow form in bars)Apply(form,screenEnabled);
      if(pointer!=null) {
        System.Drawing.Point cursor=Cursor.Position;Screen screen=Screen.FromPoint(cursor);float scale=MonitorScale(screen);Size extent=CursorExtent();
        int width=(int)(64*scale),height=(int)(32*scale),offset=(int)(8*scale);
        int x=cursor.X+extent.Width+offset,y=cursor.Y+extent.Height+offset;
        if(x+width>screen.WorkingArea.Right)x=cursor.X-width-offset;
        if(y+height>screen.WorkingArea.Bottom)y=cursor.Y-height-offset;
        x=Math.Max(screen.WorkingArea.Left,x);y=Math.Max(screen.WorkingArea.Top,y);
        pointer.LayoutAt(new Rectangle(x,y,width,height),scale);Apply(pointer,pointerEnabled);
      }
    }
    void Hide() {
      foreach(IndicatorWindow form in frames)form.Hide();foreach(IndicatorWindow form in bars)form.Hide();if(pointer!=null)pointer.Hide();
    }
    void Tick() {
      DateTime now=DateTime.UtcNow;
      if(preview && now>=previewUntil)preview=false;
      if(!Wanted()){Hide();return;}
      Refresh();
    }
    public object Status() {
      int visible=0;foreach(IndicatorWindow form in frames)if(form.Visible)visible++;foreach(IndicatorWindow form in bars)if(form.Visible)visible++;if(pointer!=null && pointer.Visible)visible++;
      bool? hitTest=null;
      foreach(IndicatorWindow form in bars)if(form.Visible) {
        uint process;GetWindowThreadProcessId(WindowFromPoint(new Point {X=form.Left+form.Width/2,Y=form.Top+form.Height/2}),out process);
        bool skipped=process!=(uint)System.Diagnostics.Process.GetCurrentProcess().Id;
        hitTest=hitTest.HasValue?hitTest.Value && skipped:skipped;
      }
      return new Dictionary<string,object> {
        {"held",held},{"renderChecked",renderChecked},{"previewPath",previewPath},{"preview",preview},{"suspended",suspended},{"visible",visible>0},{"visibleWindows",visible},
        {"screenEnabled",screenEnabled},{"pointerEnabled",pointerEnabled},{"remoteVisible",remoteVisible},{"captureAffinityApplied",affinityApplied},
        {"text",caption},{"position",position},{"endDelayMs",endDelay},{"operationIdleMs",0},{"previewDurationMs",2000},
        {"nonActivating",true},{"clickThrough",true},{"layout",Layout()},
        {"frameErrors",frames.FindAll(frame=>frame.FrameError.Length>0).ConvertAll(frame=>frame.FrameError)}
        ,{"clickThroughHitTestPassed",hitTest},{"captureSuspensions",captureSuspensions}
      };
    }
    public void Dispose() {
      timer.Dispose();foreach(IndicatorWindow form in frames)form.Dispose();foreach(IndicatorWindow form in bars)form.Dispose();if(pointer!=null)pointer.Dispose();
      if(previewPath!=null)try{System.IO.File.Delete(previewPath);}catch(System.IO.IOException){}
    }
  }
}
