using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Runtime.InteropServices;
using System.Windows.Automation;

partial class WindowsBridge {
  [StructLayout(LayoutKind.Sequential)] struct ControlPoint { public int X,Y; }
  [StructLayout(LayoutKind.Sequential)] struct ControlGuiInfo { public uint Size,Flags; public IntPtr Active,Focus,Capture,MenuOwner,MoveSize,Caret; public Rect CaretRect; }
  [DllImport("user32.dll")] static extern bool GetCursorPos(out ControlPoint point);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")] static extern IntPtr ControlStyle(IntPtr window,int index);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr window,uint command);
  [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread,ref ControlGuiInfo info);
  [DllImport("user32.dll",EntryPoint="PostMessageW",SetLastError=true)] static extern bool ControlPost(IntPtr window,uint message,IntPtr wParam,IntPtr lParam);
  [DllImport("user32.dll",EntryPoint="SendMessageTimeoutW",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr ControlText(IntPtr window,uint message,UIntPtr wParam,string text,uint flags,uint timeout,out UIntPtr result);
  [DllImport("user32.dll")] static extern int GetScrollPos(IntPtr window,int bar);

  // Shared in-process observer: never calls UIA and never captures text.
  // Only our tagged SendInput and exactly expected SetCursorPos moves are
  // excluded; physical and foreign injected input both invalidate restoration.
  static readonly UIntPtr OwnedInputMarker=new UIntPtr(0x50494355);
  sealed class InteractionGuard {
    delegate IntPtr Hook(int code,IntPtr message,IntPtr data);
    [StructLayout(LayoutKind.Sequential)] struct Mouse {public ControlPoint Point;public uint Data,Flags,Time;public UIntPtr Extra;}
    [StructLayout(LayoutKind.Sequential)] struct Key {public uint Code,Scan,Flags,Time;public UIntPtr Extra;}
    [StructLayout(LayoutKind.Sequential)] struct Message {public IntPtr Window;public uint Id;public UIntPtr W;public IntPtr L;public uint Time;public ControlPoint Point;public uint Private;}
    [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SetWindowsHookEx(int kind,Hook callback,IntPtr module,uint thread);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook,int code,IntPtr message,IntPtr data);
    [DllImport("user32.dll")] static extern int GetMessage(out Message message,IntPtr window,uint first,uint last);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref Message message);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref Message message);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
    sealed class ExpectedMove {public int X,Y;public long Until;}
    static readonly object gate=new object();
    static readonly Queue<ExpectedMove> expected=new Queue<ExpectedMove>();
    static readonly ManualResetEvent ready=new ManualResetEvent(false);
    static readonly Hook mouseCallback=OnMouse,keyCallback=OnKey;
    static bool started;static volatile bool available;static long activity;
    readonly long baseline;
    static IntPtr OnMouse(int code,IntPtr message,IntPtr data) {
      if(code>=0) {
        Mouse input=(Mouse)Marshal.PtrToStructure(data,typeof(Mouse));bool ours=(input.Flags & 1)!=0 && input.Extra==OwnedInputMarker;
        if(!ours && message.ToInt64()==0x200)lock(gate) {
          long now=Stopwatch.GetTimestamp();while(expected.Count>0 && expected.Peek().Until<now)expected.Dequeue();
          ExpectedMove[] moves=expected.ToArray();for(int i=0;i<moves.Length;i++)if(moves[i].X==input.Point.X && moves[i].Y==input.Point.Y){for(int remove=0;remove<=i;remove++)expected.Dequeue();ours=true;break;}
        }
        if(!ours)Interlocked.Increment(ref activity);
      }
      return CallNextHookEx(IntPtr.Zero,code,message,data);
    }
    static IntPtr OnKey(int code,IntPtr message,IntPtr data) {
      if(code>=0){Key input=(Key)Marshal.PtrToStructure(data,typeof(Key));if((input.Flags & 0x10)==0 || input.Extra!=OwnedInputMarker)Interlocked.Increment(ref activity);}
      return CallNextHookEx(IntPtr.Zero,code,message,data);
    }
    static void Ensure() {
      lock(gate)if(!started){started=true;Thread thread=new Thread(delegate(){
        IntPtr mouse=SetWindowsHookEx(14,mouseCallback,GetModuleHandle(null),0),key=SetWindowsHookEx(13,keyCallback,GetModuleHandle(null),0);
        available=mouse!=IntPtr.Zero && key!=IntPtr.Zero;ready.Set();
        try {if(available){Message message;while(GetMessage(out message,IntPtr.Zero,0,0)>0){TranslateMessage(ref message);DispatchMessage(ref message);}}}
        finally {available=false;if(mouse!=IntPtr.Zero)UnhookWindowsHookEx(mouse);if(key!=IntPtr.Zero)UnhookWindowsHookEx(key);}
      });thread.IsBackground=true;thread.Start();}
      if(!ready.WaitOne(1000) || !available)throw new InvalidOperationException("USER_ACTIVITY_OBSERVER_UNAVAILABLE: no input sent");
    }
    public InteractionGuard(){Ensure();baseline=Interlocked.Read(ref activity);}
    public bool Undisturbed {get {return available && baseline==Interlocked.Read(ref activity);}}
    public void Check(){if(!Undisturbed)throw new InvalidOperationException("USER_INPUT_CHANGED: intervening input stopped automation");}
    public static bool Move(int x,int y) {
      lock(gate)expected.Enqueue(new ExpectedMove{X=x,Y=y,Until=Stopwatch.GetTimestamp()+Stopwatch.Frequency/10});
      return SetCursorPos(x,y);
    }
  }

  static HashSet<long> ControlPopups(uint owner,IntPtr target) {
    HashSet<long> found=new HashSet<long>();
    EnumWindows(delegate(IntPtr window,IntPtr ignored) { if(window!=target && IsWindowVisible(window) && WindowOwner(window)==owner && (GetWindow(window,4)!=IntPtr.Zero || (ControlStyle(window,-16).ToInt64() & 0x80000000L)!=0))found.Add(window.ToInt64());return true; },IntPtr.Zero);
    return found;
  }
  static void RestoreControlState(Dictionary<string,object> result,IntPtr before,ControlPoint pointer,IntPtr window,HashSet<long> popups,bool keep,InteractionGuard interaction) {
    ControlPoint now;
    result["pointer"]=GetCursorPos(out now) && now.X==pointer.X && now.Y==pointer.Y?"unchanged":"left: movement was not proven to be ours";
    IntPtr after=GetForegroundWindow();
    if(after==before){result["foreground"]="unchanged";return;}
    if(window==IntPtr.Zero || after!=window){result["foreground"]="left: another window is in front";return;}
    if(keep){result["foreground"]="kept (activate:true)";return;}
    if(interaction==null || !interaction.Undisturbed){result["foreground"]="left: user activity or unavailable movement evidence";return;}
    uint ignoredOwner;uint thread=GetWindowThreadProcessId(window,out ignoredOwner);
    ControlGuiInfo info=new ControlGuiInfo {Size=(uint)Marshal.SizeOf(typeof(ControlGuiInfo))};
    bool menu=GetGUIThreadInfo(thread,ref info) && (info.Flags & 0x1C)!=0;
    HashSet<long> opened=ControlPopups(WindowOwner(window),window);opened.ExceptWith(popups);
    if(menu || opened.Count>0){result["foreground"]="kept: action opened menu or dialog";return;}
    if(before!=IntPtr.Zero && IsWindow(before) && interaction.Undisturbed && SetForegroundWindow(before))result["foreground"]="returned (provider activated intended target)";
    else result["foreground"]="kept: restoration refused or prior window disappeared";
  }
  static bool NativeButton(AutomationElement element) {
    IntPtr handle=new IntPtr(element.Current.NativeWindowHandle);if(handle==IntPtr.Zero)return false;
    string name=element.Current.ClassName;
    bool button=element.Current.ControlType==ControlType.Button || element.Current.ControlType==ControlType.CheckBox || element.Current.ControlType==ControlType.RadioButton;
    if(!button || !(name.Equals("Button",StringComparison.OrdinalIgnoreCase) || name.StartsWith("WindowsForms10.BUTTON",StringComparison.OrdinalIgnoreCase)))return false;
    if(!ControlPost(handle,0xF5,IntPtr.Zero,IntPtr.Zero))throw new InvalidOperationException("NATIVE_DISPATCH_FAILED: button message was refused");
    UIntPtr ignored;SendMessageTimeout(handle,0,UIntPtr.Zero,IntPtr.Zero,2,500,out ignored);return true;
  }
  static bool NativeValue(AutomationElement element,string value) {
    IntPtr handle=new IntPtr(element.Current.NativeWindowHandle);if(handle==IntPtr.Zero || element.Current.ControlType!=ControlType.Edit)return false;
    string name=element.Current.ClassName;
    if(!(name.Equals("Edit",StringComparison.OrdinalIgnoreCase) || name.StartsWith("WindowsForms10.EDIT",StringComparison.OrdinalIgnoreCase) || name.StartsWith("RichEdit",StringComparison.OrdinalIgnoreCase)))return false;
    if((ControlStyle(handle,-16).ToInt64() & 0x800)!=0)throw new InvalidOperationException("READ_ONLY: control does not accept value changes");
    UIntPtr ignored;
    if(SendMessageTimeout(handle,0xB1,UIntPtr.Zero,new IntPtr(-1),2,500,out ignored)==IntPtr.Zero || ControlText(handle,0xC2,new UIntPtr(1),value,2,1000,out ignored)==IntPtr.Zero)throw new InvalidOperationException("NATIVE_DISPATCH_FAILED: edit message was not confirmed");
    return true;
  }
  static Dictionary<string,object> ScrollPosition(IntPtr handle) {return new Dictionary<string,object>{{"vertical",GetScrollPos(handle,1)},{"horizontal",GetScrollPos(handle,0)}};}
  static int ScrollSteps(int delta) {return (int)Math.Max(1,((long)Math.Abs((long)delta)+119)/120);}
  static bool NativeScroll(AutomationElement element,int x,int y,Dictionary<string,object> result) {
    IntPtr handle=new IntPtr(element.Current.NativeWindowHandle);if(handle==IntPtr.Zero)return false;
    long style=ControlStyle(handle,-16).ToInt64();
    if((y!=0 && (style & 0x200000)==0) || (x!=0 && (style & 0x100000)==0))return false;
    result["before"]=ScrollPosition(handle);
    foreach(int axis in new int[]{0,1}) {
      int delta=axis==0?x:y;if(delta==0)continue;
      for(int step=0;step<ScrollSteps(delta);step++) { UIntPtr dispatched;if(SendMessageTimeout(handle,axis==0?0x114U:0x115U,new UIntPtr(delta>0?1U:0U),IntPtr.Zero,2,500,out dispatched)==IntPtr.Zero)throw new InvalidOperationException("NATIVE_DISPATCH_UNCONFIRMED: scroll handler did not complete; observe before retrying"); }
    }
    UIntPtr ignored;SendMessageTimeout(handle,0,UIntPtr.Zero,IntPtr.Zero,2,500,out ignored);
    result["after"]=ScrollPosition(handle);result["method"]="native_scroll";return true;
  }
  static void ControlScroll(AutomationElement element,IntPtr window,int x,int y,Dictionary<string,object> result) {
    AutomationElement candidate=element;
    for(int level=0;candidate!=null && level<64;level++) {
      if(candidate.Current.ProcessId!=(int)WindowOwner(window))break;
      if(NativeScroll(candidate,x,y,result))return;
      object raw;
      if(candidate.TryGetCurrentPattern(ScrollPattern.Pattern,out raw)) {
        ScrollPattern scroll=(ScrollPattern)raw;
        if((x==0 || scroll.Current.HorizontallyScrollable) && (y==0 || scroll.Current.VerticallyScrollable)) {
          result["before"]=new Dictionary<string,object>{{"vertical",scroll.Current.VerticalScrollPercent},{"horizontal",scroll.Current.HorizontalScrollPercent}};
          int count=Math.Max(x==0?0:ScrollSteps(x),y==0?0:ScrollSteps(y));
          for(int step=0;step<count;step++)scroll.Scroll(x!=0 && step<ScrollSteps(x)?(x>0?ScrollAmount.SmallIncrement:ScrollAmount.SmallDecrement):ScrollAmount.NoAmount,y!=0 && step<ScrollSteps(y)?(y>0?ScrollAmount.SmallIncrement:ScrollAmount.SmallDecrement):ScrollAmount.NoAmount);
          result["after"]=new Dictionary<string,object>{{"vertical",scroll.Current.VerticalScrollPercent},{"horizontal",scroll.Current.HorizontalScrollPercent}};result["method"]="uia_scroll";return;
        }
      }
      candidate=TreeWalker.ControlViewWalker.GetParent(candidate);
    }
    throw new InvalidOperationException("WCU_NEEDS_INPUT: no background scrolling pattern is available");
  }
  static object ExecuteControl(string action,Dictionary<string,object> args) {
    Dictionary<string,object> result=Result(true,action);
    IntPtr before=IntPtr.Zero,window=IntPtr.Zero;ControlPoint pointer=new ControlPoint();
    AutomationElement element=null;HashSet<long> popups=new HashSet<long>();InteractionGuard interaction=null;
    try {
      interaction=new InteractionGuard();before=GetForegroundWindow();GetCursorPos(out pointer);
      PruneElements();element=ResolveObservedElement(TextOption(args,"elementId",""),args,out window);popups=ControlPopups(WindowOwner(window),window);
      if(!element.Current.IsEnabled)throw new InvalidOperationException("ELEMENT_DISABLED: control is disabled");
      object raw;
      if(action=="focus") {ForgetTextFocus();element.SetFocus();RememberTextFocus(window,new IntPtr(element.Current.NativeWindowHandle));result["method"]="uia_focus";}
      else if(action=="set_value") {
        if(element.TryGetCurrentPattern(ValuePattern.Pattern,out raw) && ((ValuePattern)raw).Current.IsReadOnly)throw new InvalidOperationException("READ_ONLY: control does not accept value changes");
        if(NativeValue(element,TextOption(args,"value","")))result["method"]="native_edit";
        else if(element.TryGetCurrentPattern(ValuePattern.Pattern,out raw)) {((ValuePattern)raw).SetValue(TextOption(args,"value",""));result["method"]="uia_value";}
        else throw new InvalidOperationException(Option(args,"fallbackType",true)?"WCU_NEEDS_INPUT: value pattern unavailable; guarded typing required":"UNSUPPORTED_PATTERN: value pattern unavailable");
      } else if(action=="scroll") ControlScroll(element,window,NumberOption(args,"deltaX",0),NumberOption(args,"deltaY",480),result);
      else {
        string requested=TextOption(args,"action","default");
        if(requested=="scroll_into_view") {if(!element.TryGetCurrentPattern(ScrollItemPattern.Pattern,out raw))throw new InvalidOperationException("UNSUPPORTED_PATTERN: ScrollItem unavailable");((ScrollItemPattern)raw).ScrollIntoView();result["method"]="uia_scroll_into_view";}
        else if(requested=="expand" || requested=="collapse") {if(!element.TryGetCurrentPattern(ExpandCollapsePattern.Pattern,out raw))throw new InvalidOperationException("UNSUPPORTED_PATTERN: ExpandCollapse unavailable");ExpandCollapsePattern expand=(ExpandCollapsePattern)raw;ExpandCollapseState desired=requested=="expand"?ExpandCollapseState.Expanded:ExpandCollapseState.Collapsed;if(expand.Current.ExpandCollapseState!=desired){if(requested=="expand")expand.Expand();else expand.Collapse();}result["method"]="uia_"+requested;}
        else if(NativeButton(element))result["method"]="native_button";
        else if(element.TryGetCurrentPattern(InvokePattern.Pattern,out raw)){((InvokePattern)raw).Invoke();result["method"]="uia_invoke";}
        else if(element.TryGetCurrentPattern(TogglePattern.Pattern,out raw)){((TogglePattern)raw).Toggle();result["method"]="uia_toggle";}
        else if(element.TryGetCurrentPattern(SelectionItemPattern.Pattern,out raw)){((SelectionItemPattern)raw).Select();result["method"]="uia_select";}
        else if(element.TryGetCurrentPattern(ExpandCollapsePattern.Pattern,out raw)){((ExpandCollapsePattern)raw).Expand();result["method"]="uia_expand";}
        else {
          // A semantic invoke is not permission to bypass a read-only control.
          // The pointer click path has no semantic action option and can still
          // select/focus read-only text with its ordinary click contract.
          if(args.ContainsKey("action") && element.TryGetCurrentPattern(ValuePattern.Pattern,out raw) && ((ValuePattern)raw).Current.IsReadOnly)throw new InvalidOperationException("READ_ONLY: semantic invoke cannot escalate on a read-only control");
          throw new InvalidOperationException(Option(args,"fallbackClick",true)?"WCU_NEEDS_INPUT: no supported background action; guarded click required":"UNSUPPORTED_PATTERN: no supported background action");
        }
      }
      result["inputTargetHandle"]=window.ToInt64();result["inputTargetProcessId"]=WindowOwner(window);
      result["verification"]="sent";result["verificationNote"]="Action dispatched; use a fresh observation or explicit wait to verify its effect.";
    } catch(Exception error) {
      result["ok"]=false;
      if(error is ElementNotAvailableException || error.HResult==unchecked((int)0x80040201)) {observed.Remove(TextOption(args,"elementId",""));result["error"]="STALE_ELEMENT: control disappeared; observe again";}
      else result["error"]=error.Message;
      if(error.Message.StartsWith("WCU_NEEDS_INPUT",StringComparison.Ordinal))result["inputRequired"]=true;
    }
    finally {RestoreControlState(result,before,pointer,window,popups,Option(args,"activate",false),interaction);}
    return result;
  }
}
