using System;
using System.Drawing;
using System.Threading;
using System.Windows.Forms;
class PointerDropFixture {
  [System.Runtime.InteropServices.DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  static int drops;
  [STAThread] static void Main(string[] args) {
    Console.OutputEncoding=new System.Text.UTF8Encoding(false);
    Form form=new Form {Text=args[0],Width=520,Height=300};
    Panel source=new Panel {AccessibleName="Drop source",Left=40,Top=70,Width=140,Height=120,BackColor=Color.LightBlue};
    Panel destination=new Panel {AccessibleName="Drop target",Left=300,Top=70,Width=140,Height=120,BackColor=Color.LightGreen,AllowDrop=true};
    source.MouseMove+=delegate(object sender,MouseEventArgs e) {if(e.Button==MouseButtons.Left) source.DoDragDrop("pi-drop-fixture",DragDropEffects.Copy);};
    destination.DragEnter+=delegate(object sender,DragEventArgs e) {if(e.Data.GetDataPresent(DataFormats.Text)) e.Effect=DragDropEffects.Copy;};
    destination.DragDrop+=delegate(object sender,DragEventArgs e) {if((string)e.Data.GetData(DataFormats.Text)=="pi-drop-fixture") Interlocked.Increment(ref drops);};
    form.Controls.Add(source);form.Controls.Add(destination);
    form.Shown+=delegate {Console.WriteLine(form.Handle.ToInt64());Console.Out.Flush();};
    ThreadPool.QueueUserWorkItem(delegate {string command;while((command=Console.ReadLine())!=null) {if(command=="observe") {Console.WriteLine("state:"+Interlocked.CompareExchange(ref drops,0,0)+":"+((GetAsyncKeyState(1)&0x8000)!=0?1:0));Console.Out.Flush();} else if(command=="stop") {form.BeginInvoke((Action)delegate{form.Close();});break;}}});
    Application.Run(form);
  }
}
