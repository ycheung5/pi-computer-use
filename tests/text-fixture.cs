using System;
using System.Threading;
using System.Windows.Forms;
class BackgroundForm : Form { protected override bool ShowWithoutActivation { get { return true; } } }
class TextFixture {
  [STAThread] static void Main(string[] args) {
    Console.OutputEncoding=new System.Text.UTF8Encoding(false);
    BackgroundForm form=new BackgroundForm { Text=args[0],Width=520,Height=400 };
    TextBox edit=new TextBox { AccessibleName="Background editor",Text="original",Left=10,Top=10,Width=240 };
    TextBox readOnly=new TextBox { AccessibleName="Read only editor",Text="fixed",ReadOnly=true,Left=260,Top=10,Width=200 };
    Label status=new Label { AccessibleName="Clicked 0",Text="Clicked 0",Left=10,Top=45,Width=200 };
    Button button=new Button { AccessibleName="Background action",Text="Run",Left=10,Top=70,Width=100 };
    int clicks=0;button.Click+=delegate { clicks++;status.Text=status.AccessibleName="Clicked "+clicks; };
    Label unsupported=new Label { AccessibleName="Unsupported label",Text="No action",Left=160,Top=70,Width=100 };
    Label scrollStatus=new Label { AccessibleName="Scrolled 0",Text="Scrolled 0",Left=10,Top=110,Width=200 };
    Panel panel=new Panel { AccessibleName="Background scroller",AutoScroll=true,Left=10,Top=140,Width=250,Height=160 };
    for(int index=0;index<30;index++)panel.Controls.Add(new Label {Text="Row "+index,Left=0,Top=index*25,Width=160});
    panel.Scroll+=delegate { scrollStatus.Text=scrollStatus.AccessibleName="Scrolled "+(-panel.AutoScrollPosition.Y); };
    Panel drag=new Panel {AccessibleName="Pointer fixture surface",Left=280,Top=140,Width=180,Height=150,BackColor=System.Drawing.Color.LightBlue};
    Label release=new Label {AccessibleName="Released 0",Text="Released 0",Left=280,Top=310,Width=180};
    int releases=0;drag.MouseDown+=delegate {release.Text=release.AccessibleName="Held";Console.WriteLine("pointer-down");Console.Out.Flush();};
    drag.MouseUp+=delegate {releases++;release.Text=release.AccessibleName="Released "+releases;};
    form.Controls.Add(drag);form.Controls.Add(release);
    form.Controls.Add(edit);form.Controls.Add(readOnly);form.Controls.Add(status);form.Controls.Add(button);form.Controls.Add(unsupported);form.Controls.Add(scrollStatus);form.Controls.Add(panel);
    form.Shown+=delegate {Console.WriteLine(form.Handle.ToInt64());Console.Out.Flush();};
    BackgroundForm cover=null;
    ThreadPool.QueueUserWorkItem(delegate {string command;while((command=Console.ReadLine())!=null){if(command=="stop")break;if(command=="clipboard-seed")form.BeginInvoke((Action)delegate {FixtureClipboard.Seed(form.Handle);Console.WriteLine("clipboard-seeded");Console.Out.Flush();});if(command=="clipboard-check")form.BeginInvoke((Action)delegate {Console.WriteLine(FixtureClipboard.Check(form.Handle)?"clipboard-restored":"clipboard-mismatch");Console.Out.Flush();});if(command=="keys-check")form.BeginInvoke((Action)delegate {Console.WriteLine(FixtureClipboard.KeysReleased()?"keys-released":"keys-held");Console.Out.Flush();});if(command=="notify-text")form.BeginInvoke((Action)delegate {EventHandler changed=null;changed=delegate {edit.TextChanged-=changed;Console.WriteLine("typed");Console.Out.Flush();};edit.TextChanged+=changed;Console.WriteLine("armed");Console.Out.Flush();});if(command=="shift")form.BeginInvoke((Action)delegate {form.Left+=20;form.Top+=15;Console.WriteLine("shifted");Console.Out.Flush();});if(command=="cover")form.BeginInvoke((Action)delegate {cover=new BackgroundForm {Text="Pointer guard cover",StartPosition=FormStartPosition.Manual,Bounds=form.Bounds,TopMost=true};cover.Show();Console.WriteLine("covered");Console.Out.Flush();});if(command=="remove")form.BeginInvoke((Action)delegate {form.Controls.Remove(button);button.Dispose();Console.WriteLine("removed");Console.Out.Flush();});}form.BeginInvoke((Action)delegate{if(cover!=null)cover.Close();form.Close();});});
    System.Windows.Forms.Timer timeout=new System.Windows.Forms.Timer {Interval=60000};timeout.Tick+=delegate{form.Close();};timeout.Start();Application.Run(form);
  }
}

class FixtureClipboard {
 [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool OpenClipboard(IntPtr owner);
 [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool CloseClipboard();
 [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool EmptyClipboard();
 [System.Runtime.InteropServices.DllImport("user32.dll")] static extern IntPtr SetClipboardData(uint format,IntPtr data);
 [System.Runtime.InteropServices.DllImport("user32.dll")] static extern IntPtr GetClipboardData(uint format);
 [System.Runtime.InteropServices.DllImport("user32.dll",CharSet=System.Runtime.InteropServices.CharSet.Unicode)] static extern uint RegisterClipboardFormat(string name);
 [System.Runtime.InteropServices.DllImport("kernel32.dll")] static extern IntPtr GlobalAlloc(uint flags,UIntPtr size);
 [System.Runtime.InteropServices.DllImport("kernel32.dll")] static extern IntPtr GlobalLock(IntPtr data);
 [System.Runtime.InteropServices.DllImport("kernel32.dll")] static extern bool GlobalUnlock(IntPtr data);
 [System.Runtime.InteropServices.DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
 static readonly System.Collections.Generic.Dictionary<uint,byte[]> expected=new System.Collections.Generic.Dictionary<uint,byte[]>();
 public static bool KeysReleased(){foreach(int key in new int[]{16,17,18,91,92})if(GetAsyncKeyState(key)<0)return false;return true;}
 public static void Seed(IntPtr owner) {
   expected.Clear();expected[13]=System.Text.Encoding.Unicode.GetBytes("Fixture original 測試\0");
   expected[RegisterClipboardFormat("HTML Format")]=System.Text.Encoding.UTF8.GetBytes("<b>Fixture HTML</b>\0");
   expected[RegisterClipboardFormat("PiFixtureBinary")]=new byte[]{0,255,4,8,0,128};
   using(var image=new System.Drawing.Bitmap(2,2))using(var bytes=new System.IO.MemoryStream()) {image.SetPixel(0,0,System.Drawing.Color.Green);image.Save(bytes,System.Drawing.Imaging.ImageFormat.Bmp);byte[] bmp=bytes.ToArray();byte[] dib=new byte[bmp.Length-14];Array.Copy(bmp,14,dib,0,dib.Length);expected[8]=dib;}
   foreach(string name in new string[]{"ExcludeClipboardContentFromMonitorProcessing","CanIncludeInClipboardHistory","CanUploadToCloudClipboard"})expected[RegisterClipboardFormat(name)]=new byte[4];
   if(!OpenClipboard(owner))throw new Exception("Fixture clipboard busy");try {if(!EmptyClipboard())throw new Exception("Fixture empty failed");foreach(var item in expected){IntPtr data=GlobalAlloc(0x42,new UIntPtr((uint)item.Value.Length));IntPtr memory=GlobalLock(data);System.Runtime.InteropServices.Marshal.Copy(item.Value,0,memory,item.Value.Length);GlobalUnlock(data);if(SetClipboardData(item.Key,data)==IntPtr.Zero)throw new Exception("Fixture set failed");}}finally {CloseClipboard();}
 }
 public static bool Check(IntPtr owner) {
   if(!OpenClipboard(owner))return false;try {foreach(var item in expected){IntPtr data=GetClipboardData(item.Key);if(data==IntPtr.Zero)return false;IntPtr memory=GlobalLock(data);if(memory==IntPtr.Zero)return false;try{byte[] actual=new byte[item.Value.Length];System.Runtime.InteropServices.Marshal.Copy(memory,actual,0,actual.Length);for(int i=0;i<actual.Length;i++)if(actual[i]!=item.Value[i])return false;}finally {GlobalUnlock(data);}}return true;}finally{CloseClipboard();}
 }
}
