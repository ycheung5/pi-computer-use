using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Automation;

partial class WindowsBridge {
  [StructLayout(LayoutKind.Sequential)] struct KeyboardInput {public ushort Key,Scan;public uint Flags,Time;public UIntPtr Extra;}
  sealed class HeldKey {public ushort Key,Scan;public uint Flags;}
  [DllImport("user32.dll")] static extern IntPtr GetKeyboardLayout(uint thread);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern short VkKeyScanEx(char value,IntPtr layout);
  [DllImport("user32.dll",EntryPoint="SendMessageTimeoutW",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr ReadEditText(IntPtr window,uint message,UIntPtr count,StringBuilder text,uint flags,uint timeout,out UIntPtr result);
  [StructLayout(LayoutKind.Sequential)] struct LastTextInput {public uint Size,Tick;}
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LastTextInput info);
  sealed class KnownTextFocus {public IntPtr Handle;public uint InputTick;}
  static uint LastTextTick() {LastTextInput info=new LastTextInput{Size=(uint)Marshal.SizeOf(typeof(LastTextInput))};if(!GetLastInputInfo(ref info))throw new InvalidOperationException("TARGET_FOCUS_UNKNOWN: cannot verify user input history");return info.Tick;}
  static readonly Dictionary<string,KnownTextFocus> textFocus=new Dictionary<string,KnownTextFocus>();
  static void ForgetTextFocus() {textFocus.Clear();}
  static void RememberTextFocus(IntPtr window,IntPtr focus) {if(focus!=IntPtr.Zero && IsWindow(focus) && GetAncestor(focus,2)==window && WindowOwner(focus)==WindowOwner(window)){textFocus.Clear();textFocus[PointerOriginKey(window)]=new KnownTextFocus {Handle=focus,InputTick=LastTextTick()};}}
  static IntPtr TextFocus(IntPtr window,bool allowRemembered=true) {
    uint owner;uint thread=GetWindowThreadProcessId(window,out owner);ControlGuiInfo info=new ControlGuiInfo{Size=(uint)Marshal.SizeOf(typeof(ControlGuiInfo))};
    if(GetGUIThreadInfo(thread,ref info) && info.Focus!=IntPtr.Zero && GetAncestor(info.Focus,2)==window && WindowOwner(info.Focus)==owner){KnownTextFocus known;if(textFocus.TryGetValue(PointerOriginKey(window),out known) && known.Handle!=info.Focus)textFocus.Remove(PointerOriginKey(window));return info.Focus;}
    KnownTextFocus remembered;
    if(allowRemembered && textFocus.TryGetValue(PointerOriginKey(window),out remembered)) {
      if(remembered.InputTick!=LastTextTick()){textFocus.Remove(PointerOriginKey(window));throw new InvalidOperationException("TARGET_FOCUS_CHANGED: user input invalidated remembered focus; focus the intended control again");}
      if(IsWindow(remembered.Handle) && GetAncestor(remembered.Handle,2)==window && WindowOwner(remembered.Handle)==owner)return remembered.Handle;
      textFocus.Remove(PointerOriginKey(window));throw new InvalidOperationException("TARGET_FOCUS_CHANGED: remembered native control is stale");
    }
    return IntPtr.Zero;
  }
  static bool IsNativeText(IntPtr focus) {
    if(focus==IntPtr.Zero)return false;StringBuilder name=new StringBuilder(256);GetClassName(focus,name,name.Capacity);string value=name.ToString();
    return value.Equals("Edit",StringComparison.OrdinalIgnoreCase) || value.StartsWith("WindowsForms10.EDIT",StringComparison.OrdinalIgnoreCase) || value.StartsWith("RichEdit",StringComparison.OrdinalIgnoreCase);
  }
  static string NativeTextValue(IntPtr focus) {
    if((ControlStyle(focus,-16).ToInt64() & 0x20)!=0)return null;
    StringBuilder text=new StringBuilder(201);UIntPtr ignored;
    return ReadEditText(focus,0xD,new UIntPtr(201),text,2,200,out ignored)==IntPtr.Zero?null:text.ToString();
  }
  static void AssertWritableText(IntPtr focus) {
    if(focus!=IntPtr.Zero && (!IsWindowEnabled(focus) || (IsNativeText(focus) && (ControlStyle(focus,-16).ToInt64() & 0x800)!=0)))throw new InvalidOperationException("READ_ONLY: focused control is disabled or read-only");
  }
  static bool BackgroundEdit(IntPtr window,string text,Dictionary<string,object> result) {
    if(text.IndexOf('\r')>=0 || text.IndexOf('\n')>=0)return false;
    IntPtr focus=TextFocus(window);if(!IsNativeText(focus))return false;AssertWritableText(focus);
    UIntPtr before,after,ignored;
    if(SendMessageTimeout(focus,0xE,UIntPtr.Zero,IntPtr.Zero,2,500,out before)==IntPtr.Zero)throw new InvalidOperationException("BACKGROUND_READ_UNCONFIRMED: no text sent");
    // Never retry a refused/uncertain EM_REPLACESEL through physical input.
    if(ControlText(focus,0xC2,new UIntPtr(1),text,2,1000,out ignored)==IntPtr.Zero)throw new InvalidOperationException("TEXT_DISPATCH_UNCONFIRMED: edit may have received partial text; observe before retrying");
    string value=NativeTextValue(focus);bool lengthKnown=SendMessageTimeout(focus,0xE,UIntPtr.Zero,IntPtr.Zero,2,500,out after)!=IntPtr.Zero;
    RememberTextFocus(window,focus);
    result["method"]="background:EM_REPLACESEL";result["verification"]="sent";
    result["verified"]=lengthKnown && ((long)after.ToUInt64()-(long)before.ToUInt64()==text.Length || (value!=null && value.Contains(text)));
    if(value!=null)result["verifyValue"]=value;
    return true;
  }
  static AutomationElement MainTextControl(IntPtr window) {
    AutomationElement root=AutomationElement.FromHandle(window),best=null;double area=-1;
    Condition controls=new OrCondition(new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Edit),new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Document));
    AutomationElementCollection candidates=root.FindAll(TreeScope.Descendants,controls);
    for(int i=0;i<candidates.Count;i++) {
      AutomationElement candidate=candidates[i];var current=candidate.Current;if(!current.IsEnabled || !current.IsKeyboardFocusable || current.IsOffscreen || current.ProcessId!=(int)WindowOwner(window))continue;
      object raw;if(candidate.TryGetCurrentPattern(ValuePattern.Pattern,out raw) && ((ValuePattern)raw).Current.IsReadOnly)continue;
      double size=current.BoundingRectangle.Width*current.BoundingRectangle.Height;if(size>area){area=size;best=candidate;}
    }
    if(best==null)throw new InvalidOperationException("TEXT_FOCUS_NOT_FOUND: no writable main text control");return best;
  }
  static void TextCheck(EventWaitHandle cancel,Process listener,IntPtr window,uint owner,IntPtr expectedFocus,bool checkFocus,InteractionGuard interaction) {
    interaction.Check();
    if(cancel.WaitOne(0))throw new InvalidOperationException("COMPUTER_USE_STOPPED");
    if(listener.HasExited)throw new InvalidOperationException("STOP_LISTENER_UNAVAILABLE");
    if(!IsWindow(window) || WindowOwner(window)!=owner || !IsWindowEnabled(window) || !IsWindowVisible(window) || IsIconic(window))throw new InvalidOperationException("TARGET_IDENTITY_CHANGED");
    if(GetForegroundWindow()!=window)throw new InvalidOperationException("TARGET_FOREGROUND_CHANGED: no more text sent");
    if(checkFocus)foreach(int key in new int[]{1,2,4,16,17,18,91,92})if(GetAsyncKeyState(key)<0)throw new InvalidOperationException("USER_INPUT_ACTIVE: user button or modifier changed during typing");
    if(checkFocus && TextFocus(window,false)!=expectedFocus)throw new InvalidOperationException("TARGET_FOCUS_CHANGED: no more text sent");
  }
  static void KeyEvent(HeldKey key,bool release) {
    if(!release)NotifyPhysicalInput(true);
    PointerInput input=new PointerInput{Type=1,Data=new InputUnion{Keyboard=new KeyboardInput{Key=key.Key,Scan=key.Scan,Flags=key.Flags | (release?2U:0U),Extra=OwnedInputMarker}}};
    if(SendInput(1,new PointerInput[]{input},Marshal.SizeOf(typeof(PointerInput)))!=1)throw new InvalidOperationException("KEY_DISPATCH_UNCONFIRMED: partial input must not be replayed");
  }
  static void Down(List<HeldKey> held,HeldKey key) {held.Add(key);KeyEvent(key,false);}
  static void Up(List<HeldKey> held,HeldKey key) {KeyEvent(key,true);held.Remove(key);}
  static ushort SpecialKey(string key) {
    switch(key){case "enter":case "return":return 13;case "tab":return 9;case "esc":case "escape":return 27;case "backspace":return 8;case "delete":case "del":return 46;case "home":return 36;case "end":return 35;case "pageup":case "pgup":return 33;case "pagedown":case "pgdn":return 34;case "up":return 38;case "down":return 40;case "left":return 37;case "right":return 39;case "space":return 32;case "insert":case "ins":return 45;case "pause":return 19;case "capslock":return 20;case "numlock":return 144;case "scrolllock":return 145;}
    int number;if(key.StartsWith("f") && Int32.TryParse(key.Substring(1),out number) && number>=1 && number<=24)return (ushort)(111+number);return 0;
  }
  static void Chord(IEnumerable values,EventWaitHandle cancel,Process listener,IntPtr window,uint owner,List<HeldKey> held,InteractionGuard interaction) {
    List<ushort> modifiers=new List<ushort>();string main=null;
    foreach(object item in values) {string key=Convert.ToString(item),name=key.Trim().ToLowerInvariant();if(name=="ctrl" || name=="control")modifiers.Add(17);else if(name=="alt" || name=="option")modifiers.Add(18);else if(name=="shift")modifiers.Add(16);else if(name=="win" || name=="windows" || name=="cmd" || name=="meta")throw new InvalidOperationException("KEY_BLOCKED");else if(main!=null)throw new InvalidOperationException("INVALID_ARGUMENTS: exactly one non-modifier key required");else main=key;}
    if(main==null)throw new InvalidOperationException("INVALID_ARGUMENTS: non-modifier key required");
    ushort code=SpecialKey(main.Trim().ToLowerInvariant());
    if(code==0) {
      if(main.Length!=1)throw new InvalidOperationException("INVALID_ARGUMENTS: unsupported key");
      uint ignored;uint thread=GetWindowThreadProcessId(window,out ignored);short mapping=VkKeyScanEx(main[0],GetKeyboardLayout(thread));
      if(mapping==-1) {if(modifiers.Count>0)throw new InvalidOperationException("KEY_LAYOUT_UNSUPPORTED: chord cannot represent this character");TextCheck(cancel,listener,window,owner,IntPtr.Zero,false,interaction);HeldKey unicode=new HeldKey{Scan=main[0],Flags=4};Down(held,unicode);Up(held,unicode);return;}
      code=(ushort)(mapping & 255);
      // A named shortcut letter is layout-mapped without adding implicit Shift.
      if(modifiers.Count==0){if((mapping & 0x100)!=0)modifiers.Add(16);if((mapping & 0x200)!=0)modifiers.Add(17);if((mapping & 0x400)!=0)modifiers.Add(18);}
    }
    foreach(ushort modifier in modifiers){TextCheck(cancel,listener,window,owner,IntPtr.Zero,false,interaction);Down(held,new HeldKey{Key=modifier});}
    TextCheck(cancel,listener,window,owner,IntPtr.Zero,false,interaction);
    HeldKey primary=new HeldKey{Key=code,Flags=(code>=33 && code<=46)?1U:0U};Down(held,primary);Up(held,primary);
    // Release modifiers regardless of target/focus changes caused by the chord.
    for(int i=held.Count-1;i>=0;i--){HeldKey key=held[i];Up(held,key);}
  }
  static Task<string> clipboardRead;
  static Dictionary<string,object> ClipboardReply(Process child,int milliseconds) {
    if(clipboardRead==null)clipboardRead=Task.Factory.StartNew(()=>child.StandardOutput.ReadLine());
    if(!clipboardRead.Wait(milliseconds))throw new InvalidOperationException("CLIPBOARD_HELPER_TIMEOUT");
    string line=clipboardRead.Result;clipboardRead=null;
    if(line==null)throw new InvalidOperationException("CLIPBOARD_HELPER_EXITED");
    return new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(line);
  }
  static void ClipboardPhase(Process child,string expected,int milliseconds) {
    Dictionary<string,object> reply=ClipboardReply(child,milliseconds);
    if(!Convert.ToBoolean(reply["ok"]) || Convert.ToString(reply["phase"])!=expected)throw new InvalidOperationException(Convert.ToString(reply["error"])??"CLIPBOARD_PHASE_FAILED");
  }
  static void ConfirmClipboardRestore(Process child) {
    Stopwatch watch=Stopwatch.StartNew();
    for(int i=0;i<4 && watch.ElapsedMilliseconds<2500;i++) {
      var reply=ClipboardReply(child,Math.Max(1,2500-(int)watch.ElapsedMilliseconds));
      if(Convert.ToString(reply["phase"])=="restored" && Convert.ToBoolean(reply["ok"]))return;
    }
    throw new InvalidOperationException("CLIPBOARD_RESTORE_UNCONFIRMED");
  }
  static object ExecuteText(string action,Dictionary<string,object> args) {
    Dictionary<string,object> result=Result(true,action);result["cleanupConfirmed"]=true;
    IntPtr before=IntPtr.Zero,window=IntPtr.Zero;ControlPoint pointer=new ControlPoint();
    List<HeldKey> held=new List<HeldKey>();HashSet<long> popups=new HashSet<long>();
    EventWaitHandle cancel=null;Process listener=null,clipboard=null;bool clipboardMayChange=false,clipboardReplaced=false;
    InteractionGuard interaction=null;
    AutomationElement main=null;bool cleanup=true;
    try {
      interaction=new InteractionGuard();before=GetForegroundWindow();GetCursorPos(out pointer);
      Dictionary<string,object> quiet=new Dictionary<string,object>(args);quiet["activate"]=false;
      if(args.ContainsKey("_elementId")) {
        main=ResolveObservedElement(TextOption(args,"_elementId",""),quiet,out window);
        if(!main.Current.IsEnabled)throw new InvalidOperationException("ELEMENT_DISABLED");
        object raw;if(main.TryGetCurrentPattern(ValuePattern.Pattern,out raw) && ((ValuePattern)raw).Current.IsReadOnly)throw new InvalidOperationException("READ_ONLY: fallback cannot bypass a read-only value");
      } else window=ResolveObservationWindow(quiet);
      if(textFocus.Count>0 && !textFocus.ContainsKey(PointerOriginKey(window)))ForgetTextFocus();
      uint owner=WindowOwner(window);popups=ControlPopups(owner,window);
      string text=TextOption(args,"text",""),method=TextOption(args,"method","auto");
      if(text.IndexOf('\0')>=0)throw new InvalidOperationException("INVALID_ARGUMENTS: NUL text cannot be entered safely");
      if(action=="type_text" && method=="auto" && TextOption(args,"focusMode","preserve")=="preserve" && !Option(args,"activate",false) && BackgroundEdit(window,text,result)) {result["inputTargetHandle"]=window.ToInt64();result["inputTargetProcessId"]=owner;return result;}
      bool background=action=="type_text"?method=="background":TextOption(args,"dispatch","foreground")=="background";
      if(background) {
        if(!args.ContainsKey("windowTitle") && !args.ContainsKey("processId") && !args.ContainsKey("nativeWindowHandle"))throw new InvalidOperationException("BACKGROUND_TARGET_REQUIRED");
        string characters=action=="type_text"?text:Convert.ToString(((IList)args["keys"])[0]);
        IntPtr recipient=TextFocus(window);if(recipient==IntPtr.Zero)recipient=window;AssertWritableText(recipient);
        foreach(char character in characters) {if(!IsWindow(window) || WindowOwner(window)!=owner || WindowOwner(recipient)!=owner)throw new InvalidOperationException("TARGET_IDENTITY_CHANGED");if(!ControlPost(recipient,0x102,new IntPtr(character),new IntPtr(1)))throw new InvalidOperationException("TEXT_DISPATCH_UNCONFIRMED: some WM_CHAR messages may have been delivered; never replay");}
        result["method"]="postmessage-wmchar";result["verification"]="unconfirmed";result["verified"]=false;result["inputTargetHandle"]=window.ToInt64();result["inputTargetProcessId"]=owner;return result;
      }
      if(TextOption(args,"_cancelEvent","").Length==0)throw new InvalidOperationException("WCU_NEEDS_INPUT: physical text/key input requires independent stopping");
      cancel=EventWaitHandle.OpenExisting(Convert.ToString(args["_cancelEvent"]));listener=Process.GetProcessById(NumberOption(args,"_stopProcessId",0));IntPtr listenerHandle=listener.Handle;
      if(cancel.WaitOne(0) || listener.HasExited)throw new InvalidOperationException("COMPUTER_USE_STOPPED");
      foreach(int key in new int[]{1,2,4,16,17,18,91,92})if(GetAsyncKeyState(key)<0)throw new InvalidOperationException("USER_INPUT_ACTIVE: button or modifier already held");
      interaction.Check();
      if(GetForegroundWindow()!=window && (!ManagementActivate(window,owner) || GetForegroundWindow()!=window))throw new InvalidOperationException("TARGET_ACTIVATION_REFUSED");
      if(args.ContainsKey("_elementId")){main.SetFocus();}
      else if(action=="type_text" && TextOption(args,"focusMode","preserve")=="main") {main=MainTextControl(window);main.SetFocus();result["focusedControl"]=main.Current.ControlType.ProgrammaticName;}
      if(action=="type_text" && TextFocus(window,false)==IntPtr.Zero) {IntPtr remembered=TextFocus(window);if(remembered!=IntPtr.Zero)AutomationElement.FromHandle(remembered).SetFocus();}
      IntPtr expectedFocus=TextFocus(window,false);if(action=="type_text")AssertWritableText(expectedFocus);
      TextCheck(cancel,listener,window,owner,expectedFocus,action=="type_text",interaction);
      if(action=="type_text")RememberTextFocus(window,expectedFocus);
      if(action=="keypress") {Chord((IEnumerable)args["keys"],cancel,listener,window,owner,held,interaction);result["method"]="sendinput-keychord";}
      else if(method=="sendinput") {
        int sent=0;
        foreach(char character in text) {TextCheck(cancel,listener,window,owner,expectedFocus,true,interaction);HeldKey unicode=new HeldKey{Scan=character,Flags=4};Down(held,unicode);Up(held,unicode);sent++;if(sent%32==0 && cancel.WaitOne(1))throw new InvalidOperationException("COMPUTER_USE_STOPPED");}
        result["method"]="sendinput-unicode";
      }else {
        // All UIA focus/provider calls finish BEFORE clipboard replacement.
        ProcessStartInfo info=new ProcessStartInfo{FileName=TextOption(args,"_clipboardExecutable",""),UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true,StandardOutputEncoding=Encoding.UTF8,StandardErrorEncoding=Encoding.UTF8};
        clipboardRead=null;clipboard=Process.Start(info);clipboard.ErrorDataReceived+=delegate(object sender,DataReceivedEventArgs e){};clipboard.BeginErrorReadLine();
        clipboard.StandardInput.WriteLine(new JavaScriptSerializer().Serialize(new Dictionary<string,object>{{"text",text},{"cancelEvent",args["_cancelEvent"]},{"parentProcessId",Process.GetCurrentProcess().Id}}));clipboard.StandardInput.Flush();
        ClipboardPhase(clipboard,"snapshot",5000);
        TextCheck(cancel,listener,window,owner,expectedFocus,true,interaction);
        clipboardMayChange=true;clipboard.StandardInput.WriteLine("replace");clipboard.StandardInput.Flush();ClipboardPhase(clipboard,"replaced",2000);clipboardReplaced=true;
        TextCheck(cancel,listener,window,owner,expectedFocus,true,interaction);
        if(Option(args,"_replaceAll",false)){Chord(new string[]{"Ctrl","A"},cancel,listener,window,owner,held,interaction);TextCheck(cancel,listener,window,owner,expectedFocus,true,interaction);}
        Chord(new string[]{"Ctrl","V"},cancel,listener,window,owner,held,interaction);
        if(cancel.WaitOne(60))throw new InvalidOperationException("COMPUTER_USE_STOPPED");
        UIntPtr ignored;if(SendMessageTimeout(window,0,UIntPtr.Zero,IntPtr.Zero,2,200,out ignored)==IntPtr.Zero)throw new InvalidOperationException("PASTE_DISPATCH_UNCONFIRMED: target did not complete its bounded drain; observe before retrying");
        result["method"]="clipboard-paste";result["restoreClipboard"]=Option(args,"restoreClipboard",true);
      }
      if(action=="type_text")RememberTextFocus(window,expectedFocus);
      result["verification"]="sent";result["inputTargetHandle"]=window.ToInt64();result["inputTargetProcessId"]=owner;
    }catch(Exception error){result["ok"]=false;result["error"]=error.Message;if(error.Message.StartsWith("WCU_NEEDS_INPUT",StringComparison.Ordinal))result["inputRequired"]=true;}
    finally {
      for(int i=held.Count-1;i>=0;i--)try{KeyEvent(held[i],true);}catch(Exception error){cleanup=false;result["ok"]=false;result["error"]="INPUT_CLEANUP_UNCONFIRMED: "+error.Message;}
      if(clipboard!=null) {
        try {
          if(clipboardMayChange) {
            if(!clipboard.HasExited){clipboard.StandardInput.WriteLine(result.ContainsKey("error") || !clipboardReplaced || Option(args,"restoreClipboard",true)?"restore":"keep");clipboard.StandardInput.Flush();}
            ConfirmClipboardRestore(clipboard);
            if(!clipboard.WaitForExit(2000))throw new InvalidOperationException("CLIPBOARD_EXIT_UNCONFIRMED");
          }else {clipboard.StandardInput.Close();if(!clipboard.WaitForExit(500)){clipboard.Kill();if(!clipboard.WaitForExit(1000))throw new InvalidOperationException("CLIPBOARD_EXIT_UNCONFIRMED");}}
          result["clipboardCleanupConfirmed"]=true;
        }catch(Exception error){if(!clipboardMayChange){try{if(!clipboard.HasExited){clipboard.Kill();clipboard.WaitForExit(1000);}}catch{} }else {cleanup=false;result["ok"]=false;result["error"]="CLIPBOARD_CLEANUP_UNCONFIRMED: "+error.Message;}}
        if(!clipboardMayChange || cleanup)clipboard.Dispose();
      }
      if(cancel!=null)cancel.Dispose();if(listener!=null)listener.Dispose();
      result["cleanupConfirmed"]=cleanup;
      // No potentially blocked UIA verification is permitted before clipboard cleanup.
      if(cleanup)RestoreControlState(result,before,pointer,window,popups,Option(args,"activate",false),interaction);
      else {result["pointer"]="left: cleanup unconfirmed";result["foreground"]="left: cleanup unconfirmed";}
      if(cleanup)NotifyPhysicalInput(false);
    }
    return result;
  }
}
