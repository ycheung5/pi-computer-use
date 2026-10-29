using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Automation;

partial class WindowsBridge {
  [StructLayout(LayoutKind.Sequential)] struct MouseInput { public int X,Y;public uint Data,Flags,Time;public UIntPtr Extra; }
  [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public MouseInput Mouse; [FieldOffset(0)] public KeyboardInput Keyboard; }
  [StructLayout(LayoutKind.Sequential)] struct PointerInput { public uint Type;public InputUnion Data; }
  [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint count,PointerInput[] input,int size);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(ControlPoint point);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")] static extern uint GetDoubleClickTime();
  static void PointerSend(uint flags,int data) {
    PointerInput item=new PointerInput {Type=0,Data=new InputUnion { Mouse=new MouseInput { Flags=flags,Data=unchecked((uint)data) }}};
    if(SendInput(1,new PointerInput[]{item},Marshal.SizeOf(typeof(PointerInput)))!=1)throw new InvalidOperationException("INPUT_DISPATCH_UNCONFIRMED: Windows rejected input; observe before retrying");
  }
  static string pointerOperation="";
  static bool pointerInputAction;
  static readonly Dictionary<string,string> pointerTitles=new Dictionary<string,string>();
  static string PointerTitleKey(Dictionary<string,object> args) {return pointerOperation+":"+TextOption(args,"windowTitle","").Trim().ToLowerInvariant();}
  static void RememberPointerTitle(Dictionary<string,object> args,IntPtr window) {
    if(TextOption(args,"windowTitle","").Length==0)return;
    if(pointerTitles.Count>10000)pointerTitles.Clear();
    pointerTitles[PointerTitleKey(args)]=window.ToInt64()+":"+WindowOwner(window);
  }
  static void CheckPointerTitle(Dictionary<string,object> args,IntPtr window) {
    string expected;
    if(pointerInputAction && TextOption(args,"windowTitle","").Length>0 && pointerTitles.TryGetValue(PointerTitleKey(args),out expected) && expected!=window.ToInt64()+":"+WindowOwner(window))throw new InvalidOperationException("TARGET_IDENTITY_CHANGED: observed title now refers to a different window; observe again");
  }
  static readonly Dictionary<string,Rect> pointerOrigins=new Dictionary<string,Rect>();
  static string PointerOriginKey(IntPtr window) {return pointerOperation+":"+window.ToInt64()+":"+WindowOwner(window);}
  static void RememberPointerOrigin(IntPtr window) {
    Rect bounds;if(window==IntPtr.Zero || !GetWindowRect(window,out bounds))return;
    if(pointerOrigins.Count>10000)pointerOrigins.Clear();
    pointerOrigins[PointerOriginKey(window)]=bounds;
  }
  static ControlPoint HomePointerPoint(IntPtr window,ControlPoint point,Dictionary<string,object> result) {
    Rect origin,current;if(pointerOrigins.TryGetValue(PointerOriginKey(window),out origin) && GetWindowRect(window,out current)) {
      int dx=current.Left-origin.Left,dy=current.Top-origin.Top;
      if(dx!=0 || dy!=0) {point.X=checked(point.X+dx);point.Y=checked(point.Y+dy);result["homed"]=new Dictionary<string,object>{{"dx",dx},{"dy",dy}};}
    }
    return point;
  }
  static Process pointerListener;
  static IntPtr PointerWindowAt(ControlPoint point,int helperProcess) {
    IntPtr hit=WindowFromPoint(point);
    if(helperProcess<=0 || hit==IntPtr.Zero || WindowOwner(hit)!=(uint)helperProcess)return hit;
    // Do not trust transparent styles alone: explicitly skip only our verified
    // listener process if Windows reports its disabled overlay at the point.
    IntPtr underneath=IntPtr.Zero;
    EnumWindows(delegate(IntPtr candidate,IntPtr unused) {
      if(WindowOwner(candidate)==(uint)helperProcess || !IsWindowVisible(candidate) || !IsWindowEnabled(candidate) || IsIconic(candidate))return true;
      Rect bounds;if(!GetWindowRect(candidate,out bounds))return true;
      if(point.X>=bounds.Left && point.X<bounds.Right && point.Y>=bounds.Top && point.Y<bounds.Bottom){underneath=candidate;return false;}
      return true;
    },IntPtr.Zero);
    return underneath;
  }
  static void PointerCheck(EventWaitHandle cancel,IntPtr window,uint owner,ControlPoint point,bool foreground,bool requireForeground=true) {
    if(pointerListener==null || pointerListener.HasExited)throw new InvalidOperationException("STOP_LISTENER_UNAVAILABLE: listener exited; stop input");
    if(cancel.WaitOne(0))throw new InvalidOperationException("COMPUTER_USE_STOPPED");
    if(!IsWindow(window) || WindowOwner(window)!=owner || !IsWindowEnabled(window) || !IsWindowVisible(window) || IsIconic(window))throw new InvalidOperationException("TARGET_IDENTITY_CHANGED: intended window is unavailable");
    if(foreground && requireForeground && GetForegroundWindow()!=window)throw new InvalidOperationException("TARGET_FOREGROUND_CHANGED: user or another application changed foreground");
    Rect bounds;if(!GetWindowRect(window,out bounds) || point.X<bounds.Left || point.X>=bounds.Right || point.Y<bounds.Top || point.Y>=bounds.Bottom)throw new InvalidOperationException("POINT_OUTSIDE_TARGET");
    if(!foreground)return;
    IntPtr hit=PointerWindowAt(point,pointerListener.Id);
    // Same-process overlapping windows are still occlusion: check root identity.
    if(hit==IntPtr.Zero || GetAncestor(hit,2)!=window || WindowOwner(hit)!=owner)throw new InvalidOperationException("POINT_OCCLUDED: point is covered by another window");
  }
  static ControlPoint PointerLocation(Dictionary<string,object> args,AutomationElement element) {
    if(args.ContainsKey("x") && args.ContainsKey("y"))return new ControlPoint {X=NumberOption(args,"x",0),Y=NumberOption(args,"y",0)};
    System.Windows.Rect bounds=element.Current.BoundingRectangle;
    if(bounds.IsEmpty || element.Current.IsOffscreen)throw new InvalidOperationException("ELEMENT_NOT_VISIBLE: no usable on-screen element bounds");
    return new ControlPoint {X=(int)(bounds.Left+bounds.Width/2),Y=(int)(bounds.Top+bounds.Height/2)};
  }
  [DllImport("user32.dll")] static extern bool ScreenToClient(IntPtr window,ref ControlPoint point);
  [DllImport("user32.dll")] static extern IntPtr ChildWindowFromPointEx(IntPtr parent,ControlPoint point,uint flags);
  static bool BackgroundPointer(string action,Dictionary<string,object> args,AutomationElement element,IntPtr window,Dictionary<string,object> result) {
    ControlPoint screen=PointerLocation(args,element),client=screen;
    if(element==null)screen=HomePointerPoint(window,screen,result);
    Rect bounds;if(!GetWindowRect(window,out bounds) || screen.X<bounds.Left || screen.X>=bounds.Right || screen.Y<bounds.Top || screen.Y>=bounds.Bottom)throw new InvalidOperationException("POINT_OUTSIDE_TARGET");
    IntPtr recipient=element==null?window:new IntPtr(element.Current.NativeWindowHandle);
    if(recipient==IntPtr.Zero)return false;
    if(element==null) {
      for(int level=0;level<64;level++) {client=screen;if(!ScreenToClient(recipient,ref client))return false;IntPtr child=ChildWindowFromPointEx(recipient,client,3);if(child==IntPtr.Zero || child==recipient)break;recipient=child;}
    }
    if(WindowOwner(recipient)!=WindowOwner(window) || GetAncestor(recipient,2)!=window)throw new InvalidOperationException("ELEMENT_WRONG_OWNER");
    client=screen;if(!ScreenToClient(recipient,ref client) || client.X<0 || client.Y<0 || client.X>32767 || client.Y>32767)return false;
    string button=TextOption(args,"button","left");uint down=button=="right"?0x204U:button=="middle"?0x207U:0x201U;
    uint key=button=="right"?2U:button=="middle"?16U:1U;
    IntPtr packed=new IntPtr((client.Y<<16)|(client.X & 65535));
    int count=action=="double_click"?2:1;
    for(int i=0;i<count;i++) {
      if(!IsWindow(window) || !IsWindow(recipient) || WindowOwner(recipient)!=WindowOwner(window))throw new InvalidOperationException("TARGET_IDENTITY_CHANGED");
      if(!ControlPost(recipient,i==0?down:down+2,new IntPtr(key),packed) || !ControlPost(recipient,down+1,IntPtr.Zero,packed))throw new InvalidOperationException("BACKGROUND_DISPATCH_UNCONFIRMED: partial message delivery; observe before retrying");
    }
    result["method"]="background_messages";result["verification"]="unconfirmed";result["verificationNote"]="Messages posted; recipient processing and effects are unverified.";return true;
  }
  static object ExecutePointer(string action,Dictionary<string,object> args) {
    Dictionary<string,object> result=Result(true,action);result["cleanupConfirmed"]=true;
    IntPtr window=IntPtr.Zero,before=GetForegroundWindow();uint owner=0;
    ControlPoint original;GetCursorPos(out original);ControlPoint last=original;
    bool moved=false,held=false,releaseFailed=false,activated=false;uint up=4;
    AutomationElement element=null;HashSet<long> popups=new HashSet<long>();
    EventWaitHandle cancel=null;
    try {
      // Resolve without activation: validate identity and point before any takeover.
      Dictionary<string,object> quiet=new Dictionary<string,object>(args);quiet["activate"]=false;
      if(args.ContainsKey("elementId"))element=ResolveObservedElement(TextOption(args,"elementId",""),quiet,out window);
      else if(!args.ContainsKey("nativeWindowHandle") && !args.ContainsKey("processId") && !args.ContainsKey("windowTitle")) {
        ControlPoint first;
        if(action=="drag") {Dictionary<string,object> p=(Dictionary<string,object>)((IList)args["path"])[0];first=new ControlPoint {X=Convert.ToInt32(p["x"]),Y=Convert.ToInt32(p["y"])};}
        else first=new ControlPoint {X=NumberOption(args,"x",0),Y=NumberOption(args,"y",0)};
        window=GetAncestor(PointerWindowAt(first,NumberOption(args,"_stopProcessId",0)),2);
        if(window==IntPtr.Zero)throw new InvalidOperationException("TARGET_NOT_FOUND: no window at point");
      } else window=ResolveObservationWindow(quiet);
      owner=WindowOwner(window);popups=ControlPopups(owner,window);
      string button=TextOption(args,"button","left"),dispatch=TextOption(args,"dispatch","auto");
      if(action=="click" || action=="double_click" || action=="drag")ForgetTextFocus();
      if(element!=null && !element.Current.IsEnabled)throw new InvalidOperationException("ELEMENT_DISABLED");
      bool useBackground=dispatch=="background" || (action=="click" && element!=null && button=="left" && dispatch=="auto" && !Option(args,"activate",false));
      if(useBackground && element!=null) {
        if(action=="click" && button=="left") {
          Dictionary<string,object> controlArgs=new Dictionary<string,object>(args);controlArgs["fallbackClick"]=true;
          Dictionary<string,object> background=(Dictionary<string,object>)ExecuteControl("invoke",controlArgs);
          if(Convert.ToBoolean(background["ok"]) || !background.ContainsKey("inputRequired")) {background["action"]=action;background["cleanupConfirmed"]=true;if(Convert.ToBoolean(background["ok"])) {background["inputTargetHandle"]=window.ToInt64();background["inputTargetProcessId"]=owner;}return background;}
        }
        if(BackgroundPointer(action,args,element,window,result)) {result["inputTargetHandle"]=window.ToInt64();result["inputTargetProcessId"]=owner;return result;}
        if(dispatch=="background")throw new InvalidOperationException("UNSUPPORTED_BACKGROUND_DISPATCH: no safe background handler; physical fallback forbidden");
      } else if(useBackground) {
        if(BackgroundPointer(action,args,element,window,result)) {result["inputTargetHandle"]=window.ToInt64();result["inputTargetProcessId"]=owner;return result;}
        throw new InvalidOperationException("UNSUPPORTED_BACKGROUND_DISPATCH");
      }
      // The listener's named event must already exist. Never create an unobserved stop event.
      if(TextOption(args,"_cancelEvent","").Length==0)throw new InvalidOperationException("WCU_NEEDS_INPUT: independent stop lease required before foreground input");
      pointerListener=Process.GetProcessById(NumberOption(args,"_stopProcessId",0));
      IntPtr listenerHandle=pointerListener.Handle; // retain process identity against PID reuse
      cancel=EventWaitHandle.OpenExisting(TextOption(args,"_cancelEvent",""));
      if(cancel.WaitOne(0))throw new InvalidOperationException("COMPUTER_USE_STOPPED");
      foreach(int key in new int[]{1,2,4,16,17,18,91,92})if(GetAsyncKeyState(key)<0)throw new InvalidOperationException("USER_INPUT_ACTIVE: a mouse button or modifier is already held");
      List<ControlPoint> path=new List<ControlPoint>();
      if(action=="drag")foreach(Dictionary<string,object> p in (IEnumerable)args["path"])path.Add(new ControlPoint {X=Convert.ToInt32(p["x"]),Y=Convert.ToInt32(p["y"])});
      else path.Add(PointerLocation(args,element));
      if(element==null)for(int i=0;i<path.Count;i++)path[i]=HomePointerPoint(window,path[i],result);
      // Only the starting point belongs to the source. Cross-window drop paths
      // are valid; never reinterpret later points as source-window controls.
      foreach(ControlPoint p in path) {
        long left=GetSystemMetrics(76),top=GetSystemMetrics(77);
        if(p.X<left || p.Y<top || p.X>=left+GetSystemMetrics(78) || p.Y>=top+GetSystemMetrics(79))throw new InvalidOperationException("POINT_OUTSIDE_DESKTOP");
      }
      PointerCheck(cancel,window,owner,path[0],false);
      if(GetForegroundWindow()!=window && (action!="move" || Option(args,"activate",false))) {
        if(!SetForegroundWindow(window) || GetForegroundWindow()!=window)throw new InvalidOperationException("TARGET_ACTIVATION_REFUSED");
        activated=true;
      }
      uint down=button=="right"?8U:button=="middle"?32U:2U;up=button=="right"?16U:button=="middle"?64U:4U;
      int repetitions=action=="double_click"?2:1;
      for(int iteration=0;iteration<repetitions;iteration++) {
        for(int i=0;i<path.Count;i++) {
          ControlPoint p=path[i],current;GetCursorPos(out current);
          if(moved && (current.X!=last.X || current.Y!=last.Y))throw new InvalidOperationException("USER_INPUT_CHANGED: pointer moved during automation");
          if(action=="drag" && i>0) {
            if(cancel.WaitOne(0) || pointerListener.HasExited)throw new InvalidOperationException("COMPUTER_USE_STOPPED");
            if(!IsWindow(window) || WindowOwner(window)!=owner || GetForegroundWindow()!=window)throw new InvalidOperationException("TARGET_IDENTITY_CHANGED: source or foreground changed during drag");
          } else PointerCheck(cancel,window,owner,p,true,action!="move" || Option(args,"activate",false));
          NotifyPhysicalInput(true);
          if(!SetCursorPos(p.X,p.Y))throw new InvalidOperationException("POINTER_MOVE_FAILED");
          moved=true;last=p;
          if(action=="drag" && i>0) {
            if(cancel.WaitOne(0) || pointerListener.HasExited)throw new InvalidOperationException("COMPUTER_USE_STOPPED");
            if(!IsWindow(window) || WindowOwner(window)!=owner || GetForegroundWindow()!=window)throw new InvalidOperationException("TARGET_IDENTITY_CHANGED: source or foreground changed during drag");
          } else PointerCheck(cancel,window,owner,p,true,action!="move" || Option(args,"activate",false));
          if(action=="click" || action=="double_click" || (action=="drag" && i==0)) {
            // Set held before the down attempt: uncertain dispatch still requires an up.
            held=true;PointerSend(down,0);
            if(cancel.WaitOne(0))throw new InvalidOperationException("COMPUTER_USE_STOPPED");
          }
          if(action=="click" || action=="double_click") {PointerSend(up,0);held=false;}
          if(action=="scroll") {int y=NumberOption(args,"deltaY",480),x=NumberOption(args,"deltaX",0);if(y!=0)PointerSend(0x800,-y);if(x!=0){PointerCheck(cancel,window,owner,p,true,action!="move" || Option(args,"activate",false));PointerSend(0x1000,x);}}
          if(action=="drag" && i<path.Count-1 && cancel.WaitOne(10))throw new InvalidOperationException("COMPUTER_USE_STOPPED");
        }
        if(iteration+1<repetitions && cancel.WaitOne((int)Math.Min(50,GetDoubleClickTime()/4)))throw new InvalidOperationException("COMPUTER_USE_STOPPED");
      }
      result["method"]="guarded_pointer";result["verification"]="sent";
      result["inputTargetHandle"]=window.ToInt64();result["inputTargetProcessId"]=owner;
    } catch(Exception error) {result["ok"]=false;result["error"]=(error is ElementNotAvailableException || error.HResult==unchecked((int)0x80040201))?"STALE_ELEMENT: control disappeared; observe again":error.Message;if(error.Message.StartsWith("WCU_NEEDS_INPUT",StringComparison.Ordinal))result["inputRequired"]=true;}
    finally {
      if(held)try {PointerSend(up,0);held=false;}catch(Exception error){releaseFailed=true;result["ok"]=false;result["error"]="INPUT_CLEANUP_UNCONFIRMED: "+error.Message;}
      result["cleanupConfirmed"]=!releaseFailed;
      if(cancel!=null)cancel.Dispose();
      if(pointerListener!=null){pointerListener.Dispose();pointerListener=null;}
      ControlPoint now;bool same=GetCursorPos(out now) && now.X==last.X && now.Y==last.Y;
      uint ignored;uint thread=GetWindowThreadProcessId(window,out ignored);ControlGuiInfo info=new ControlGuiInfo {Size=(uint)Marshal.SizeOf(typeof(ControlGuiInfo))};
      HashSet<long> opened=window==IntPtr.Zero?new HashSet<long>():ControlPopups(owner,window);opened.ExceptWith(popups);
      bool popup=opened.Count>0 || (thread!=0 && GetGUIThreadInfo(thread,ref info) && (info.Flags & 0x1C)!=0);
      if(moved && action!="move" && same && !popup)result["pointer"]=SetCursorPos(original.X,original.Y)?"returned":"restoration refused";
      else result["pointer"]=action=="move" && moved?"kept: requested hover":moved?"left: user moved pointer or action opened a popup":"unchanged";
      if(activated && !Option(args,"activate",false) && GetForegroundWindow()==window && same && !popup && IsWindow(before))result["foreground"]=SetForegroundWindow(before)?"returned":"restoration refused";
      else result["foreground"]=activated?"kept: requested, user changed focus, or popup opened":"unchanged";
      if(!releaseFailed)NotifyPhysicalInput(false);
    }
    return result;
  }
}
