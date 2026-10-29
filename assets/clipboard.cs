using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

// Isolated STA process. Snapshot is a separate protocol phase: it can be killed
// on a delayed-render/provider timeout before any clipboard mutation is allowed.
class ClipboardBridge {
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr CreateWindowEx(uint extended,string name,string title,uint style,int x,int y,int width,int height,IntPtr parent,IntPtr menu,IntPtr instance,IntPtr parameter);
  [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr window);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClipboardFormatName(uint format,StringBuilder name,int count);
  [StructLayout(LayoutKind.Sequential)] struct Message {public IntPtr Hwnd;public uint Id;public UIntPtr W;public IntPtr L;public uint Time;public int X,Y;public uint Private;}
  [DllImport("user32.dll")] static extern bool PeekMessage(out Message message,IntPtr window,uint first,uint last,uint remove);
  [DllImport("user32.dll")] static extern bool TranslateMessage(ref Message message);
  [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref Message message);
  static void Pump() {Message message;while(PeekMessage(out message,IntPtr.Zero,0,0,1)){TranslateMessage(ref message);DispatchMessage(ref message);}}
  static IntPtr clipboardOwner;
  [DllImport("user32.dll",SetLastError=true)] static extern bool OpenClipboard(IntPtr owner);
  [DllImport("user32.dll")] static extern bool CloseClipboard();
  [DllImport("user32.dll",SetLastError=true)] static extern bool EmptyClipboard();
  [DllImport("user32.dll",SetLastError=true)] static extern uint EnumClipboardFormats(uint format);
  [DllImport("user32.dll",SetLastError=true)] static extern IntPtr GetClipboardData(uint format);
  [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SetClipboardData(uint format,IntPtr data);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern uint RegisterClipboardFormat(string name);
  [DllImport("user32.dll")] static extern uint GetClipboardSequenceNumber();
  [DllImport("ole32.dll")] static extern IntPtr OleDuplicateData(IntPtr data,ushort format,uint flags);
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr GlobalAlloc(uint flags,UIntPtr size);
  [DllImport("kernel32.dll")] static extern IntPtr GlobalLock(IntPtr data);
  [DllImport("kernel32.dll")] static extern bool GlobalUnlock(IntPtr data);
  [DllImport("kernel32.dll")] static extern IntPtr GlobalFree(IntPtr data);
  [DllImport("kernel32.dll")] static extern void SetLastError(uint code);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr data);
  [DllImport("gdi32.dll",CharSet=CharSet.Unicode)] static extern IntPtr CopyEnhMetaFile(IntPtr data,string filename);
  [DllImport("gdi32.dll")] static extern bool DeleteEnhMetaFile(IntPtr data);
  [DllImport("gdi32.dll")] static extern bool DeleteMetaFile(IntPtr data);
  [StructLayout(LayoutKind.Sequential)] struct MetaPicture {public int Mode,X,Y;public IntPtr Meta;}
  sealed class Item {public uint Format;public IntPtr Data;}
  static readonly List<Item> snapshot=new List<Item>();
  static readonly object phaseGate=new object();static bool mayMutate;
  static uint sequence;static bool changed;static bool replaced;
  static readonly JavaScriptSerializer json=new JavaScriptSerializer {MaxJsonLength=8*1024*1024};
  static void Reply(string phase,bool ok,string error) {Console.WriteLine(json.Serialize(new Dictionary<string,object>{{"phase",phase},{"ok",ok},{"error",error},{"formats",snapshot.Count},{"restored",!changed}}));Console.Out.Flush();}
  static void Open() {Stopwatch watch=Stopwatch.StartNew();while(!OpenClipboard(clipboardOwner)){if(watch.ElapsedMilliseconds>=500)throw new InvalidOperationException("CLIPBOARD_BUSY: could not acquire clipboard");Thread.Sleep(10);}}
  static void Free(Item item) {
    if(item.Data==IntPtr.Zero)return;
    if(item.Format==2 || item.Format==9 || item.Format==0x82)DeleteObject(item.Data);
    else if(item.Format==14 || item.Format==0x8E)DeleteEnhMetaFile(item.Data);
    else {if(item.Format==3 || item.Format==0x83){IntPtr memory=GlobalLock(item.Data);if(memory!=IntPtr.Zero){MetaPicture picture=(MetaPicture)Marshal.PtrToStructure(memory,typeof(MetaPicture));DeleteMetaFile(picture.Meta);GlobalUnlock(item.Data);}}GlobalFree(item.Data);}
    item.Data=IntPtr.Zero;
  }
  static IntPtr Duplicate(IntPtr data,uint format) {return format==14 || format==0x8E?CopyEnhMetaFile(data,null):OleDuplicateData(data,(ushort)(format==0x82?2:format==0x83?3:format),0);}
  static void Snapshot() {
    Open();try {
      uint format=0;SetLastError(0);
      while((format=EnumClipboardFormats(format))!=0) {
        if(snapshot.Count>=1000 || format>65535)throw new InvalidOperationException("CLIPBOARD_SNAPSHOT_UNSUPPORTED: too many or invalid formats");
        StringBuilder name=new StringBuilder(256);GetClipboardFormatName(format,name,name.Capacity);
        if(name.ToString()=="Ole Private Data" || name.ToString()=="DataObject" || name.ToString()=="FileContents")throw new InvalidOperationException("CLIPBOARD_SNAPSHOT_UNSUPPORTED: indexed or process-private OLE data cannot be duplicated safely; unchanged");
        IntPtr data=GetClipboardData(format);
        if(data==IntPtr.Zero)throw new InvalidOperationException("CLIPBOARD_SNAPSHOT_UNSUPPORTED: format "+format+" could not be materialized; clipboard unchanged");
        IntPtr copy=Duplicate(data,format);
        if(copy==IntPtr.Zero)throw new InvalidOperationException("CLIPBOARD_SNAPSHOT_UNSUPPORTED: cannot preserve format "+format+"; clipboard unchanged");
        snapshot.Add(new Item {Format=format,Data=copy});SetLastError(0);
      }
      if(Marshal.GetLastWin32Error()!=0)throw new InvalidOperationException("CLIPBOARD_SNAPSHOT_FAILED: enumeration incomplete");
      sequence=GetClipboardSequenceNumber();
    }finally {CloseClipboard();}
  }
  static Item Bytes(uint format,byte[] bytes) {
    IntPtr data=GlobalAlloc(0x42,new UIntPtr((uint)bytes.Length));if(data==IntPtr.Zero)throw new OutOfMemoryException();
    IntPtr memory=GlobalLock(data);if(memory==IntPtr.Zero){GlobalFree(data);throw new InvalidOperationException("CLIPBOARD_ALLOC_FAILED");}
    try {Marshal.Copy(bytes,0,memory,bytes.Length);}finally {GlobalUnlock(data);}return new Item {Format=format,Data=data};
  }
  static void Replace(string text) {
    List<Item> payload=new List<Item>();
    try {
      // Publish exclusion flags first, before text can be seen by monitors.
      foreach(string name in new string[]{"ExcludeClipboardContentFromMonitorProcessing","CanIncludeInClipboardHistory","CanUploadToCloudClipboard"}) {uint format=RegisterClipboardFormat(name);if(format==0)throw new InvalidOperationException("CLIPBOARD_FORMAT_FAILED");payload.Add(Bytes(format,new byte[4]));}
      payload.Add(Bytes(13,Encoding.Unicode.GetBytes(text+"\0")));
      Open();try {
        if(GetClipboardSequenceNumber()!=sequence)throw new InvalidOperationException("CLIPBOARD_CHANGED: user changed clipboard since snapshot; nothing replaced");
        if(!EmptyClipboard())throw new InvalidOperationException("CLIPBOARD_REPLACE_FAILED");changed=true;replaced=true;
        foreach(Item item in payload){if(SetClipboardData(item.Format,item.Data)==IntPtr.Zero)throw new InvalidOperationException("CLIPBOARD_REPLACE_FAILED: partial replacement must restore");item.Data=IntPtr.Zero;}
        sequence=GetClipboardSequenceNumber();replaced=true;
      }finally {if(changed)sequence=GetClipboardSequenceNumber();CloseClipboard();}
    }finally {foreach(Item item in payload)Free(item);}
  }
  static void Restore(bool keep) {
    if(!changed)return;
    Open();try {
      // A user copy wins: do not erase newer clipboard content.
      if(replaced && GetClipboardSequenceNumber()!=sequence){changed=false;return;}
      if(keep){changed=false;return;}
      List<Item> copies=new List<Item>();bool attempted=false;
      try {
        foreach(Item item in snapshot) {IntPtr copy=Duplicate(item.Data,item.Format);if(copy==IntPtr.Zero)throw new InvalidOperationException("CLIPBOARD_RESTORE_FAILED: cannot duplicate snapshot");copies.Add(new Item{Format=item.Format,Data=copy});}
        if(!EmptyClipboard())throw new InvalidOperationException("CLIPBOARD_RESTORE_FAILED");attempted=true;
        foreach(Item item in copies){if(SetClipboardData(item.Format,item.Data)==IntPtr.Zero)throw new InvalidOperationException("CLIPBOARD_RESTORE_FAILED: retained snapshot still needs restoration");item.Data=IntPtr.Zero;}
        changed=false;
      }finally {if(attempted)sequence=GetClipboardSequenceNumber();foreach(Item item in copies)Free(item);}
    }finally {CloseClipboard();}
  }
  [STAThread] static void Main() {
    Console.InputEncoding=new UTF8Encoding(false);Console.OutputEncoding=new UTF8Encoding(false);
    clipboardOwner=CreateWindowEx(0,"STATIC","Pi clipboard transaction",0,0,0,0,0,new IntPtr(-3),IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);
    if(clipboardOwner==IntPtr.Zero)throw new InvalidOperationException("CLIPBOARD_OWNER_FAILED");
    EventWaitHandle cancel=null;Process parent=null;
    try {
      var args=json.Deserialize<Dictionary<string,object>>(Console.ReadLine());
      cancel=EventWaitHandle.OpenExisting(Convert.ToString(args["cancelEvent"]));parent=Process.GetProcessById(Convert.ToInt32(args["parentProcessId"]));IntPtr retained=parent.Handle;
      Stopwatch snapshotDeadline=Stopwatch.StartNew();
      Thread watchdog=new Thread(delegate(){while(true){Thread.Sleep(20);lock(phaseGate){if(mayMutate)return;if(cancel.WaitOne(0) || parent.HasExited || snapshotDeadline.ElapsedMilliseconds>5000){Process.GetCurrentProcess().Kill();return;}}}});watchdog.IsBackground=true;watchdog.Start();
      Snapshot();Reply("snapshot",true,null);
      string command=Console.ReadLine();
      if(command!="replace" || cancel.WaitOne(0) || parent.HasExited){Reply("replaced",false,"COMPUTER_USE_STOPPED");Reply("restored",true,null);return;}
      lock(phaseGate){mayMutate=true;}
      Replace(Convert.ToString(args["text"]));Reply("replaced",true,null);
      string next=null;bool received=false;
      Thread reader=new Thread(delegate(){next=Console.ReadLine();Volatile.Write(ref received,true);});reader.IsBackground=true;reader.Start();
      Stopwatch lifetime=Stopwatch.StartNew();
      while(!Volatile.Read(ref received) && !cancel.WaitOne(20) && !parent.HasExited && lifetime.ElapsedMilliseconds<30000){Pump();}
      bool keep=received && next=="keep" && !cancel.WaitOne(0);
      Restore(keep);Reply("restored",true,null);
    }catch(Exception error){
      Reply(changed?"restore_needed":"failed",false,error.Message);
    }finally {
      // Restoration never calls an app's rendering provider. Retry bounded lock
      // acquisition rather than losing the only retained nontext snapshot.
      while(changed)try {Restore(false);Reply("restored",true,null);}catch(Exception error){Console.Error.WriteLine("CLIPBOARD_RESTORE_FAILED: "+error.Message);Pump();Thread.Sleep(100);}
      foreach(Item item in snapshot)Free(item);
      DestroyWindow(clipboardOwner);
      if(cancel!=null)cancel.Dispose();if(parent!=null)parent.Dispose();
    }
  }
}
