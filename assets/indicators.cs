using System;
using System.Collections.Generic;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

partial class StopBridge {
  class IndicatorWindow : Form {
    readonly bool frame;
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
      if(frame) {
        Region ring=new Region(ClientRectangle);int edge=Math.Max(3,(int)(7*scale));
        if(Width>edge*2 && Height>edge*2)ring.Exclude(new Rectangle(edge,edge,Width-edge*2,Height-edge*2));
        Region previous=Region;Region=ring;if(previous!=null)previous.Dispose();
      }
      Invalidate();
    }
    protected override void OnPaint(PaintEventArgs e) {
      if(frame) {
        int edge=Math.Max(3,(int)(7*DpiScale));
        for(int inset=0;inset<edge;inset++)using(Pen pen=new Pen(Color.FromArgb(255,Math.Min(220,45+inset*8),Math.Min(220,132+inset*5),235)))
          e.Graphics.DrawRectangle(pen,inset,inset,Math.Max(0,Width-inset*2-1),Math.Max(0,Height-inset*2-1));
      } else {
        using(Pen pen=new Pen(Color.FromArgb(62,156,255),Math.Max(1,2*DpiScale)))e.Graphics.DrawRectangle(pen,1,1,Width-3,Height-3);
        using(Font font=new Font("Segoe UI",Math.Max(9,10*DpiScale),FontStyle.Bold,GraphicsUnit.Point))
          TextRenderer.DrawText(e.Graphics,Caption,font,ClientRectangle,ForeColor,TextFormatFlags.HorizontalCenter|TextFormatFlags.VerticalCenter|TextFormatFlags.EndEllipsis|TextFormatFlags.NoPrefix);
      }
    }
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
    DateTime lastActivity=DateTime.MinValue,hideAt=DateTime.MinValue,previewUntil=DateTime.MinValue,lastLayout=DateTime.MinValue;
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
    public void Begin() { held=true;preview=false;hideAt=DateTime.MinValue;lastActivity=DateTime.UtcNow;Refresh(); }
    public void Touch() { if(held)lastActivity=DateTime.UtcNow; }
    public void End() { held=false;preview=false;hideAt=DateTime.UtcNow.AddMilliseconds(endDelay); }
    public void Stop() { held=false;preview=false;hideAt=DateTime.MinValue;Hide(); }
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
    bool Wanted() { return !suspended && (held || preview || hideAt>DateTime.UtcNow); }
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
      if(!form.Visible) {
        form.Show();EnableWindow(form.Handle,false);SetLayeredWindowAttributes(form.Handle,0,255,2);
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
      foreach(IndicatorWindow form in frames)Apply(form,screenEnabled);
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
      if(held && (now-lastActivity).TotalMilliseconds>=30000){held=false;hideAt=DateTime.MinValue;}
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
        {"text",caption},{"position",position},{"endDelayMs",endDelay},{"operationIdleMs",30000},{"previewDurationMs",2000},
        {"nonActivating",true},{"clickThrough",true},{"layout",Layout()}
        ,{"clickThroughHitTestPassed",hitTest},{"captureSuspensions",captureSuspensions}
      };
    }
    public void Dispose() {
      timer.Dispose();foreach(IndicatorWindow form in frames)form.Dispose();foreach(IndicatorWindow form in bars)form.Dispose();if(pointer!=null)pointer.Dispose();
      if(previewPath!=null)try{System.IO.File.Delete(previewPath);}catch(System.IO.IOException){}
    }
  }
}
