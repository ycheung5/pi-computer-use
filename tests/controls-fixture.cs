using System;
using System.Threading;
using System.Windows.Forms;
class BackgroundForm : Form { protected override bool ShowWithoutActivation { get { return true; } } }
class ControlsFixture {
  [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
  [System.Runtime.InteropServices.DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [System.Runtime.InteropServices.DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window,uint flags);
  [System.Runtime.InteropServices.DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr window,uint command);
  [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)] struct LASTINPUTINFO {public uint cbSize;public uint dwTime;}
  [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO value);
  [System.Runtime.InteropServices.DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
  static uint InputTick(){LASTINPUTINFO value=new LASTINPUTINFO();value.cbSize=(uint)System.Runtime.InteropServices.Marshal.SizeOf(typeof(LASTINPUTINFO));GetLastInputInfo(ref value);return value.dwTime;}
  static uint ForegroundPid(){uint pid;GetWindowThreadProcessId(GetForegroundWindow(),out pid);return pid;}

  [System.Runtime.InteropServices.DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);

  [STAThread] static void Main(string[] args) {
    Console.OutputEncoding=new System.Text.UTF8Encoding(false);
    BackgroundForm form=new BackgroundForm { Text=args[0],Width=520,Height=400 };
    TextBox edit=new TextBox { AccessibleName="Background editor",Text="original",Left=10,Top=10,Width=240 };
    TextBox readOnly=new TextBox { AccessibleName="Read only editor",Text="fixed",ReadOnly=true,Left=260,Top=10,Width=200 };
    Label status=new Label { AccessibleName="Clicked 0",Text="Clicked 0",Left=10,Top=45,Width=200 };
    Button button=new Button { AccessibleName="Background action",Text="Run",Left=10,Top=70,Width=100 };
    int doubles=0;bool hovered=false;button.MouseEnter+=delegate {hovered=true;};button.MouseLeave+=delegate {hovered=false;};
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
    drag.MouseDoubleClick+=delegate {doubles++;};
    form.Controls.Add(drag);form.Controls.Add(release);
    TextBox disabled=new TextBox {AccessibleName="Disabled editor",Text="disabled fixed",Enabled=false,Left=280,Top=110,Width=180};form.Controls.Add(disabled);
    form.Controls.Add(edit);form.Controls.Add(readOnly);form.Controls.Add(status);form.Controls.Add(button);form.Controls.Add(unsupported);form.Controls.Add(scrollStatus);form.Controls.Add(panel);
    form.Shown+=delegate {Console.WriteLine(form.Handle.ToInt64());Console.Out.Flush();};
    BackgroundForm cover=null,popup=null,sibling=null;
    Form dialog=null;
    Button dialogButton=new Button {AccessibleName="Open owned test dialog",Text="Open test dialog",Left=280,Top=40,Width=180};
    dialogButton.Click+=delegate {if(dialog==null || dialog.IsDisposed){dialog=new Form {Text="Owned test dialog",StartPosition=FormStartPosition.Manual,Left=form.Right+10,Top=form.Top,Width=180,Height=140,ShowInTaskbar=false};dialog.Show(form);SetForegroundWindow(dialog.Handle);}};
    form.Controls.Add(dialogButton);
    LinkLabel switchSibling=new LinkLabel {AccessibleName="Switch sibling",Text="Switch sibling",Left=280,Top=70,Width=180};
    switchSibling.LinkClicked+=delegate {if(sibling!=null){SetForegroundWindow(sibling.Handle);status.Text=status.AccessibleName=GetForegroundWindow()==sibling.Handle?"Sibling selected":"Sibling activation refused";}};form.Controls.Add(switchSibling);
    ThreadPool.QueueUserWorkItem(delegate {string command;while((command=Console.ReadLine())!=null){if(command=="stop")break;if(command=="observe-pointer")form.BeginInvoke((Action)delegate {Console.WriteLine("pointer-state:"+clicks+":"+doubles+":"+(hovered?1:0)+":"+(-panel.AutoScrollPosition.Y)+":"+((GetAsyncKeyState(1)&0x8000)!=0?1:0)+":"+releases+":"+GetForegroundWindow().ToInt64());Console.Out.Flush();});if(command=="prepare-focus")form.BeginInvoke((Action)delegate {form.ActiveControl=readOnly;Console.WriteLine("focus-ready");Console.Out.Flush();});if(command=="observe")form.BeginInvoke((Action)delegate {IntPtr fg=GetForegroundWindow();uint fgPid;GetWindowThreadProcessId(fg,out fgPid);Console.WriteLine("state:"+Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(edit.Text))+":"+clicks+":"+(-panel.AutoScrollPosition.Y)+":"+edit.Focused+":"+Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(readOnly.Text))+":"+Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(disabled.Text))+":"+(form.ActiveControl==edit)+":"+fg.ToInt64()+":"+InputTick()+":"+form.Handle.ToInt64()+":"+fgPid+":"+GetAncestor(fg,2).ToInt64());Console.Out.Flush();});if(command=="dialog-state")form.BeginInvoke((Action)delegate {IntPtr h=dialog==null || dialog.IsDisposed?IntPtr.Zero:dialog.Handle;uint pid=0;if(h!=IntPtr.Zero)GetWindowThreadProcessId(h,out pid);Console.WriteLine("dialog-state:"+h.ToInt64()+":"+(h==IntPtr.Zero?0:GetWindow(h,4).ToInt64())+":"+pid+":"+(h!=IntPtr.Zero && IsWindowVisible(h)));Console.Out.Flush();});if(command=="popup")form.BeginInvoke((Action)delegate {
      popup=new BackgroundForm {Text="Owned popup",StartPosition=FormStartPosition.Manual,Left=form.Right+10,Top=form.Top,Width=180,Height=140,TopMost=true};
      if(popup.Right>Screen.FromControl(form).WorkingArea.Right){popup.Left=form.Left;popup.Top=form.Bottom+10;}
      Button item=new Button {Text="Popup action",AccessibleName="Popup action",Left=10,Top=10,Width=130};item.Click+=delegate {status.Text=status.AccessibleName="Popup clicked";form.Enabled=true;popup.Close();};popup.Controls.Add(item);popup.Show(form);form.Enabled=false;popup.Enabled=true;
      var point=item.PointToScreen(new System.Drawing.Point(item.Width/2,item.Height/2));Console.WriteLine("popup:"+point.X+":"+point.Y);Console.Out.Flush();
    });if(command=="foreground")form.BeginInvoke((Action)delegate {Console.WriteLine("foreground:"+GetForegroundWindow().ToInt64());Console.Out.Flush();});if(command=="sibling")form.BeginInvoke((Action)delegate {sibling=new BackgroundForm {Text="Existing sibling",Width=200,Height=120};sibling.Show();Console.WriteLine("sibling:"+sibling.Handle.ToInt64());Console.Out.Flush();});if(command=="shift")form.BeginInvoke((Action)delegate {form.Left+=20;form.Top+=15;Console.WriteLine("shifted");Console.Out.Flush();});if(command=="cover")form.BeginInvoke((Action)delegate {cover=new BackgroundForm {Text="Pointer guard cover",StartPosition=FormStartPosition.Manual,Bounds=form.Bounds,TopMost=true};cover.Show();Console.WriteLine("covered");Console.Out.Flush();});if(command=="remove")form.BeginInvoke((Action)delegate {form.Controls.Remove(button);button.Dispose();Console.WriteLine("removed");Console.Out.Flush();});}form.BeginInvoke((Action)delegate{if(cover!=null)cover.Close();if(popup!=null)popup.Close();if(sibling!=null)sibling.Close();if(dialog!=null && !dialog.IsDisposed)dialog.Close();form.Close();});});
    if(args.Length<2 || args[1]!="--no-expiry") {System.Windows.Forms.Timer timeout=new System.Windows.Forms.Timer {Interval=60000};timeout.Tick+=delegate{form.Close();};timeout.Start();}Application.Run(form);
  }
}
