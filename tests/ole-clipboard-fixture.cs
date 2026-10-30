using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using OleDataObject=System.Runtime.InteropServices.ComTypes.IDataObject;
class OleFixtureForm : Form {protected override bool ShowWithoutActivation {get{return true;}}}
class OleClipboardFixture {
 [DllImport("user32.dll")]static extern uint GetClipboardSequenceNumber();
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern uint RegisterClipboardFormat(string name);
 [DllImport("ole32.dll")]static extern int OleSetClipboard(OleDataObject data);
 [DllImport("ole32.dll")]static extern int OleGetClipboard(out OleDataObject data);
 [DllImport("ole32.dll")]static extern void ReleaseStgMedium(ref STGMEDIUM medium);
 [DllImport("kernel32.dll")]static extern IntPtr GlobalLock(IntPtr data);
 [DllImport("kernel32.dll")]static extern bool GlobalUnlock(IntPtr data);
 [DllImport("kernel32.dll")]static extern UIntPtr GlobalSize(IntPtr data);
 static readonly string token=Guid.NewGuid().ToString();
 static readonly uint marker=RegisterClipboardFormat("PiCUOleFixtureOwner");
 static readonly byte[] markerBytes=Encoding.Unicode.GetBytes(token+"\0");
 const string seedText="Original clipboard 中文 café 😀";
 const string seedHtml="<b>OLE clipboard fixture</b>";
 static readonly byte[] seedBinary=new byte[]{0,255,4,8,0,128};
 static DataObject original;static object retained;static bool seeded;static uint seedSequence;
 static void Reply(string text){Console.WriteLine(text);Console.Out.Flush();}
 static DataObject PreserveOriginal() {
  uint sequence=GetClipboardSequenceNumber();var source=Clipboard.GetDataObject();var copy=new DataObject();
  if(source!=null)foreach(string format in source.GetFormats(false)) {
   if(format=="DataObject" || format=="Ole Private Data" || format=="FileContents")throw new Exception("unsupported original clipboard format; fixture did not replace it");
   object value=source.GetData(format,false);
   if(value is MemoryStream)value=new MemoryStream(((MemoryStream)value).ToArray());
   else if(value is byte[])value=((byte[])value).Clone();
   else if(!(value is string))throw new Exception("fixture requires text/stream clipboard data; original unchanged");
   copy.SetData(format,false,value);
  }
  if(GetClipboardSequenceNumber()!=sequence)throw new Exception("clipboard changed before fixture setup");return copy;
 }
 static bool OwnsClipboard() {
  if(!seeded)return false;
  if(GetClipboardSequenceNumber()==seedSequence)return true;
  var data=Clipboard.GetDataObject();if(data==null)return false;
  var stream=data.GetData("PiCUOleFixtureOwner",false) as MemoryStream;if(stream==null)return false;
  byte[] actual=stream.ToArray();if(actual.Length!=markerBytes.Length)return false;
  for(int i=0;i<actual.Length;i++)if(actual[i]!=markerBytes[i])return false;return true;
 }
 static void Seed(bool indexed) {
  if(indexed){var data=new IndexedFixtureData((short)marker,markerBytes);Marshal.ThrowExceptionForHR(OleSetClipboard(data));retained=data;}
  else {var data=new DataObject();data.SetData(DataFormats.UnicodeText,false,seedText);data.SetData(DataFormats.Html,false,seedHtml);data.SetData("PiCUOleFixtureBytes",false,new MemoryStream(seedBinary));data.SetData("PiCUOleFixtureOwner",false,new MemoryStream(markerBytes));Clipboard.SetDataObject(data,false);retained=data;}
  seeded=true;seedSequence=GetClipboardSequenceNumber();Reply(indexed?"indexed-seeded":"ole-seeded");
 }
 static bool CheckSeed() {
  var data=Clipboard.GetDataObject();if(data==null || !OwnsClipboard())return false;
  if(!Equals(data.GetData(DataFormats.UnicodeText,false),seedText) || !Equals(data.GetData(DataFormats.Html,false),seedHtml))return false;
  var bytes=data.GetData("PiCUOleFixtureBytes",false) as MemoryStream;if(bytes==null)return false;
  byte[] actual=bytes.ToArray();if(actual.Length!=seedBinary.Length)return false;for(int i=0;i<actual.Length;i++)if(actual[i]!=seedBinary[i])return false;return true;
 }
 static string CheckIndexed() {
  if(!OwnsClipboard())return "indexed-mismatch:owner";
  OleDataObject data;Marshal.ThrowExceptionForHR(OleGetClipboard(out data));return CheckIndexedData(data);
 }
 static string CheckIndexedData(OleDataObject data) {
  var format=new FORMATETC {cfFormat=(short)RegisterClipboardFormat("PiCUIndexedPayload"),dwAspect=DVASPECT.DVASPECT_CONTENT,lindex=0,tymed=TYMED.TYMED_HGLOBAL};
  int query=data.QueryGetData(ref format);if(query!=0)return "indexed-mismatch:query:"+query.ToString("X8");
  STGMEDIUM medium;try{data.GetData(ref format,out medium);}catch(COMException error){return "indexed-mismatch:get:"+error.ErrorCode.ToString("X8");}
  try {if(medium.tymed!=TYMED.TYMED_HGLOBAL)return "indexed-mismatch:tymed";if(GlobalSize(medium.unionmember).ToUInt64()<4)return "indexed-mismatch:size";
   IntPtr memory=GlobalLock(medium.unionmember);if(memory==IntPtr.Zero)return "indexed-mismatch:lock";
   try {byte[] actual=new byte[4];Marshal.Copy(memory,actual,0,4);return actual[0]==1 && actual[1]==2 && actual[2]==3 && actual[3]==4?"indexed-preserved":"indexed-mismatch:bytes";}
   finally {GlobalUnlock(medium.unionmember);}
  }finally {ReleaseStgMedium(ref medium);}
 }
 static string IndexedFormats(OleDataObject data) {
  var values=new List<string>();var iterator=data.EnumFormatEtc(DATADIR.DATADIR_GET);var next=new FORMATETC[1];var fetched=new int[1];
  for(int count=0;count<32 && iterator.Next(1,next,fetched)==0;count++) {
   var value=next[0];values.Add("{\"format\":"+((ushort)value.cfFormat)+",\"index\":"+value.lindex+",\"aspect\":"+(int)value.dwAspect+",\"medium\":"+(int)value.tymed+"}");
  }
  return "["+string.Join(",",values.ToArray())+"]";
 }
 static string ProbeIndexed() {
  var direct=retained as OleDataObject;OleDataObject clipboard;Marshal.ThrowExceptionForHR(OleGetClipboard(out clipboard));
  return "{\"direct\":\""+CheckIndexedData(direct)+"\",\"clipboard\":\""+CheckIndexedData(clipboard)+"\",\"expectedFormat\":"+RegisterClipboardFormat("PiCUIndexedPayload")+",\"directFormats\":"+IndexedFormats(direct)+",\"clipboardFormats\":"+IndexedFormats(clipboard)+"}";
 }
 [STAThread]static void Main(){
  Console.OutputEncoding=new UTF8Encoding(false);original=PreserveOriginal();
  var form=new OleFixtureForm {Text="Pi OLE clipboard disposable fixture",Width=500,Height=220};
  var editor=new TextBox {AccessibleName="OLE clipboard editor",Left=10,Top=10,Width=400};form.Controls.Add(editor);
  bool copyOnPaste=false;
  editor.TextChanged+=delegate{if(copyOnPaste){copyOnPaste=false;var data=new DataObject();data.SetData(DataFormats.UnicodeText,false,"Fixture newer copy 中文");data.SetData("PiCUOleFixtureOwner",false,new MemoryStream(markerBytes));Clipboard.SetDataObject(data,false);retained=data;seedSequence=GetClipboardSequenceNumber();}};
  form.Shown+=delegate{Reply(form.Handle.ToInt64().ToString());};
  ThreadPool.QueueUserWorkItem(delegate{string command;while((command=Console.ReadLine())!=null){string next=command;form.BeginInvoke((Action)delegate{
    if(next=="seed-ole")Seed(false);
    else if(next=="seed-indexed")Seed(true);
    else if(next=="reset-editor"){editor.Text="";Reply("editor-reset");}
    else if(next=="probe-indexed")Reply(ProbeIndexed());
    else if(next=="editor-base64")Reply(Convert.ToBase64String(Encoding.UTF8.GetBytes(editor.Text)));
    else if(next=="check-seed")Reply(CheckSeed()?"seed-preserved":"seed-mismatch");
    else if(next=="copy-on-paste"){copyOnPaste=true;Reply("copy-armed");}
    else if(next=="check-newer")Reply(Equals(Clipboard.GetDataObject().GetData(DataFormats.UnicodeText,false),"Fixture newer copy 中文")?"newer-preserved":"newer-mismatch");
    else if(next=="check-indexed")Reply(CheckIndexed());
    else if(next=="restore-close") {if(OwnsClipboard()){Clipboard.SetDataObject(original,true);Reply("original-restored");}else Reply(seeded?"newer-copy-preserved":"original-unchanged");seeded=false;form.Close();}
   });if(next=="restore-close")return;}form.BeginInvoke((Action)delegate{if(OwnsClipboard())Clipboard.SetDataObject(original,true);seeded=false;form.Close();});});
  try{Application.Run(form);}finally{GC.KeepAlive(retained);if(OwnsClipboard())Clipboard.SetDataObject(original,true);}
 }
}
[ComVisible(true),ClassInterface(ClassInterfaceType.None)]
class IndexedFixtureData : OleDataObject {
 [DllImport("kernel32.dll")]static extern IntPtr GlobalAlloc(uint flags,UIntPtr count);
 [DllImport("kernel32.dll")]static extern IntPtr GlobalLock(IntPtr data);
 [DllImport("kernel32.dll")]static extern bool GlobalUnlock(IntPtr data);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern uint RegisterClipboardFormat(string name);
 readonly FORMATETC[] formats;readonly byte[] owner;
 public IndexedFixtureData(short marker,byte[] value){owner=value;formats=new FORMATETC[]{new FORMATETC {cfFormat=marker,dwAspect=DVASPECT.DVASPECT_CONTENT,lindex=-1,tymed=TYMED.TYMED_HGLOBAL},new FORMATETC {cfFormat=(short)RegisterClipboardFormat("PiCUIndexedPayload"),dwAspect=DVASPECT.DVASPECT_CONTENT,lindex=0,tymed=TYMED.TYMED_HGLOBAL}};}
 public void GetData(ref FORMATETC format,out STGMEDIUM medium){byte[] bytes=format.cfFormat==formats[0].cfFormat?owner:new byte[]{1,2,3,4};if(format.cfFormat!=formats[0].cfFormat && format.lindex!=0)throw new COMException("indexed payload",unchecked((int)0x80040068));IntPtr data=GlobalAlloc(0x42,new UIntPtr((uint)bytes.Length));IntPtr memory=GlobalLock(data);Marshal.Copy(bytes,0,memory,bytes.Length);GlobalUnlock(data);medium=new STGMEDIUM {tymed=TYMED.TYMED_HGLOBAL,unionmember=data,pUnkForRelease=null};}
 public IEnumFORMATETC EnumFormatEtc(DATADIR direction){return new FixtureFormats(formats);}
 public int QueryGetData(ref FORMATETC format){return format.lindex==(format.cfFormat==formats[0].cfFormat?-1:0)?0:unchecked((int)0x80040068);}
 public void GetDataHere(ref FORMATETC format,ref STGMEDIUM medium){throw new NotImplementedException();}
 public int GetCanonicalFormatEtc(ref FORMATETC input,out FORMATETC output){output=input;output.ptd=IntPtr.Zero;return 0x40130;}
 public void SetData(ref FORMATETC format,ref STGMEDIUM medium,bool release){throw new NotImplementedException();}
 public int DAdvise(ref FORMATETC format,ADVF flags,IAdviseSink sink,out int connection){connection=0;return unchecked((int)0x80040003);}
 public void DUnadvise(int connection){throw new NotImplementedException();}
 public int EnumDAdvise(out IEnumSTATDATA iterator){iterator=null;return unchecked((int)0x80040003);}
}
[ComVisible(true),ClassInterface(ClassInterfaceType.None)]
class FixtureFormats : IEnumFORMATETC {
 readonly FORMATETC[] formats;int offset;
 public FixtureFormats(FORMATETC[] values){formats=values;}
 public int Next(int count,FORMATETC[] values,int[] fetched){int copied=0;while(copied<count && offset<formats.Length)values[copied++]=formats[offset++];if(fetched!=null)fetched[0]=copied;return copied==count?0:1;}
 public int Skip(int count){int old=offset;offset=Math.Min(formats.Length,offset+count);return offset-old==count?0:1;}
 public int Reset(){offset=0;return 0;}
 public void Clone(out IEnumFORMATETC copy){copy=new FixtureFormats(formats){offset=offset};}
}
