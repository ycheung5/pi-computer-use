using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

class StopBusyFixture {
  delegate IntPtr Hook(int code,IntPtr message,IntPtr data);
  [StructLayout(LayoutKind.Sequential)] struct KeyInput {public uint Code,Scan,Flags,Time;public UIntPtr Extra;}
  [StructLayout(LayoutKind.Sequential)] struct Point {public int X,Y;}
  [StructLayout(LayoutKind.Sequential)] struct MouseInput {public Point Point;public uint Data,Flags,Time;public UIntPtr Extra;}
  [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SetWindowsHookEx(int kind,Hook callback,IntPtr module,uint thread);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook,int code,IntPtr message,IntPtr data);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
  sealed class HeldForm:Form {public void ReplaceHandle(){RecreateHandle();}}
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  static void Reply(string value) { Console.WriteLine(value); Console.Out.Flush(); }
  [STAThread] static void Main(string[] args) {
    var form = new HeldForm { Text=args[0], Width=520, Height=240 };
    var edit = new TextBox { AccessibleName="Pi stop test editor", Multiline=true, Dock=DockStyle.Fill };
    form.Controls.Add(edit);
    bool heldMode=args.Length>1 && args[1]=="held";
    string heldCase="";EventWaitHandle cancel=null;bool triggered=false;
    Action<int> onHeld=delegate(int key) {
      if(!heldMode || triggered || heldCase.Length==0 || GetForegroundWindow()!=form.Handle || GetAsyncKeyState(key)>=0)return;
      triggered=true;
      // A later tagged input reaches this passive observer while Windows reports
      // the earlier Ctrl/button down. Signal/fail before that SendInput returns;
      // never swallow input or introduce production sleeps/hold operations.
      if(heldCase.EndsWith("cancel"))cancel.Set();else if(key==1)form.ReplaceHandle();else form.Enabled=false;
      Reply("held:"+key+":1:"+heldCase);
    };
    Hook keyboard=delegate(int code,IntPtr message,IntPtr data) {
      if(code>=0 && heldCase.StartsWith("key")) {KeyInput input=(KeyInput)Marshal.PtrToStructure(data,typeof(KeyInput));if(input.Extra==new UIntPtr(0x50494355) && (input.Flags&0x10)!=0 && (input.Flags&0x80)==0 && (input.Code==18 || input.Code==164 || input.Code==165))onHeld(17);}
      return CallNextHookEx(IntPtr.Zero,code,message,data);
    };
    Hook mouse=delegate(int code,IntPtr message,IntPtr data) {
      if(code>=0 && heldCase.StartsWith("button") && message.ToInt64()==0x200) {MouseInput input=(MouseInput)Marshal.PtrToStructure(data,typeof(MouseInput));if(input.Extra==new UIntPtr(0x50494355) && (input.Flags&1)!=0)onHeld(1);}
      return CallNextHookEx(IntPtr.Zero,code,message,data);
    };
    IntPtr keyHook=IntPtr.Zero,mouseHook=IntPtr.Zero;
    if(heldMode) {
      keyHook=SetWindowsHookEx(13,keyboard,GetModuleHandle(null),0);mouseHook=SetWindowsHookEx(14,mouse,GetModuleHandle(null),0);
      if(keyHook==IntPtr.Zero || mouseHook==IntPtr.Zero)throw new InvalidOperationException("HELD_OBSERVER_UNAVAILABLE");
    }
    int count=0;
    edit.TextChanged += delegate { count=edit.TextLength; if(count==1) Reply("started"); };
    form.Shown += delegate { edit.Focus(); Reply("ready:"+form.Handle.ToInt64()); };
    ThreadPool.QueueUserWorkItem(delegate {
      string command;
      while((command=Console.ReadLine())!=null) {
        if(heldMode && command.StartsWith("arm:")) {
          string[] parts=command.Split(new char[]{':'},3);
          form.BeginInvoke((Action)delegate {
            heldCase=parts[1];cancel=EventWaitHandle.OpenExisting(parts[2]);
            var point=edit.PointToScreen(new System.Drawing.Point(edit.Width/2,edit.Height/2));
            Reply("armed:"+point.X+":"+point.Y);
          });
        }
        if(heldMode && command=="released") {
          bool released=true;foreach(int key in new int[]{1,2,4,16,17,18,27,65,91,92,120})if(GetAsyncKeyState(key)<0)released=false;
          Reply("released:"+(released?1:0));
        }
        if(heldMode && command=="foreground") Reply("foreground:"+(GetForegroundWindow()==form.Handle?1:0));
        if(command=="observe") form.BeginInvoke((Action)delegate {
          bool released=true;
          foreach(int key in new int[]{1,2,4,16,17,18,27,65,91,92,120}) if(GetAsyncKeyState(key)<0) released=false;
          int unexpected=0;foreach(char character in edit.Text)if(character!='x')unexpected++;
          Reply("state:"+count+":"+(released?"released":"held")+":"+unexpected);
        });
        if(command=="stop") { form.BeginInvoke((Action)delegate { form.Close(); }); return; }
      }
    });
    try {Application.Run(form);}finally{if(cancel!=null)cancel.Dispose();if(keyHook!=IntPtr.Zero)UnhookWindowsHookEx(keyHook);if(mouseHook!=IntPtr.Zero)UnhookWindowsHookEx(mouseHook);GC.KeepAlive(keyboard);GC.KeepAlive(mouse);}
  }
}
